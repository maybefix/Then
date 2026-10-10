// Exercise the real React prop -> transaction path without a production test hook.
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';

async function auditProps({evaluate}){
  await evaluate(FIXTURE);
  await new Promise(r=>setTimeout(r,900));
  return evaluate(`(async()=>{
    const wait=()=>new Promise(r=>setTimeout(r,250));
    const handle=window.__fixtureHandle,root=document.querySelector('#propsFixture .ProseMirror'),editor=root.editor;
    if(!handle)throw new Error('Fixture not mounted');
    const text=handle.getValue();const from=text.indexOf('本文40')+2,to=from+5;
    handle.selectRange(from,to);
    editor.view.dispatch(editor.state.tr.setSelection(editor.state.selection.constructor.create(editor.state.doc,editor.state.selection.to,editor.state.selection.from)));
    const beforeSelection=handle.getSelection();
    const oldDoc=editor.state.doc;const transactions=[];
    editor.on('transaction',({transaction})=>{if(transaction.docChanged)transactions.push(transaction.steps.map(s=>s.toJSON()));});
    const offset=text.indexOf('本文3');const next=text.slice(0,offset)+'外部から追記。'+text.slice(offset);
    const anchor=beforeSelection.head===beforeSelection.from?beforeSelection.to:beforeSelection.from;
    const expectedAnchor=window.__mapOffset(text,next,anchor),expectedHead=window.__mapOffset(text,next,beforeSelection.head);
    window.__fixtureRender({text:next,editorRevision:100});await wait();
    if(handle.getValue()!==next)throw new Error('External prop text mismatch');
    const selection=handle.getSelection();
    if(selection.from!==Math.min(expectedAnchor,expectedHead)||selection.to!==Math.max(expectedAnchor,expectedHead)||selection.head!==expectedHead)throw new Error('External selection mapping mismatch');
    if(transactions.length!==1||transactions[0].length!==1)throw new Error('External sync was not one transaction');
    if(editor.state.doc.child(85)!==oldDoc.child(85))throw new Error('Unchanged PM node replaced');
    if(window.__fixtureUpdates!==0)throw new Error('External props emitted a duplicate update');
    editor.commands.undo();await wait();
    if(handle.getValue()!==text)throw new Error('External sync Undo mismatch');
    const undoSelection=handle.getSelection();
    if(undoSelection.from!==beforeSelection.from||undoSelection.to!==beforeSelection.to||undoSelection.head!==beforeSelection.head)throw new Error('Undo selection mismatch');
    editor.commands.redo();await wait();
    if(handle.getValue()!==next)throw new Error('External sync Redo mismatch');
    const redoSelection=handle.getSelection();
    if(redoSelection.from!==selection.from||redoSelection.to!==selection.to||redoSelection.head!==selection.head)throw new Error('Redo selection mismatch');
    window.__fixtureRender({text:'stale text must be rejected',editorRevision:0});await wait();
    if(handle.getValue()!==next)throw new Error('Stale revision overwrote text');
    window.__fixtureRender({text:next+'\\r\\n外部の改行',editorRevision:200});await wait();
    if(handle.getValue()!==next+'\\n外部の改行')throw new Error('External newline normalization mismatch');
    if([...root.children].some(p=>!p.classList.contains('pm-line')))throw new Error('External sync lost decorations');
    window.__fixtureRender({showLineBreakMarks:false});await wait();
    let reads=0;const original=Range.prototype.getClientRects;
    Range.prototype.getClientRects=function(...args){if(root.contains(this.commonAncestorContainer))reads++;return original.apply(this,args);};
    try{window.__fixtureRender({textLayoutSignature:'font-or-width-changed'});await wait();}finally{Range.prototype.getClientRects=original;}
    if(reads<root.childElementCount)throw new Error('Layout-signature change did not remeasure the paragraphs');
    return {externalSyncSingleTransaction:true,unchangedNodesRetained:true,selectionMapped:true,undoRedo:true,staleRevisionRejected:true,newlinesNormalized:true,layoutSignatureFragmentReads:reads,duplicateUpdate:false,findings:0};
  })()`);
}

const fixture=await build({stdin:{contents:`
import React from 'react';import {createRoot} from 'react-dom/client';
import {VerticalTextEditor} from './src/VerticalTextEditor';
import {mapTextOffsetThroughChange} from './src/editor/textOffsetMapping';
document.getElementById('root').style.display='none';
const element=document.createElement('div');element.id='propsFixture';element.style.height='900px';document.body.append(element);
const root=createRoot(element);window.__fixtureUpdates=0;window.__mapOffset=mapTextOffsetThroughChange;
let props={text:Array.from({length:100},(_,i)=>'本文'+i+' **太字** と｜東京《とうきょう》。').join('\\n'),editorRevision:0,
writingMode:'vertical-rl',editorDisplayMode:'continuous',pageFlowDirection:'horizontal-rtl',typewriterScroll:false,showTypewriterGuide:false,typewriterOffset:50,showLineBreakMarks:true,showLineNumbers:true,highlightCurrentLine:true,colorizeJapaneseQuotes:true,showComments:true,textLayoutSignature:'test',
onReady:handle=>window.__fixtureHandle=handle,onTextChange:(text,editorRevision)=>{window.__fixtureUpdates++;queueMicrotask(()=>window.__fixtureRender({text,editorRevision}));},onSelectionChange:()=>{}};
window.__fixtureRender=updates=>{props={...props,...updates};root.render(<VerticalTextEditor {...props}/>);};window.__fixtureRender({});
`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"','import.meta.env.DEV':'false'},logLevel:'silent'});
let harness=await readFile(new URL('./benchmark-typing.mjs',import.meta.url),'utf8');
harness=harness.replace('console.error(error);','console.error(error.message ?? String(error));');
harness=harness.replace('"./lib/typewriter-benchmark.mjs"',JSON.stringify(new URL('./lib/typewriter-benchmark.mjs',import.meta.url).href));
const marker='await runTypewriterBenchmark({ page, evaluate, samples: SAMPLES, scenario: option("scenario", "typing") })';
if(!harness.includes(marker))throw new Error('Harness changed');
harness=harness.replace(marker,'await auditProps({evaluate})');
harness=`const FIXTURE=${JSON.stringify(fixture.outputFiles[0].text)};\n${auditProps.toString()}\n${harness}`;
await import('data:text/javascript;base64,'+Buffer.from(harness).toString('base64'));
