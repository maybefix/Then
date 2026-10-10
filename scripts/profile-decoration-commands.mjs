// Fresh-document command profiles; no scenario inherits a broken decoration state.
import { readFile } from 'node:fs/promises';

async function profileCommands({ page, evaluate, scenario, version, repeat, diagnostic }) {
  await page.send('Performance.enable', { timeDomain: 'threadTicks' });
  const metrics = async () => Object.fromEntries((await page.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const pluginState = await evaluate(`(() => {
    const root=document.querySelector('.ProseMirror');
    return {chars:root.textContent.length,paragraphs:root.childElementCount,missing:[...root.children].filter(p=>!p.classList.contains('pm-line')).length};
  })()`);
  if (pluginState.missing) throw new Error('Initial decorations are missing');
  if(scenario==='replace-all'){
    await evaluate(`(async () => {
      const root=document.querySelector('.ProseMirror'),editor=root.editor;
      const index=Math.floor(editor.state.doc.childCount*.3);let pos=1;for(let i=0;i<index;i++)pos+=editor.state.doc.child(i).nodeSize;
      editor.view.dispatch(editor.state.tr.insertText('unique-token-A',pos));editor.view.focus();
      root.dispatchEvent(new KeyboardEvent('keydown',{key:'f',code:'KeyF',ctrlKey:true,bubbles:true,cancelable:true}));
      await new Promise(r=>setTimeout(r,100));document.querySelector('button[aria-label="置換を表示"]').click();
      window.__setFindValue=(label,value)=>{const input=document.querySelector('input[aria-label="'+label+'"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
      await new Promise(r=>setTimeout(r,100));return true;
    })()`);
  }
  if(flag('input-hooks'))await evaluate(`(() => {
    const editor=document.querySelector('.ProseMirror').editor;window.__inputHookTimes=[];
    for(const name of ['transaction','selectionUpdate','update'])editor.callbacks[name]=editor.callbacks[name].map((callback,index)=>function(...args){
      const start=performance.now();try{return callback.apply(this,args);}finally{if(window.__inCommand)window.__inputHookTimes.push({name,index,ms:performance.now()-start});}
    });return true;
  })()`);
  await evaluate(`window.__profileCommand = async (scenario) => {
    const root=document.querySelector('.ProseMirror'),editor=root.editor;
    const frame=()=>new Promise(requestAnimationFrame);
    const doc=editor.state.doc;
    let index=Math.floor(doc.childCount*.3);
    while(!doc.child(index).content.size)index++;
    let pos=1;for(let n=0;n<index;n++)pos+=doc.child(n).nodeSize;
    const text=doc.child(index).textContent;
    const from=pos+(text.startsWith('**')?2:0);
    editor.commands.setTextSelection({from,to:from+3});editor.view.focus();
    let token,nextToken;
    if(scenario==='replace-all'){
      token=doc.textContent.includes('unique-token-A')?'unique-token-A':'unique-token-B';
      nextToken=token==='unique-token-A'?'unique-token-B':'unique-token-A';
      window.__setFindValue('検索語句',token);window.__setFindValue('置換後',nextToken);
    }
    await frame();await frame();
    await new Promise(r=>setTimeout(r,250));
    window.__profileGo=async()=>{
      const before=editor.state.doc.textBetween(0,editor.state.doc.content.size,'\\n');
      window.__inCommand=true;performance.mark('command-start');
      const start=performance.now();
      if(scenario==='replace-all'){
        const button=[...document.querySelectorAll('.editorReplaceRow button')].find(b=>b.textContent==='すべて');
        if(!button||button.disabled)throw new Error('Replace-all not ready');button.click();
      }else if(scenario==='character-input'){
        document.execCommand('insertText',false,'あ');
      }else if(scenario==='whole-sync'){
        const content=editor.state.doc.toJSON();
        content.content[index].content[0].text+='追';
        editor.commands.setContent(content,false);editor.commands.setTextSelection(from);
      }else if(scenario==='local-append'){
        editor.view.dispatch(editor.state.tr.insertText('追',pos+doc.child(index).content.size).setMeta('preventUpdate',true));
        editor.commands.setTextSelection(from);
      }else{
        const event=new KeyboardEvent('keydown',{key:'b',code:'KeyB',ctrlKey:true,bubbles:true,cancelable:true});
        root.dispatchEvent(event);if(!event.defaultPrevented)throw new Error('Ctrl+B not handled');
      }
      const sync=performance.now()-start;performance.mark('command-sync-end');
      await frame();await frame();
      const twoFrames=performance.now()-start;performance.mark('command-frames-end');window.__inCommand=false;
      const after=editor.state.doc.textBetween(0,editor.state.doc.content.size,'\\n');
      if(scenario==='replace-all'&&after!==before.replace(token,nextToken))throw new Error('Unexpected replace-all text');
      if(scenario==='whole-sync'||scenario==='local-append'){
        const expected=before.split('\\n');expected[index]+='追';
        if(after!==expected.join('\\n'))throw new Error('Unexpected text after append');
      }
      return {sync,twoFrames,changed:before!==after,chars:after.length};
    };
    return true;
  }; true`);
  // Instrument only separate diagnostic runs, leaving the primary measurements alone.
  if (diagnostic) await evaluate(`(() => {
    const rows=window.__geometryRows=[];
    const instrument=(proto,name)=>{
      const original=proto[name];
      proto[name]=function(...args){
        const start=performance.now();
        const result=original.apply(this,args);
        const ms=performance.now()-start;
        if(ms>1 && window.__inCommand)rows.push({name,ms,stack:new Error().stack});
        return result;
      };
    };
    instrument(Element.prototype,'getBoundingClientRect');
    instrument(Range.prototype,'getBoundingClientRect');
    instrument(Range.prototype,'getClientRects');
    return true;
  })()`);
  const traces=[];
  const originalEvents=page.onEvent;
  let tracingDone;
  if(diagnostic){
    page.onEvent=message=>{
      originalEvents?.(message);
      if(message.method==='Tracing.dataCollected')traces.push(...message.params.value);
      if(message.method==='Tracing.tracingComplete')tracingDone?.();
    };
    await page.send('Tracing.start',{traceConfig:{includedCategories:['devtools.timeline','disabled-by-default-devtools.timeline','blink.user_timing','v8.execute']}});
    await page.send('Profiler.enable');
    await page.send('Profiler.setSamplingInterval',{interval:250});
    await page.send('Profiler.start');
  }
  const samples=[];
  for(let sample=0;sample<(diagnostic?3:10);sample++){
    await evaluate(`window.__profileCommand(${JSON.stringify(scenario)})`);
    const before=await metrics();
    const timing=await evaluate('window.__profileGo()');
    const after=await metrics();
    if(!timing.changed)throw new Error('Command did not change text');
    const cpu=Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount'].map(k=>[k,(after[k]-before[k])*(k.endsWith('Count')?1:1000)]));
    if(sample>=2 || diagnostic)samples.push({...timing,cpu});
  }
  let profile=null;
  if(diagnostic){
    profile=(await page.send('Profiler.stop')).profile;
    const done=new Promise(r=>tracingDone=r);
    await page.send('Tracing.end');await done;
    page.onEvent=originalEvents;
  }
  const missing=await evaluate(`[...document.querySelector('.ProseMirror').children].filter(p=>!p.classList.contains('pm-line')).length`);
  if(version==='after'&&missing)throw new Error('Final decorations missing');
  const geometry=diagnostic?await evaluate('window.__geometryRows'):null;
  const state=await evaluate(`(() => {
    const editor=document.querySelector('.ProseMirror').editor;
    const plugin=editor.state.plugins.find(p=>p.key.startsWith('then-layout-ast'));
    const ast=plugin.getState(editor.state);
    return {doc:JSON.stringify(editor.state.doc.toJSON()),selection:JSON.stringify(editor.state.selection.toJSON()),decorations:JSON.stringify(ast.decoSet.find().map(d=>[d.from,d.to,d.type.attrs??d.spec]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))};
  })()`);
  const {createHash}=await import('node:crypto');
  const fingerprints=Object.fromEntries(Object.entries(state).map(([k,v])=>[k,createHash('sha256').update(v).digest('hex')]));
  const result={version,scenario,repeat,diagnostic,initial:pluginState,missing,samples,fingerprints};
  if(flag('input-hooks'))result.hookTimes=await evaluate('window.__inputHookTimes');
  if(diagnostic){
    const stem=option('output-dir','artifacts/decoration-mapping-2026-10-10')+'/'+version+'-'+scenario;
    await writeFile(stem+'.trace.json',JSON.stringify({traceEvents:traces}));
    await writeFile(stem+'.cpuprofile',JSON.stringify(profile));
    await writeFile(stem+'.geometry.json',JSON.stringify(geometry,null,2));
  }
  console.log(JSON.stringify(result));
  return result;
}

let harness=await readFile(new URL('./benchmark-typing.mjs',import.meta.url),'utf8');
harness=harness.replace('console.error(error);','console.error(error.message ?? String(error));');
harness=harness.replace('"./lib/typewriter-benchmark.mjs"',JSON.stringify(new URL('./lib/typewriter-benchmark.mjs',import.meta.url).href));
const setupStart=harness.indexOf('  await page.send("Page.navigate", { url: appUrl });');
const setupEnd=harness.indexOf('  // Main-thread time per keystroke.');
const close=harness.indexOf('  page.close();');
if(setupStart<0||setupEnd<0||close<0)throw new Error('Harness changed');
const setup=harness.slice(setupStart,setupEnd);
const loop=`
  const results=[];
  const repeats=Number(option('repeats',3));
  const diagnostic=flag('diagnostic');
  for(let repeat=0;repeat<repeats;repeat++){
    for(const version of (flag('after-only')?['after']:(repeat%2?['after','before']:['before','after']))){
      for(const scenario of (option('scenarios',null)?.split(',')??['whole-sync','bold-shortcut',...(version==='after'?['local-append']:[])])){
        dist=version==='after'?option('after-dist','artifacts/decoration-mapping-2026-10-10/validated-dist'):option('before-dist','artifacts/decoration-mapping-2026-10-10/before-dist');
        ${setup}
        results.push(await profileCommands({page,evaluate,scenario,version,repeat,diagnostic}));
        if(pageErrors.length)throw new Error(pageErrors.join('\\n'));
        await writeFile(option('output','artifacts/decoration-mapping-2026-10-10/command-profile.json'),JSON.stringify({repeats,diagnostic,results},null,2));
      }
    }
    const equivalent=results.filter(r=>r.repeat===repeat&&r.version==='after'&&['whole-sync','local-append'].includes(r.scenario));
    if(equivalent.length===2&&JSON.stringify(equivalent[0].fingerprints)!==JSON.stringify(equivalent[1].fingerprints))throw new Error('Whole/local final states differ');
  }
`;
harness=profileCommands.toString()+'\n'+harness.slice(0,setupStart)+loop+harness.slice(close);
await import('data:text/javascript;base64,'+Buffer.from(harness).toString('base64'));
