// Whole-input comparison for the integrated QA flow, without geometry wrappers
// or diagnostic flags. Timing excludes setup, validation, and undo/redo.
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

function installInputProbe() {
  const root = document.querySelector('.ProseMirror'), editor = root.editor;
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const text = () => editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n');
  const count = element => Number((element?.textContent ?? '').replace(/[^0-9]/g, ''));
  const status = () => count(document.querySelector('.statusRight'));
  const sidebar = () => count([...document.querySelectorAll('.treeItem')].find(row => row.querySelector('.treeItemName')?.textContent.startsWith('第一部'))?.querySelector('.treeItemCharCount'));
  window.__flowInputProbe = {
    async prepare(operation, warmup) {
      const index = Math.floor(editor.state.doc.childCount / 2);
      let pos = 1; for (let i = 0; i < index; i++) pos += editor.state.doc.child(i).nodeSize;
      editor.commands.setTextSelection(pos + Math.min(10, editor.state.doc.child(index).content.size));
      editor.view.focus();
      await sleep(500);
      await this.run(operation, warmup);
      await sleep(800);
      this.before = text();
      this.statusBefore = status(); this.sidebarBefore = sidebar();
      this.indexBefore = editor.state.selection.$head.index(0);
      this.offset = editor.state.selection.$head.parentOffset;
      for (let i = 0; i < this.indexBefore; i++) this.offset += editor.state.doc.child(i).content.size + 1;
      this.flowBefore = root.__paragraphFlowQA?.().stats ?? null;
      return { paragraphs: root.children.length, textLength: this.before.length, flowBefore: this.flowBefore,
        writingMode: getComputedStyle(root).writingMode, display: root.closest('.verticalTypewriterShell').dataset.editorDisplay,
        lineNumbers: Boolean(root.closest('[data-show-line-numbers]')), hiddenParagraphs: [...root.children].filter(p=>getComputedStyle(p).display==='none').length };
    },
    async run(operation, samples) {
      const values = { sync: [], firstRaf: [], secondRaf: [] };
      for (let i = 0; i < samples; i++) {
        const start = performance.now();
        if (operation === 'insert') {
          if (!document.execCommand('insertText', false, 'あ')) throw new Error('insertText failed');
        } else {
          const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
          root.dispatchEvent(event);
          if (!event.defaultPrevented) throw new Error('Enter keymap failed');
        }
        values.sync.push(performance.now() - start);
        await frame(); values.firstRaf.push(performance.now() - start);
        await frame(); values.secondRaf.push(performance.now() - start);
        await sleep(150);
      }
      await sleep(800);
      const percentile = (values, p) => { const sorted = [...values].sort((a,b)=>a-b); return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]; };
      return { operation, samples, latency: Object.fromEntries(Object.entries(values).map(([key,raw])=>[key,{p50:percentile(raw,.5),p95:percentile(raw,.95),max:percentile(raw,1),raw}])) };
    },
    validate(operation, samples) {
      const actual = text(), insertion = (operation === 'insert' ? 'あ' : '\n').repeat(samples);
      const expected = this.before.slice(0,this.offset)+insertion+this.before.slice(this.offset);
      const sourceMatches = actual === expected;
      const statusAfter = status(), sidebarAfter = sidebar();
      const flowAfter = root.__paragraphFlowQA?.().stats ?? null;
      // The fixture explicitly includes whitespace in displayed counts, so
      // paragraph separators count as one character as well.
      const countDelta = samples;
      const countsMatch = statusAfter-this.statusBefore === countDelta && sidebarAfter-this.sidebarBefore === countDelta;
      const result = { sourceMatches, countsMatch, statusDelta:statusAfter-this.statusBefore,sidebarDelta:sidebarAfter-this.sidebarBefore,
        textLength:actual.length,paragraphs:root.children.length,flowAfter,
        flowDelta:flowAfter ? Object.fromEntries(Object.keys(flowAfter).map(key=>[key,flowAfter[key]-this.flowBefore[key]])) : null };
      if (!sourceMatches || !countsMatch) throw new Error('Input validation failed: '+JSON.stringify(result));
      return result;
    },
    validateGeometry() {
      const mode=getComputedStyle(root).writingMode,vertical=mode==='vertical-rl';
      const oracle=window.__pageBreaksOracle;
      const fresh=oracle.measureParagraphs(root,mode),flow=root.__paragraphFlowQA?.();
      let maxMeasureError=0,maxRectError=0;
      if(flow)for(let i=0;i<fresh.length;i++){
        for(const key of ['blockStart','lineCount','linePitch','gapBefore'])maxMeasureError=Math.max(maxMeasureError,Math.abs(fresh[i][key]-flow.snapshot.paragraphs[i][key]));
        const rect=root.children[i].getBoundingClientRect();
        for(const key of ['left','right','top','bottom'])maxRectError=Math.max(maxRectError,Math.abs(rect[key]-flow.snapshot.blocks[i][key]));
      }
      let maxPageOffsetError=0,pagesEqual=null;
      if(flow && root.closest('.verticalTypewriterShell').dataset.editorDisplay==='paged'){
        const css=getComputedStyle(root),size=parseFloat(css.getPropertyValue(vertical?'--paged-content-width':'--paged-content-height'));
        const expected=oracle.computePageBreaks(size,fresh),stored=flow.breaks;
        pagesEqual=JSON.stringify(expected.pages)===JSON.stringify(stored.pages);
        maxPageOffsetError=Math.max(0,...expected.offsets.map((offset,i)=>Math.abs(offset-stored.offsets[i])));
      }
      const result={maxMeasureError,maxRectError,maxPageOffsetError,pagesEqual};
      if(maxMeasureError>1/32 || maxRectError>1/32 || maxPageOffsetError>1/32 || pagesEqual===false)throw new Error('Geometry validation failed: '+JSON.stringify(result));
      return result;
    },
  };
  return true;
}

async function measureIntegratedInput({page,evaluate}) {
  await evaluate(PAGE_ORACLE+';true');
  await evaluate(`(${installInputProbe})()`);
  const metric=async()=>Object.fromEntries((await page.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  const option=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];};
  const samples=Number(option('samples',24));
  const warmup=Number(option('warmup-input',12));
  const phases=[];
  for(const operation of ['insert','enter']){
    const metadata=await evaluate(`window.__flowInputProbe.prepare(${JSON.stringify(operation)},${warmup})`);
    if(metadata.hiddenParagraphs)throw new Error('Timing fixture unexpectedly contains hidden paragraphs');
    await evaluate(`performance.mark('flow-input-${operation}-start');true`);
    const before=await metric();
    const timings=await evaluate(`window.__flowInputProbe.run(${JSON.stringify(operation)},${samples})`);
    const after=await metric();
    await evaluate(`performance.mark('flow-input-${operation}-end');true`);
    const cpuMillisecondsPerInput=Object.fromEntries(['TaskDuration','ScriptDuration','RecalcStyleDuration','LayoutDuration'].map(key=>[key,(after[key]-before[key])*1000/samples]));
    const validation=await evaluate(`window.__flowInputProbe.validate(${JSON.stringify(operation)},${samples})`);
    const geometry=await evaluate('window.__flowInputProbe.validateGeometry()');
    phases.push({...timings,metadata,cpuMillisecondsPerInput,validation,geometry});
  }
  return {experiment:'Integrated input; setup/warmup/validation excluded; CPU includes input, asynchronous editor/count/scroll work and 800ms trailing drain',warmup,samples,phases};
}

const pageOracle=(await build({entryPoints:['src/editor/pageBreaks.ts'],bundle:true,format:'iife',globalName:'__pageBreaksOracle',write:false})).outputFiles[0].text;
let harness=await readFile(new URL('./benchmark-typing.mjs',import.meta.url),'utf8');
harness=harness.replace('console.error(error);','console.error(error.message ?? String(error));');
harness=harness.replace('"blink", "v8.execute"','"blink", "blink.user_timing", "v8.execute"');
harness=harness.replace(/  summary\.cpuPerKey = \{[\s\S]*?\n  \};/,'  // Each phase has its own correctly bounded CPU statistic.');
harness=harness.replace('editorDisplayMode: "continuous"','editorDisplayMode: option("display", "continuous")');
harness=harness.replace('typewriterScroll: true, editorDisplayMode:', 'countWhitespace: true, countCode: true, typewriterScroll: true, editorDisplayMode:');
harness=harness.replace('"./lib/typewriter-benchmark.mjs"',JSON.stringify(new URL('./lib/typewriter-benchmark.mjs',import.meta.url).href));
const marker='await runTypewriterBenchmark({ page, evaluate, samples: SAMPLES, scenario: option("scenario", "typing") })';
if(!harness.includes(marker))throw new Error('Benchmark harness changed');
harness=harness.replace(marker,'await measureIntegratedInput({page,evaluate})');
harness=`const PAGE_ORACLE=${JSON.stringify(pageOracle)};\n${installInputProbe.toString()}\n${measureIntegratedInput.toString()}\n${harness}`;
await import('data:text/javascript;base64,'+Buffer.from(harness).toString('base64'));
