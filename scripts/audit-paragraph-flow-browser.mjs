// Shadow experiment only: production layout remains unchanged.
// Candidate reads dirty paragraphs; independent oracle reads every paragraph.
import { readFile } from 'node:fs/promises';

function installFlowCandidate() {
  const root = document.querySelector('.ProseMirror');
  let elements = [], structureDirty = true, signature = '', vertical = true;
  const entries = new Map(), dirty = new Set();
  let totalReads = 0, globalResets = 0, last = null;
  const ownBlock = node => {
    let el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el.parentElement !== root) el = el.parentElement;
    return el?.parentElement === root ? el : null;
  };
  const collect = records => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target.getAttribute(record.attributeName) === record.oldValue) continue;
      if (record.target === root) {
        if (record.type === 'childList') structureDirty = true;
      } else {
        const block = ownBlock(record.target);
        if (block) dirty.add(block);
      }
    }
  };
  const mutation = new MutationObserver(collect);
  mutation.observe(root, {subtree:true, childList:true, characterData:true, attributes:true, attributeOldValue:true});
  const resize = new ResizeObserver(records => {
    for (const record of records) {
      const cached = entries.get(record.target), size = record.borderBoxSize[0];
      if (!cached || !size || Math.abs(cached.size - size.blockSize) > 1e-7 || Math.abs(cached.inlineSize - size.inlineSize) > 1e-7) dirty.add(record.target);
    }
  });
  const invalidate = () => { signature = ''; };
  document.fonts.addEventListener('loadingdone', invalidate);
  function flush() {
    collect(mutation.takeRecords());
    const style = getComputedStyle(root), rect = root.getBoundingClientRect();
    vertical = style.writingMode === 'vertical-rl';
    const nextSignature = JSON.stringify([
      style.writingMode, vertical ? style.height : style.width,
      style.fontFamily, style.fontSize, style.lineHeight, style.letterSpacing,
      style.paddingTop, style.paddingRight, style.borderTopWidth, style.borderRightWidth,
      root.closest('.verticalTypewriterShell').dataset.editorDisplay,
      ...['--editor-measure-v-ratio','--editor-measure-h-ratio','--editor-heading-font-family','--editor-code-font-family'].map(p=>style.getPropertyValue(p)),
    ]);
    if (nextSignature !== signature) {
      signature = nextSignature; globalResets++;
      for (const el of elements) dirty.add(el);
    }
    if (structureDirty) {
      const next = [...root.children], keep = new Set(next);
      for (const el of elements) if (!keep.has(el)) { resize.unobserve(el); entries.delete(el); dirty.delete(el); }
      for (const el of next) if (!entries.has(el)) { dirty.add(el); resize.observe(el, {box:'border-box'}); }
      elements = next; structureDirty = false;
    }
    let reads = 0;
    for (const el of dirty) {
      if (el.parentElement !== root) continue;
      const bounds = el.getBoundingClientRect(), css = getComputedStyle(el);
      const hidden = css.display === 'none';
      const range = document.createRange(); range.selectNodeContents(el);
      const fragments = [...range.getClientRects()].map(r=>({left:r.left-bounds.left,right:r.right-bounds.left,top:r.top-bounds.top,bottom:r.bottom-bounds.top}));
      entries.set(el, {
        hidden, size:vertical?bounds.width:bounds.height, inlineSize:vertical?bounds.height:bounds.width,
        inline:vertical?bounds.top-rect.top:bounds.left-rect.left,
        fragments, linePitch:parseFloat(css.lineHeight)||0,
        marginStart:parseFloat(vertical?css.marginRight:css.marginTop)||0,
        marginEnd:parseFloat(vertical?css.marginLeft:css.marginBottom)||0,
        position:css.position, float:css.cssFloat, transform:css.transform,
      });
      reads++; totalReads++;
    }
    dirty.clear();
    let offset = parseFloat(vertical?style.paddingRight:style.paddingTop) + (parseFloat(vertical?style.borderRightWidth:style.borderTopWidth)||0);
    const predicted = elements.map(el=>{
      const entry=entries.get(el);
      if(entry.hidden)return {el,entry,hidden:true};
      offset += entry.marginStart;
      const left=vertical?rect.right-offset-entry.size:rect.left+entry.inline;
      const top=vertical?rect.top+entry.inline:rect.top+offset;
      const result={el,entry,left,top,right:left+(vertical?entry.size:entry.inlineSize),bottom:top+(vertical?entry.inlineSize:entry.size),blockStart:offset};
      offset += entry.size + entry.marginEnd;
      return result;
    });
    last={predicted, reads, totalReads, globalResets, vertical, root:rect, extent:offset};
    return last;
  }
  function check() {
    const candidate=flush(); // Oracle must never feed the candidate.
    let maxError=0, fragmentError=0, checkedFragments=0;
    const findings=[];
    candidate.predicted.forEach((prediction,index)=>{
      const actual=prediction.el.getBoundingClientRect(),css=getComputedStyle(prediction.el);
      const error=prediction.hidden?(actual.width||actual.height):Math.max(...['left','right','top','bottom'].map(k=>Math.abs(prediction[k]-actual[k])));
      maxError=Math.max(maxError,error);
      if(error>1/32)findings.push({index,error,kind:'block',text:prediction.el.textContent.slice(0,45),entry:prediction.entry,prediction:{left:prediction.left,top:prediction.top},actual:{left:actual.left,top:actual.top}});
      if(!prediction.hidden && (prediction.entry.marginStart || prediction.entry.marginEnd || css.cssFloat!=='none' || !['static','relative'].includes(css.position) || css.transform!=='none'))findings.push({index,kind:'unsupported flow rule'});
      const range=document.createRange();range.selectNodeContents(prediction.el);
      const actualFragments=[...range.getClientRects()];
      if(actualFragments.length!==prediction.entry.fragments.length)findings.push({index,kind:'fragment count',actual:actualFragments.length,predicted:prediction.entry.fragments.length});
      actualFragments.forEach((fragment,j)=>{
        const local=prediction.entry.fragments[j];if(!local)return;
        const error=prediction.hidden?0:Math.max(...['left','right'].map(k=>Math.abs(prediction.left+local[k]-fragment[k])),...['top','bottom'].map(k=>Math.abs(prediction.top+local[k]-fragment[k])));
        fragmentError=Math.max(fragmentError,error);checkedFragments++;
        if(error>1/32 && findings.length<10)findings.push({index,fragment:j,kind:'fragment',error});
      });
    });
    return {paragraphs:elements.length,reads:candidate.reads,totalReads,globalResets,maxError,fragmentError,checkedFragments,findings:findings.slice(0,10)};
  }
  return window.__flowCandidate={flush,check,invalidate,dispose:()=>{mutation.disconnect();resize.disconnect();document.fonts.removeEventListener('loadingdone',invalidate);}};
}

async function auditParagraphFlow({page,evaluate}) {
  const results=[];
  const action=source=>evaluate(`(()=>{const root=document.querySelector('.ProseMirror'),editor=root.editor;${source};return true;})()`);
  const check=async label=>{
    await new Promise(r=>setTimeout(r,180));
    const result=await evaluate('window.__flowCandidate.check()');
    if(process.argv.includes('--qa-production')) {
      const production=await evaluate(`(()=>{
        const root=document.querySelector('.ProseMirror');
        if(!root.__paragraphFlowQA)throw new Error('QA production flow is not enabled');
        const {snapshot,stats}=root.__paragraphFlowQA();
        const vertical=getComputedStyle(root).writingMode==='vertical-rl',bounds=root.getBoundingClientRect();
        let maxError=0,pageMeasureError=0;
        for(let i=0;i<root.children.length;i++){
          const el=root.children[i],rect=el.getBoundingClientRect(),css=getComputedStyle(el);
          maxError=Math.max(maxError,...['left','right','top','bottom'].map(k=>Math.abs(snapshot.blocks[i][k]-rect[k])));
          const pitch=parseFloat(css.lineHeight),size=vertical?rect.width:rect.height;
          const expected={lineCount:Number.isFinite(pitch)&&pitch>0?Math.max(1,Math.round(size/pitch)):0,
            linePitch:Number.isFinite(pitch)&&pitch>0?pitch:0,gapBefore:parseFloat(vertical?css.marginRight:css.marginTop)||0,
            blockStart:vertical?bounds.right-rect.right:rect.top-bounds.top};
          for(const k of Object.keys(expected))pageMeasureError=Math.max(pageMeasureError,Math.abs(snapshot.paragraphs[i][k]-expected[k]));
        }
        return {paragraphs:snapshot.elements.length,maxError,pageMeasureError,generation:snapshot.generation,reads:snapshot.reads,stats};
      })()`);
      result.production=production;
      if(production.maxError>1/32 || production.pageMeasureError>1/32)throw new Error(JSON.stringify({label,production}));
    }
    results.push({label,...result});
    if(process.argv.includes('--progress'))console.log(JSON.stringify({label,reads:result.reads,maxError:result.maxError,fragmentError:result.fragmentError}));
    if(result.findings.length)throw new Error(JSON.stringify({label,...result}));
  };
  const settings=async(label,value)=>{
    await evaluate(`document.querySelector('button[aria-label="設定"]').click();true`);
    await new Promise(r=>setTimeout(r,80));
    await evaluate(`document.getElementById('settings-tab-body').click();true`);
    await evaluate(`(()=>{const label=[...document.querySelectorAll('.settingsModal label')].find(l=>l.textContent.includes(${JSON.stringify(label)})&&l.querySelector('select'));const select=label.querySelector('select');select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
    await new Promise(r=>setTimeout(r,80));
    await evaluate(`document.querySelector('.settingsModal button[aria-label="閉じる"]').click();true`);
    await action('editor.view.focus()');
  };
  await action(`window.__pos=(index,offset=0)=>{let pos=1;for(let n=0;n<index;n++)pos+=editor.state.doc.child(n).nodeSize;return pos+offset;};
    window.__rich=Array.from({length:240},(_,i)=>[
      '# 見出し'+i,'## 中見出し'+i,'本文「引用」 **太字** と｜東京《とうきょう》。'.repeat(5),
      '- 箇条書きと _斜体_','  12. 入れ子の箇条書き','// コメント行'+i,'',
      '| 列甲 | 列乙 |','| --- | --- |','| 表本文 | |','~~~','コード **記号**','~~~',
      '12345678901234567890。English mixed text.','###### 小見出し',
    ][i%15]);
    editor.commands.setContent({type:'doc',content:window.__rich.map(text=>({type:'paragraph',...(text?{content:[{type:'text',text}]}:{})}))});
    editor.commands.setTextSelection(window.__pos(32,12));editor.view.focus()`);
  await new Promise(r=>setTimeout(r,300));
  await evaluate(`(${installFlowCandidate.toString()})();true`);
  await check('initial rich document');
  await check('initial ResizeObserver delivery');
  if(process.argv.includes('--overhead-only')) {
    await evaluate('window.__flowCandidate.dispose();delete window.__flowCandidate;true');
    await action(`editor.commands.setContent({type:'doc',content:Array.from({length:2139},(_,i)=>({type:'paragraph',content:[{type:'text',text:'本文の配置を測るための文章。'.repeat(3)+i}]}))});editor.commands.setTextSelection(window.__pos(1020,8))`);
    await new Promise(r=>setTimeout(r,500));
    const metadata=await evaluate(`(()=>{const root=document.querySelector('.ProseMirror');return {paragraphs:root.children.length,characters:root.editor.getText().length,writingMode:getComputedStyle(root).writingMode,display:root.closest('.verticalTypewriterShell').dataset.editorDisplay};})()`);
    const metrics=async()=>Object.fromEntries((await page.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
    const measurements=[];
    const operations=`(async()=>{
      const editor=document.querySelector('.ProseMirror').editor;let reads=0;
      for(let i=0;i<24;i++){
        const pos=window.__pos(1020,8);editor.view.dispatch(editor.state.tr.insertText(i%2?'甲':'乙',pos,pos+1));
        if(window.__flowCandidate)reads+=window.__flowCandidate.flush().reads;
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      }
      return {operations:24,reads};
    })()`;
    for(let repeat=0;repeat<3;repeat++)for(const candidate of (repeat%2?[true,false]:[false,true])) {
      await evaluate('window.__flowCandidate?.dispose();delete window.__flowCandidate;true');
      if(candidate)await evaluate(`(${installFlowCandidate.toString()})();window.__flowCandidate.flush();true`);
      await new Promise(r=>setTimeout(r,350));
      await evaluate(operations); // Warm up both paths; exclude initial observer delivery.
      const before=await metrics();const ops=await evaluate(operations);const after=await metrics();
      const cpu={};for(const key of ['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'])cpu[key]=(after[key]-before[key])*1000/ops.operations;
      const measurement={repeat,candidate,...ops,cpuMillisecondsPerOperation:cpu};measurements.push(measurement);console.log(JSON.stringify(measurement));
    }
    await evaluate('window.__flowCandidate?.dispose();delete window.__flowCandidate;true');
    return {experiment:'incremental observer and candidate update cost with production still performing its own full reads in both conditions',metadata,measurements};
  }
  if(process.argv.includes('--timing-only')) {
    const phases=[];
    const compact=value=>({...value,findings:value.findings.map(({kind,index,error})=>({kind,index,error}))});
    const phase=async(label,source,expectImmediateFailure=false)=>{
      const immediate=await evaluate(`(()=>{const root=document.querySelector('.ProseMirror'),editor=root.editor;${source};return window.__flowCandidate.check();})()`);
      const settled=await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(window.__flowCandidate.check()))))`);
      if(Boolean(immediate.findings.length)!==expectImmediateFailure || settled.findings.length)throw new Error(JSON.stringify({label,immediate:compact(immediate),settled:compact(settled)}));
      phases.push({label,expectedImmediateFailure:expectImmediateFailure,immediate:compact(immediate),settled:compact(settled)});
    };
    await phase('synchronous local text edit',`editor.view.dispatch(editor.state.tr.insertText('追記。'.repeat(40),window.__pos(2,8)))`);
    await phase('synchronous table tracks edit',`editor.view.dispatch(editor.state.tr.insertText('表の変更'.repeat(25),window.__pos(9,2)))`);
    await phase('synchronous paragraph split',`editor.commands.setTextSelection(window.__pos(32,8));root.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}))`);
    await phase('synchronous undo',`editor.commands.undo()`);
    await phase('synchronous root font setting',`root.style.fontSize='23.7px';root.style.lineHeight='1.731'`);
    await phase('synchronous paragraph style mutation',`root.children[2].style.fontSize='28.3px'`);
    await phase('stylesheet change without explicit invalidation: negative control',`window.__flowTestStyle=document.createElement('style');window.__flowTestStyle.textContent='.ProseMirror > p:nth-child(18) {font-size:31.7px !important}';document.head.append(window.__flowTestStyle)`,true);
    await phase('stylesheet restoration without explicit invalidation: negative control',`window.__flowTestStyle.remove()`,true);
    const rafPhase=await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>{
      const root=document.querySelector('.ProseMirror');
      window.__flowTestStyle=document.createElement('style');window.__flowTestStyle.textContent='.ProseMirror > p:nth-child(18) {font-size:31.7px !important}';document.head.append(window.__flowTestStyle);
      const firstRaf=window.__flowCandidate.check();
      requestAnimationFrame(()=>resolve({firstRaf,nextRaf:window.__flowCandidate.check()}));
    }))`);
    if(!rafPhase.firstRaf.findings.length || rafPhase.nextRaf.findings.length)throw new Error('Unexpected ResizeObserver vs RAF order');
    phases.push({label:'stylesheet edit in RAF: dimension observer catches it after RAF',firstRaf:compact(rafPhase.firstRaf),nextRaf:compact(rafPhase.nextRaf)});
    await evaluate('window.__flowTestStyle.remove();true');
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(window.__flowCandidate.check()))))');
    const shapeOnly=await evaluate(`(()=>{
      window.__flowTestStyle=document.createElement('style');window.__flowTestStyle.textContent='.ProseMirror > p:first-child {letter-spacing:4.321px !important}';document.head.append(window.__flowTestStyle);
      return window.__flowCandidate.check();
    })()`);
    const shapeSettled=await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(window.__flowCandidate.check()))))');
    if(!shapeOnly.findings.length || !shapeSettled.findings.length || shapeSettled.maxError || shapeSettled.reads)throw new Error(JSON.stringify({reason:'Expected unchanged outer size with changed text shape',shapeOnly:compact(shapeOnly),shapeSettled:compact(shapeSettled)}));
    const explicit=await evaluate('window.__flowCandidate.invalidate();window.__flowCandidate.check()');
    if(explicit.findings.length)throw new Error('Explicit layout invalidation did not repair text shape');
    phases.push({label:'unchanged paragraph box, changed text geometry: observer alone never catches it',immediate:compact(shapeOnly),settled:compact(shapeSettled),explicitInvalidation:compact(explicit)});
    await evaluate('window.__flowTestStyle.remove();window.__flowCandidate.dispose();true');
    return {experiment:'synchronous mutation tracking and asynchronous ResizeObserver boundary',checks:phases.length,phases};
  }
  for(const mode of ['vertical-rl','horizontal-tb']) {
    await settings('本文方向',mode);
    for(const display of ['continuous','paged']) {
      await settings('編集表示',display);
      await check(mode+'/'+display+'/switch');
      for(let i=0;i<12;i++) {
        await action(`editor.view.dispatch(editor.state.tr.insertText(${JSON.stringify('追加。'.repeat(i%3?1:30))},window.__pos(2,8)))`);
        await check(mode+'/'+display+'/edit '+i);
      }
      await action(`editor.commands.setTextSelection(window.__pos(32,8));root.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}))`);
      await check(mode+'/'+display+'/split');
      await action(`editor.commands.undo()`);await check(mode+'/'+display+'/undo');
      await action(`editor.commands.redo()`);await check(mode+'/'+display+'/redo');
      await action(`editor.commands.undo()`);await check(mode+'/'+display+'/join');
      await action(`editor.commands.setTextSelection({from:window.__pos(32,1),to:window.__pos(32,4)});root.dispatchEvent(new KeyboardEvent('keydown',{key:'b',code:'KeyB',ctrlKey:true,bubbles:true,cancelable:true}))`);
      await check(mode+'/'+display+'/bold');
      await action(`editor.view.dispatch(editor.state.tr.insertText('長い表の内容'.repeat(25),window.__pos(9,2)))`);
      await check(mode+'/'+display+'/shared table tracks');
      await action(`editor.view.dispatch(editor.state.tr.insertText('### ',window.__pos(17)))`);
      await check(mode+'/'+display+'/heading size');
      await action(`editor.view.dispatch(editor.state.tr.insertText('｜漢字《かんじ》',window.__pos(2,10)))`);
      await check(mode+'/'+display+'/ruby');
      await action(`root.dispatchEvent(new KeyboardEvent('keydown',{key:'/',code:'Slash',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}))`);
      await check(mode+'/'+display+'/comment visibility');
      await action(`editor.commands.setTextSelection(window.__pos(32,8));editor.view.focus()`);
      await page.send('Input.imeSetComposition',{text:'へんかん',selectionStart:4,selectionEnd:4});
      await check(mode+'/'+display+'/IME composing');
      await page.send('Input.insertText',{text:'変換'});
      await check(mode+'/'+display+'/IME commit');
      await action(`editor.commands.setTextSelection(window.__pos(220,3))`);
      await check(mode+'/'+display+'/distant selection and scrolling');
      if(display==='paged'){
        await settings('ページ送り','vertical');await check(mode+'/'+display+'/vertical page flow');
        await settings('ページ送り','horizontal-rtl');await check(mode+'/'+display+'/horizontal page flow');
      }
      await page.send('Emulation.setDeviceMetricsOverride',{width:1200,height:780,deviceScaleFactor:1,mobile:false});
      await check(mode+'/'+display+'/viewport resize');
      await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
      await check(mode+'/'+display+'/viewport restore');
    }
  }
  await action(`root.style.fontSize='25.3px';root.style.lineHeight='1.731'`);
  await check('fractional font size and line height');
  await action(`root.style.fontFamily='monospace'`);await check('font family');
  await action(`root.style.removeProperty('font-family');root.style.removeProperty('font-size');root.style.removeProperty('line-height');
    editor.commands.setContent({type:'doc',content:Array.from({length:2139},(_,i)=>({type:'paragraph',content:[{type:'text',text:'本文「引用」｜東京《とうきょう》と文字。'.repeat(3)+i}]}))})`);
  await check('long document initial');
  for(let i=0;i<8;i++) {
    await action(`editor.view.dispatch(editor.state.tr.insertText('増',window.__pos(1020,8)))`);
    await check('long document local edit '+i);
  }
  const timings=await evaluate(`(()=>{
    window.__flowCandidate.flush();const root=document.querySelector('.ProseMirror'),elements=[...root.children];
    const full=[],cached=[];let sink=0;
    for(let n=0;n<80;n++){
      let t=performance.now();for(const el of elements){const r=el.getBoundingClientRect();sink+=r.top+r.right;}full.push(performance.now()-t);
      t=performance.now();const v=window.__flowCandidate.flush();for(const p of v.predicted)sink+=(p.top||0)+(p.right||0);cached.push(performance.now()-t);
    }
    const summarize=values=>{const a=[...values].sort((a,b)=>a-b);return {median:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],samples:values};};
    return {paragraphs:elements.length,full:summarize(full),candidate:summarize(cached),sink};
  })()`);
  await evaluate('window.__flowCandidate.dispose();true');
  return {experiment:'measured paragraph sizes + mutation/resize dirty sets; oracle never feeds candidate',checks:results.length,findings:0,results,timings};
}

let harness=await readFile(new URL('./benchmark-typing.mjs',import.meta.url),'utf8');
harness=harness.replace('console.error(error);','console.error(error.message ?? String(error));');
harness=harness.replace(/  summary\.cpuPerKey = \{[\s\S]*?\n  \};/,'  // A multi-operation audit has no meaningful cpuPerKey value.');
harness=harness.replace('"./lib/typewriter-benchmark.mjs"',JSON.stringify(new URL('./lib/typewriter-benchmark.mjs',import.meta.url).href));
const marker='await runTypewriterBenchmark({ page, evaluate, samples: SAMPLES, scenario: option("scenario", "typing") })';
if(!harness.includes(marker))throw new Error('Harness changed');
harness=harness.replace(marker,'await auditParagraphFlow({page,evaluate})');
harness=`${installFlowCandidate.toString()}\n${auditParagraphFlow.toString()}\n${harness}`;
await import('data:text/javascript;base64,'+Buffer.from(harness).toString('base64'));
