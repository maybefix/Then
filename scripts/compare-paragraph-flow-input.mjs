import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const folder='artifacts/paragraph-flow-qa-2026-10-10/input-comparison';
await mkdir(folder,{recursive:true});
const configurations=[
  {mode:'vertical-rl',display:'continuous'},
  {mode:'horizontal-tb',display:'continuous'},
  {mode:'vertical-rl',display:'paged'},
  {mode:'horizontal-tb',display:'paged'},
];
const plan=[];
for(let repeat=0;repeat<3;repeat++)for(const config of configurations){
  for(const version of repeat%2?['after','before']:['before','after'])plan.push({repeat,...config,version,label:`${config.mode}-${config.display}-r${repeat}-${version}`});
}
const assets={};
for(const version of ['before','after']){
  const root=`artifacts/paragraph-flow-qa-2026-10-10/${version}-dist`;
  const index=await readFile(root+'/index.html','utf8');
  const asset=index.match(/src="([^"]+\.js)"/)[1];
  assets[version]={root,asset,sha256:createHash('sha256').update(await readFile(root+asset)).digest('hex')};
}
await writeFile(folder+'/plan.json',JSON.stringify({repetitions:3,samplesPerPhase:24,warmupPerPhase:12,requestedChars:100000,
  project:'memory mock; identical project/count/sidebar work in both conditions',assets,plan},null,2));
const results=[];
for(const run of plan){
  console.log('START '+run.label);
  const args=['scripts/benchmark-paragraph-flow-input.mjs','--qa-production','--project','--typewriter','--at','middle',
    '--chars','100000','--samples','24','--warmup-input','12','--line-numbers','--highlight-line','--line-breaks',
    '--writing-mode',run.mode,'--display',run.display,'--dist',assets[run.version].root,'--label',run.label,'--output',`${folder}/${run.label}.json`];
  const child=spawnSync(process.execPath,args,{encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true});
  await writeFile(`${folder}/${run.label}.log`,child.stdout+'\n'+child.stderr);
  if(child.status!==0)throw new Error(`${run.label} failed (status ${child.status}): ${child.stderr.slice(0,1600)}`);
  const report=JSON.parse(await readFile(`${folder}/${run.label}.json`,'utf8'));
  for(const phase of report.phases){
    assert.equal(phase.metadata.writingMode,run.mode);
    assert.equal(phase.metadata.display,run.display);
    assert.equal(Boolean(phase.metadata.flowBefore),run.version==='after');
    assert.ok(phase.validation.sourceMatches&&phase.validation.countsMatch);
    assert.equal(phase.samples,24);
  }
  results.push({...run,report});
  console.log(JSON.stringify({completed:results.length,total:plan.length,label:run.label,phases:report.phases.map(p=>({operation:p.operation,cpu:p.cpuMillisecondsPerInput,latencyP95:p.latency.secondRaf.p95,paragraphReads:p.validation.flowDelta?.paragraphReads}))}));
}
const median=values=>{const a=[...values].sort((a,b)=>a-b);return a[Math.floor(a.length/2)];};
const summarize=values=>({median:median(values),min:Math.min(...values),max:Math.max(...values),values});
const comparisons=[];
for(const config of configurations)for(const operation of ['insert','enter']){
  const conditions={};
  for(const version of ['before','after']){
    const reports=results.filter(run=>run.mode===config.mode&&run.display===config.display&&run.version===version).map(run=>run.report.phases.find(p=>p.operation===operation));
    conditions[version]={cpu:Object.fromEntries(Object.keys(reports[0].cpuMillisecondsPerInput).map(key=>[key,summarize(reports.map(p=>p.cpuMillisecondsPerInput[key]))])),
      syncP50:summarize(reports.map(p=>p.latency.sync.p50)),secondRafP50:summarize(reports.map(p=>p.latency.secondRaf.p50)),secondRafP95:summarize(reports.map(p=>p.latency.secondRaf.p95))};
  }
  const pairedChanges=conditions.before.cpu.TaskDuration.values.map((before,i)=>(conditions.after.cpu.TaskDuration.values[i]/before-1)*100);
  comparisons.push({...config,operation,conditions,taskChangePercent:summarize(pairedChanges)});
}
const summary={status:'MEASURED',assets,repetitions:3,completedRuns:results.length,measuredInputs:results.length*2*24,
  validation:'Exact source and status/sidebar counts passed on every phase; QA paragraph/page geometry checked outside timing',
  inheritedHiddenCommentBug:'Confirmed separately in installed 0.6.6 and both builds; timing fixture contains no hidden comments; application bug remains unfixed',
  runtime:results[0].report.runtime,comparisons};
await writeFile(folder+'/summary.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify({status:summary.status,completedRuns:summary.completedRuns,comparisons:comparisons.map(c=>({mode:c.mode,display:c.display,operation:c.operation,beforeTask:c.conditions.before.cpu.TaskDuration.median,afterTask:c.conditions.after.cpu.TaskDuration.median,pairedChangePercent:c.taskChangePercent.median}))}));
