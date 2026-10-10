// Full-measurement oracle in isolated Edge. All project writes use the mock backend.
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function auditVisualIndex({ page, evaluate }) {
  await evaluate(`window.__lineOracle = (() => { ${ORACLE}; return createVisualLineBands; })(); 1`);
  await evaluate(`window.__checkLines = () => {
    const root=document.querySelector('.ProseMirror'),editor=root.editor;
    const vertical=getComputedStyle(root).writingMode==='vertical-rl';
    const paged=root.closest('.verticalTypewriterShell').dataset.editorDisplay==='paged';
    const bounds=root.closest('.verticalTypewriterScroller').getBoundingClientRect();
    const blocks=[...root.children].map(element=>{
      const rect=element.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(element);
      return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,unnumbered:element.classList.contains('pm-comment'),
        fragments:[...range.getClientRects()].map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom}))};
    });
    const bands=window.__lineOracle(blocks,vertical?'vertical-rl':'horizontal-tb');
    const visible=bands.filter(b=>b.number&&b.right>=bounds.left&&b.left<=bounds.right&&b.bottom>=bounds.top&&b.top<=bounds.bottom);
    const numbers=[...document.querySelectorAll('.visibleLineNumber')];
    const expected=visible.map(b=>b.number),actual=numbers.map(n=>Number(n.dataset.visualLineNumber));
    if(JSON.stringify(expected)!==JSON.stringify(actual))throw new Error(JSON.stringify({reason:'missing/extra line numbers',expected,actual}));
    let error=0;
    const compare=(actual,expected)=>{error=Math.max(error,Math.abs(parseFloat(actual)-expected));};
    numbers.forEach((n,i)=>{
      const b=visible[i],block=blocks[b.blockIndex];
      compare(n.style.left,vertical?b.centerX-bounds.left:(paged?b.left:block.left)-bounds.left-10);
      compare(n.style.top,vertical?(paged?b.top:block.top)-bounds.top-18:b.centerY-bounds.top);
    });
    const highlight=document.querySelector('.activeVisualLineHighlight');
    if(!highlight)throw new Error('Missing active highlight');
    const active=bands.find(b=>b.blockIndex===editor.state.selection.$head.index(0)&&b.number===Number(highlight.dataset.visualLineNumber));
    if(!active)throw new Error('Highlight belongs to wrong paragraph/line');
    compare(highlight.style.left,active.left-bounds.left);compare(highlight.style.top,active.top-bounds.top);
    compare(highlight.style.width,active.right-active.left);compare(highlight.style.height,active.bottom-active.top);
    if(error>1)throw new Error('Overlay coordinate error '+error);
    if([...root.children].some(p=>!p.classList.contains('pm-line')))throw new Error('Lost paragraph decorations');
    return {numbers:numbers.length,maxError:+error.toFixed(3),paragraphs:blocks.length,mode:vertical?'vertical':'horizontal',paged};
  }; true`);
  const results=[];
  const check=async label=>{
    await new Promise(r=>setTimeout(r,650));
    const result=await evaluate('window.__checkLines()');
    if(!result.numbers)throw new Error(label+': no visible lines');
    results.push({label,...result});
  };
  const action=async source=>evaluate(`(() => {const root=document.querySelector('.ProseMirror'),editor=root.editor;${source};return true;})()`);
  await action(`window.__auditLines=Array.from({length:90},(_,i)=>[
    '# 見出し'+i,'本文「引用」 **太字** と｜東京《とうきょう》。'.repeat(7),
    '- 箇条書きと _斜体_','// コメント行'+i,'',
    '| 列甲 | 列乙 |','| --- | --- |','| 表本文 | |','~~~','コード **記号**','~~~'
  ][i%11]);
  editor.commands.setContent({type:'doc',content:window.__auditLines.map(text=>({type:'paragraph',...(text?{content:[{type:'text',text}]}:{})}))});
  window.__pos=(index,offset=0)=>{let pos=1;for(let n=0;n<index;n++)pos+=editor.state.doc.child(n).nodeSize;return pos+offset;};
  editor.commands.setTextSelection(window.__pos(34,12));editor.view.focus()`);
  await check('rich document');
  const settings=async (label,value)=>{
    await evaluate(`document.querySelector('button[aria-label="設定"]').click();true`);
    await new Promise(r=>setTimeout(r,100));
    await evaluate(`document.getElementById('settings-tab-body').click();true`);
    await evaluate(`(() => {const label=[...document.querySelectorAll('.settingsModal label')].find(l=>l.textContent.includes(${JSON.stringify(label)})&&l.querySelector('select'));if(!label)throw new Error('Setting label missing');const select=label.querySelector('select');select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
    await new Promise(r=>setTimeout(r,100));
    await evaluate(`document.querySelector('.settingsModal button[aria-label="閉じる"]').click();true`);
    await action(`editor.view.focus()`);
  };
  for(const mode of ['vertical-rl','horizontal-tb']){
    await settings('本文方向',mode);
    for(const display of ['continuous','paged']){
      await settings('編集表示',display);
      await action(`editor.commands.setTextSelection(window.__pos(34,12));editor.view.focus()`);
      await check(mode+'/'+display+'/switch');
      await action(`editor.view.dispatch(editor.state.tr.insertText('追記'))`);
      await check(mode+'/'+display+'/local edit');
      await action(`editor.view.dispatch(editor.state.tr.insertText('遠方で増える行。'.repeat(30),window.__pos(1)))`);
      await check(mode+'/'+display+'/distant line-count change');
      await action(`root.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}))`);
      await check(mode+'/'+display+'/split');
      await action(`editor.commands.undo()`);
      await check(mode+'/'+display+'/undo');
      await action(`editor.commands.redo()`);
      await check(mode+'/'+display+'/redo');
      await action(`editor.commands.setTextSelection({from:window.__pos(34,1),to:window.__pos(34,4)});root.dispatchEvent(new KeyboardEvent('keydown',{key:'b',code:'KeyB',ctrlKey:true,bubbles:true,cancelable:true}))`);
      await check(mode+'/'+display+'/bold command');
      await action(`root.dispatchEvent(new KeyboardEvent('keydown',{key:'/',code:'Slash',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}))`);
      await check(mode+'/'+display+'/comment visibility');
      await action(`editor.commands.setTextSelection(window.__pos(34,8));editor.view.focus()`);
      await page.send('Input.imeSetComposition',{text:'へんかん',selectionStart:4,selectionEnd:4});
      await page.send('Input.insertText',{text:'変換'});
      await check(mode+'/'+display+'/IME commit');
      if(display==='paged'){
        await settings('ページ送り','vertical');
        await check(mode+'/'+display+'/vertical page flow');
        await settings('ページ送り','horizontal-rtl');
        await check(mode+'/'+display+'/horizontal page flow');
      }
    }
  }
  await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await check('viewport resize');
  await action(`root.style.fontSize='25px'`);
  await check('font-size change');
  return {checks:results.length,findings:0,results};
}

const source=await readFile(new URL('../src/editor/visualLineLayout.ts',import.meta.url),'utf8');
const oracle=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/\bexport\s+/g,'');
let harness=await readFile(new URL('./benchmark-typing.mjs',import.meta.url),'utf8');
harness=harness.replace('console.error(error);','console.error(error.message ?? String(error));');
harness=harness.replace('"./lib/typewriter-benchmark.mjs"',JSON.stringify(new URL('./lib/typewriter-benchmark.mjs',import.meta.url).href));
const marker='await runTypewriterBenchmark({ page, evaluate, samples: SAMPLES, scenario: option("scenario", "typing") })';
if(!harness.includes(marker))throw new Error('Harness changed');
harness=harness.replace(marker,'await auditVisualIndex({ page, evaluate })');
harness=`const ORACLE=${JSON.stringify(oracle)};\n${auditVisualIndex.toString()}\n${harness}`;
await import('data:text/javascript;base64,'+Buffer.from(harness).toString('base64'));
