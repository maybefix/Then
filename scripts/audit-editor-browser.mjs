// Reuse the isolated Edge/project harness; no real project files are written.
// node scripts/audit-editor-browser.mjs --project --typewriter --chars 10000 --dist dist --output <json>
import { readFile } from "node:fs/promises";
async function runSideEffectBrowserAudit({ evaluate }) {
  const result = await evaluate(`(async () => {
    const root = document.querySelector('.ProseMirror'), editor = root.editor;
    const wait = () => new Promise(resolve => setTimeout(resolve, 600));
    const snapshots = [];
    const snap = label => snapshots.push({ label, text: editor.state.doc.textBetween(0, editor.state.doc.content.size, '\\n'), selection: editor.state.selection.toJSON(), paragraphs: [...root.children].map(p => ({ text: p.textContent, class: p.className, width: p.getBoundingClientRect().width, height: p.getBoundingClientRect().height })) });
    editor.commands.setContent({type:'doc',content:['a','','','b'].map(text => ({type:'paragraph',...(text ? {content:[{type:'text',text}]} : {})}))}, false);
    editor.commands.setTextSelection(4);
    editor.view.focus();
    await wait();
    snap('before Enter');
    root.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
    await wait(); snap('after Enter');
    editor.commands.setTextSelection(1);
    await wait(); snap('caret moved');
    editor.commands.undo();
    await wait(); snap('Undo');
    editor.commands.setTextSelection(1);
    editor.commands.redo();
    await wait(); snap('Redo');
    const blankDecorationsIntact = snapshots.every(s => s.paragraphs.every(p => p.text.length || p.class.includes('blank')));
    const textRestored = snapshots[0].text === snapshots[3].text && snapshots[1].text === snapshots[4].text;
    editor.commands.setTextSelection({from:1,to:editor.state.doc.content.size-1});
    const before = editor.state.selection.toJSON();
    let input = document.querySelector('.ideaCapture textarea') || document.querySelector('input');
    if (!input) {
      root.dispatchEvent(new KeyboardEvent('keydown',{key:'f',code:'KeyF',ctrlKey:true,bubbles:true,cancelable:true}));
      await wait();
      input = document.querySelector('input');
    }
    if (!input) throw new Error('No input available for the focus restoration check');
    input?.focus(); await wait();
    editor.view.focus(); await wait();
    const focusRestoresSelection = JSON.stringify(before) === JSON.stringify(editor.state.selection.toJSON());
    const lines = Array.from({length:12},(_,i) => i % 2 ? '**太字'+i+'**' : '# 見出し'+i);
    const makeDoc = values => ({type:'doc',content:values.map(text => ({type:'paragraph',content:[{type:'text',text}]}))});
    editor.commands.setContent(makeDoc(lines), false);
    await wait();
    const beforeReplace = [...root.children].map(p => ({text:p.textContent,class:p.className,html:p.innerHTML}));
    lines[6] += '追記';
    editor.commands.setContent(makeDoc(lines), false);
    editor.commands.setTextSelection(1);
    await wait();
    const afterReplace = [...root.children].map(p => ({text:p.textContent,class:p.className,html:p.innerHTML}));
    const replaceDecorationsIntact = afterReplace.every(p => p.class.includes('pm-line'));
    const unchangedDecorationsIntact = [2,3,4,9,10].every(i=>beforeReplace[i].class===afterReplace[i].class && beforeReplace[i].html===afterReplace[i].html);
    return { snapshots, blankDecorationsIntact, textRestored, focusRestoresSelection, beforeReplace, afterReplace, replaceDecorationsIntact, unchangedDecorationsIntact };
  })()`);
  if (process.argv.includes("--expect-clean")) {
    for (const key of ["blankDecorationsIntact","textRestored","focusRestoresSelection","replaceDecorationsIntact","unchangedDecorationsIntact"]) {
      if (!result[key]) throw new Error("Browser regression: "+key);
    }
  }
  return result;
}
let harness = await readFile(new URL("./benchmark-typing.mjs", import.meta.url), "utf8");
harness = harness.replace('console.error(error);', 'console.error(error.message ?? String(error));');
harness = harness.replace('"./lib/typewriter-benchmark.mjs"', JSON.stringify(new URL("./lib/typewriter-benchmark.mjs", import.meta.url).href));
const marker = 'await runTypewriterBenchmark({ page, evaluate, samples: SAMPLES, scenario: option("scenario", "typing") })';
if (!harness.includes(marker)) throw new Error("Benchmark harness changed; update the audit injection.");
harness = harness.replace(marker, 'await runSideEffectBrowserAudit({ page, evaluate })');
harness = `${runSideEffectBrowserAudit.toString()}\n${harness}`;
await import(`data:text/javascript;base64,${Buffer.from(harness).toString("base64")}`);
