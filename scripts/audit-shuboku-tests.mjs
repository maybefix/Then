// Run relevant existing checks without stopping at the first failure.
import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { writeAuditFile as writeFile } from "./lib/write-audit-file.mjs";
const allNames = ["v0511-themes", "appearance", "app-shell-style", "stored-state-model", "v0511-focus-mode", "app-dialog",
  "left-sidebar", "right-sidebar", "command-palette", "editor-context-menu-layout", "properties-ui", "status-bar-layout",
  "typewriter-scroll", "code-blocks", "markdown-tables", "canvas-board-save"];
const directory="docs/shuboku-audit";
const only=process.argv.indexOf('--only');
const names=only>=0?process.argv[only+1].split(','):allNames;
await mkdir(directory,{recursive:true});
const results=[];
for(const name of names){
 const file=`scripts/test-${name}.mjs`;
 const result=spawnSync(process.execPath,[file],{encoding:"utf8",timeout:90000,windowsHide:true});
 const log=(result.stdout??'')+(result.stderr??'');
 await writeFile(`${directory}/test-${name}.log`,log);
 const row={name,file,exitCode:result.status,signal:result.signal,error:result.error?.message??null,
  summary:log.split(/\r?\n/).filter(l=>/passed|PASS|AssertionError|Error:|SyntaxError|ERR_/.test(l)).slice(0,5)};
 results.push(row);console.log(`${result.status===0?'PASS':'FAIL'} ${name}: ${row.summary.join(' / ')}`);
}
let merged=results;
if(only>=0){const prior=JSON.parse(await readFile(`${directory}/tests.json`,'utf8'));merged=prior.results.map(old=>{
 const next=results.find(r=>r.name===old.name);return next?{...next,previousAttempt:{exitCode:old.exitCode,summary:old.summary}}:old;
});}
await writeFile(`${directory}/tests.json`,JSON.stringify({generatedAt:new Date().toISOString(),results:merged},null,2));
console.log(`${results.filter(r=>r.exitCode===0).length}/${results.length} checks passed; results saved to ${directory}`);
if(merged.some(r=>r.exitCode!==0))process.exitCode=1;
