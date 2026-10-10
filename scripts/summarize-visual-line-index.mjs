import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root='artifacts/visual-line-index-2026-10-10';
const load=name=>readFile(root+'/'+name,'utf8').then(JSON.parse);
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const compare=(before,after)=>({before:+median(before).toFixed(2),after:+median(after).toFixed(2),changePercent:+((median(after)/median(before)-1)*100).toFixed(1),beforeRuns:before.map(v=>+v.toFixed(2)),afterRuns:after.map(v=>+v.toFixed(2))});
const commands=await load('command-profile.json'),replace=await load('replace-all-profile.json'),input=await load('input-performance.json');
const commandSummary={};
for(const [data,scenarios] of [[commands,['whole-sync','bold-shortcut']],[replace,['replace-all']]]){
  for(const scenario of scenarios){
    const rows=data.results.filter(r=>r.scenario===scenario);
    assert.equal(rows.length,6);
    for(let repeat=0;repeat<3;repeat++)assert.deepEqual(rows.find(r=>r.repeat===repeat&&r.version==='before').fingerprints,rows.find(r=>r.repeat===repeat&&r.version==='after').fingerprints);
    commandSummary[scenario]={};
    for(const [label,read] of Object.entries({syncMs:s=>s.sync,twoFramesMs:s=>s.twoFrames,scriptMs:s=>s.cpu.ScriptDuration,layoutMs:s=>s.cpu.LayoutDuration,styleMs:s=>s.cpu.RecalcStyleDuration})){
      commandSummary[scenario][label]=compare(...['before','after'].map(version=>rows.filter(r=>r.version===version).map(r=>median(r.samples.map(read)))));
    }
  }
}
assert.equal(input.results.length,6);
const inputSummary={};
for(const scenario of ['characterTyping','enters','ime']){
  inputSummary[scenario]={};
  const metrics={scriptMs:r=>r.mainThreadMsPerInput.ScriptDuration,layoutMs:r=>r.mainThreadMsPerInput.LayoutDuration,styleMs:r=>r.mainThreadMsPerInput.RecalcStyleDuration};
  if(scenario==='characterTyping')Object.assign(metrics,{syncMs:r=>r.sync.p50,paintMs:r=>r.paint.p50,settledMs:r=>r.settled.p50});
  else Object.assign(metrics,{p95FrameGapMs:r=>r.frameGap.p95});
  for(const [label,read] of Object.entries(metrics))inputSummary[scenario][label]=compare(...['before','after'].map(version=>input.results.filter(r=>r.version===version).map(r=>read(r[scenario]))));
  if(scenario!=='characterTyping')for(const row of input.results)assert.ok(row[scenario].textMatches&&row[scenario].undoRestores&&row[scenario].redoRestores&&row[scenario].selectionUnchangedByScroll);
}
const result={requestedChars:100000,repeats:3,statistic:'median of each run; commands exclude two warmups and retain eight samples per run',fingerprintsMatch:true,commandSummary,inputSummary};
await writeFile(root+'/summary.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
