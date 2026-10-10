import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

const root='artifacts/decoration-mapping-2026-10-10';
const maps=new Map();
for(const file of await readdir(root+'/profile-dist/assets')){
  if(file.endsWith('.js.map'))maps.set(file.slice(0,-4),new TraceMap(JSON.parse(await readFile(root+'/profile-dist/assets/'+file,'utf8'))));
}
const source=(url,line,column)=>{
  const file=path.basename(url),map=maps.get(file);
  if(!map)return file+':'+(line+1)+':'+column;
  const hit=originalPositionFor(map,{line:line+1,column});
  return (hit.source??file)+':'+hit.line+(hit.name?' '+hit.name:'');
};
const med=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const output={};
const raw=JSON.parse(await readFile(root+'/command-profile.json','utf8'));
const groups=new Map();
for(const row of raw.results){
  const key=row.version+' '+row.scenario;
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(row);
}
output.measurements=Object.fromEntries([...groups].map(([key,rows])=>[key,{
  repeats:rows.length,
  missing:rows.map(r=>r.missing),
  perRun:rows.map(row=>Object.fromEntries(['sync','twoFrames',...Object.keys(row.samples[0].cpu)].map(k=>[k,med(row.samples.map(s=>s[k]??s.cpu[k]))]))),
}]));
for(const group of Object.values(output.measurements))group.medians=Object.fromEntries(Object.keys(group.perRun[0]).map(k=>[k,med(group.perRun.map(r=>r[k]))]));

output.diagnostics={};
for(const scenario of ['whole-sync','bold-shortcut','local-append']){
  const stem=root+'/after-'+scenario;
  let trace;
  try{trace=JSON.parse(await readFile(stem+'.trace.json','utf8')).traceEvents;}catch{continue;}
  const starts=trace.filter(e=>e.name==='command-start').map(e=>e.ts).sort((a,b)=>a-b);
  const ends=trace.filter(e=>e.name==='command-frames-end').map(e=>e.ts).sort((a,b)=>a-b);
  const windows=starts.map((s,i)=>[s,ends[i]]);
  const contained=t=>windows.some(([s,e])=>t>=s&&t<=e);
  const main=trace.find(e=>e.name==='thread_name'&&e.args?.name==='CrRendererMain');
  const totals=new Map();
  for(const e of trace){
    if(e.tid!==main?.tid||e.pid!==main?.pid||e.ph!=='X'||!e.dur||!contained(e.ts))continue;
    totals.set(e.name,(totals.get(e.name)??0)+e.dur/1000);
  }
  // Exclusive wall time: native rendering inside JS is not counted as JS twice.
  const categories=['style','layout','prepaint','paint','commit','script','otherTask'];
  const category=e=>({UpdateLayoutTree:'style',Layout:'layout',PrePaint:'prepaint',Paint:'paint',Commit:'commit',FunctionCall:'script',EvaluateScript:'script',RunMicrotasks:'script',EventDispatch:'script',RunTask:'otherTask'})[e.name];
  const exclusive=Object.fromEntries([...categories,'frameWait'].map(k=>[k,0]));
  for(const [start,end] of windows){
    const points=[{t:start},{t:end}];
    for(const e of trace){
      const cat=category(e);
      if(!cat||e.ph!=='X'||!e.dur||e.tid!==main?.tid||e.pid!==main?.pid||e.ts>=end||e.ts+e.dur<=start)continue;
      points.push({t:Math.max(start,e.ts),cat,delta:1},{t:Math.min(end,e.ts+e.dur),cat,delta:-1});
    }
    points.sort((a,b)=>a.t-b.t);
    const active=Object.fromEntries(categories.map(k=>[k,0]));let previous=start;
    for(const point of points){
      const cat=categories.find(k=>active[k]>0)??'frameWait';
      exclusive[cat]+=(point.t-previous)/1000/windows.length;
      if(point.cat)active[point.cat]+=point.delta;
      previous=point.t;
    }
  }
  const profile=JSON.parse(await readFile(stem+'.cpuprofile','utf8'));
  const nodes=new Map(profile.nodes.map(n=>[n.id,n]));
  const parents=new Map();
  for(const n of profile.nodes)for(const id of n.children??[])parents.set(id,n.id);
  const name=n=>n.callFrame.functionName+' '+source(n.callFrame.url,n.callFrame.lineNumber,n.callFrame.columnNumber);
  const self=new Map(),inclusive=new Map();
  let t=profile.startTime;
  for(let i=0;i<profile.samples.length;i++){
    const dt=profile.timeDeltas[i];t+=dt;
    if(!contained(t))continue;
    let n=nodes.get(profile.samples[i]);
    if(!n||['(root)','(idle)'].includes(n.callFrame.functionName))continue;
    self.set(name(n),(self.get(name(n))??0)+dt/1000);
    const seen=new Set();
    while(n){
      const key=name(n);
      if(!seen.has(key)){inclusive.set(key,(inclusive.get(key)??0)+dt/1000);seen.add(key);}
      n=nodes.get(parents.get(n.id));
    }
  }
  const top=m=>[...m].sort((a,b)=>b[1]-a[1]).slice(0,30).map(([name,ms])=>({name,msPerCommand:ms/windows.length}));
  const geometry=JSON.parse(await readFile(stem+'.geometry.json','utf8')).map(row=>({...row,stack:row.stack.replace(/(http:\/\/[^\s()]+):(\d+):(\d+)/g,(_,url,line,column)=>source(url,Number(line)-1,Number(column)-1))}));
  output.diagnostics[scenario]={windows:windows.length,exclusive,trace:top(totals),self:top(self),inclusive:top(inclusive),geometry:geometry.sort((a,b)=>b.ms-a.ms).slice(0,12)};
}
await writeFile(root+'/command-profile-summary.json',JSON.stringify(output,null,2));
console.log(JSON.stringify(output.measurements,null,2));
for(const [key,diag] of Object.entries(output.diagnostics))console.log(JSON.stringify({scenario:key,exclusive:diag.exclusive,trace:diag.trace.slice(0,12),self:diag.self.slice(0,10),inclusive:diag.inclusive.slice(0,15),geometry:diag.geometry.slice(0,4)},null,2));
