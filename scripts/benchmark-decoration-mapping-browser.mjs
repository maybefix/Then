// Paired comparisons in one isolated Edge, alternating build order each round.
// All project data is the benchmark's in-memory backend.
import { readFile } from "node:fs/promises";

async function runMappingBrowserScenarios({ page, evaluate, repeat, version }) {
  await page.send("Performance.enable", {timeDomain:"threadTicks"});
  const measure = async (action, samples) => {
    const metrics = async () => Object.fromEntries((await page.send("Performance.getMetrics")).metrics.map(m=>[m.name,m.value]));
    const before = await metrics();
    const result = await action();
    const after = await metrics();
    result.mainThreadMsPerInput = Object.fromEntries(["TaskDuration","ScriptDuration","LayoutDuration","RecalcStyleDuration"].map(key=>[key,(after[key]-before[key])*1000/samples]));
    return result;
  };
  const characterTyping = await measure(()=>evaluate("window.__benchType()"), SAMPLES);
  // The installed History extension groups adjacent edits for 500ms. Leave
  // that group before checking the next scenario's independent Undo result.
  await new Promise(resolve=>setTimeout(resolve,650));
  const enters = await measure(()=>runTypewriterBenchmark({ page, evaluate, samples:12, scenario:"typing" }),12);
  await new Promise(resolve=>setTimeout(resolve,650));
  const ime = await measure(()=>runTypewriterBenchmark({ page, evaluate, samples:8, scenario:"ime" }),8);
  const commands = flag('skip-commands') ? {} : await evaluate(`(async () => {
    const root=document.querySelector('.ProseMirror'), editor=root.editor;
    const frame=()=>new Promise(requestAnimationFrame);
    const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return {p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))],max:sorted.at(-1)};};
    const result={};
    for(const scenario of ['whole-sync','bold-shortcut']){
      const sync=[],paint=[];let changed=0;
      for(let i=0;i<15;i++){
        const doc=editor.state.doc;
        let index=Math.floor(doc.childCount*.3);
        while(!doc.child(index).content.size)index++;
        let pos=1;for(let n=0;n<index;n++)pos+=doc.child(n).nodeSize;
        const text=doc.child(index).textContent;
        const from=pos+(text.startsWith('**')?2:0);
        editor.commands.setTextSelection({from,to:from+3});
        editor.view.focus();
        await frame();await frame();
        const before=editor.state.doc.textBetween(0,editor.state.doc.content.size,'\\n');
        const start=performance.now();
        if(scenario==='whole-sync'){
          const content=editor.state.doc.toJSON();
          const paragraph=content.content[index];
          paragraph.content[0].text+='追';
          editor.commands.setContent(content,false);
          editor.commands.setTextSelection(from);
        }else{
          const event=new KeyboardEvent('keydown',{key:'b',code:'KeyB',ctrlKey:true,bubbles:true,cancelable:true});
          root.dispatchEvent(event);
          if(!event.defaultPrevented)throw new Error('Ctrl+B was not handled');
        }
        const elapsed=performance.now()-start;
        await frame();await frame();
        const painted=performance.now()-start;
        const after=editor.state.doc.textBetween(0,editor.state.doc.content.size,'\\n');
        if(before!==after)changed++;
        if(i>=3){sync.push(elapsed);paint.push(painted);}
      }
      result[scenario]={sync:stats(sync),twoFrames:stats(paint),changed,missingParagraphClasses:[...root.children].filter(p=>!p.classList.contains('pm-line')).length};
    }
    return result;
  })()`);
  const row = { repeat, version, characterTyping, enters, ime, commands };
  for(const [name, result] of Object.entries(commands)){
    if(result.changed!==15)throw new Error(name+" did not change the document on every invocation");
    if(version==="after" && result.missingParagraphClasses!==0)throw new Error(name+" lost paragraph decorations");
  }
  console.log(JSON.stringify(row));
  return row;
}

let harness = await readFile(new URL("./benchmark-typing.mjs", import.meta.url), "utf8");
harness = harness.replace('console.error(error);', 'console.error(error.message ?? String(error));');
harness = harness.replace('"./lib/typewriter-benchmark.mjs"', JSON.stringify(new URL("./lib/typewriter-benchmark.mjs", import.meta.url).href));
const setupStart = harness.indexOf('  await page.send("Page.navigate", { url: appUrl });');
const setupEnd = harness.indexOf('  // Main-thread time per keystroke.');
const close = harness.indexOf('  page.close();');
if (setupStart < 0 || setupEnd < 0 || close < 0) throw new Error("Benchmark harness changed");
const setup = harness.slice(setupStart, setupEnd);
const loop = `
  await page.send("Network.enable");
  await page.send("Network.setCacheDisabled", {cacheDisabled:true});
  const pairedResults=[];
  const repeats=Number(option("repeats",5));
  for(let repeat=0;repeat<repeats;repeat++){
    for(const version of repeat%2 ? ["after","before"] : ["before","after"]){
      dist=option(version+"-dist", "artifacts/decoration-mapping-2026-10-10/"+version+"-dist");
      ${setup}
      pairedResults.push(await runMappingBrowserScenarios({page,evaluate,repeat,version}));
      if(pageErrors.length)throw new Error(pageErrors.join("\\n"));
      await writeFile(option("output","artifacts/decoration-mapping-2026-10-10/browser-performance.json"),JSON.stringify({repeats,requestedChars:CHARS,results:pairedResults},null,2));
    }
  }
`;
harness = `${runMappingBrowserScenarios.toString()}\n${harness.slice(0, setupStart)}${loop}${harness.slice(close)}`;
await import(`data:text/javascript;base64,${Buffer.from(harness).toString("base64")}`);
