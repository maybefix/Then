// Real-browser measurements of caret following, including movement rather than
// only typing latency. Use --project --typewriter --at middle --samples 30
// and --scenario typing|selection|ime with benchmark-typing.mjs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

function installProbe() {
  const root = document.querySelector(".ProseMirror");
  const view = root?.editor?.view;
  if (!view) throw new Error("ProseMirror view is unavailable");
  const scroller = root.closest(".verticalTypewriterScroller");
  const vertical = getComputedStyle(root).writingMode === "vertical-rl";
  const position = () => vertical ? scroller.scrollLeft : scroller.scrollTop;
  const text = () => view.state.doc.textBetween(0, view.state.doc.content.size, "\n");
  const before = text();
  let offset = view.state.selection.$head.parentOffset;
  for (let i = 0; i < view.state.selection.$head.index(0); i++) offset += view.state.doc.child(i).content.size + 1;
  const frames = [];
  // When each input happened, to measure how long the scroll takes to follow it.
  const inputs = [];
  const calls = { ranges: 0, elements: 0, hitTests: 0, geometryMs: 0 };
  const originals = [Range.prototype.getClientRects, Element.prototype.getBoundingClientRect, document.elementFromPoint];
  const wrap = (fn, key) => function (...args) {
    const start = performance.now();
    const value = fn.apply(this, args);
    calls[key]++;
    calls.geometryMs += performance.now() - start;
    return value;
  };
  Range.prototype.getClientRects = wrap(originals[0], "ranges");
  Element.prototype.getBoundingClientRect = wrap(originals[1], "elements");
  document.elementFromPoint = wrap(originals[2], "hitTests");
  let frameId;
  const tick = () => {
    frames.push({ time: performance.now(), position: position() });
    frameId = requestAnimationFrame(tick);
  };
  frameId = requestAnimationFrame(tick);
  window.__typewriterProbe = {
    step(scenario) {
      inputs.push(performance.now());
      if (scenario === "typing") {
        // Exercise ProseMirror's Enter keymap. execCommand('insertParagraph')
        // instead invokes Chromium's HTML editing/normalization machinery.
        const event = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true });
        root.dispatchEvent(event);
        if (!event.defaultPrevented) throw new Error("Enter keymap did not handle the input");
      }
      else {
        const doc = view.state.doc;
        const index = Math.min(doc.childCount - 1, view.state.selection.$head.index(0) + 1);
        let pos = 1;
        for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
        view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.create(doc, pos)));
      }
    },
    async run(scenario, samples) {
      for (let i = 0; i < samples; i++) {
        this.step(scenario);
        await new Promise(resolve => setTimeout(resolve, this.interval ?? 100));
      }
    },
    finish(scenario, samples, compositionText) {
      cancelAnimationFrame(frameId);
      Range.prototype.getClientRects = originals[0];
      Element.prototype.getBoundingClientRect = originals[1];
      document.elementFromPoint = originals[2];
      const percentile = (values, p) => {
        const sorted = [...values].sort((a, b) => a - b);
        return +(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0).toFixed(2);
      };
      const gaps = frames.slice(1).map((frame, i) => frame.time - frames[i].time);
      const movements = frames.slice(1).map((frame, i) => Math.abs(frame.position - frames[i].position)).filter(value => value > 0.25);
      // Follow: from each input, the first frame that moved and the last frame
      // that moved before the next input (the scroll has caught up there).
      const startDelays = [];
      const settleTimes = [];
      inputs.forEach((at, i) => {
        const until = inputs[i + 1] ?? Infinity;
        let previous = frames.findLast((frame) => frame.time <= at)?.position;
        let first = null;
        let last = null;
        for (const frame of frames) {
          if (frame.time <= at || frame.time > until) continue;
          if (previous !== undefined && Math.abs(frame.position - previous) > 0.25) {
            if (first === null) first = frame.time - at;
            last = frame.time - at;
          }
          previous = frame.position;
        }
        if (first !== null) startDelays.push(first);
        if (last !== null) settleTimes.push(last);
      });
      const head = view.state.selection.head;
      let caret;
      if (!view.state.selection.$head.parent.content.size) {
        const block = root.children[view.state.selection.$head.index(0)];
        caret = block.getBoundingClientRect();
      }
      if (view.state.selection.$head.parent.content.size && vertical) {
        const atStart = view.state.selection.$head.parentOffset === 0;
        const a = view.domAtPos(atStart ? head : Math.max(1, head - 1), 1);
        const b = view.domAtPos(atStart ? Math.min(head + 1, view.state.doc.content.size) : head, -1);
        const range = document.createRange();
        range.setStart(a.node, a.offset);
        range.setEnd(b.node, b.offset);
        const rects = [...range.getClientRects()];
        caret = atStart ? rects[0] : rects.at(-1);
      }
      if (!caret) caret = view.coordsAtPos(head);
      const rect = scroller.getBoundingClientRect();
      const delta = vertical
        ? (caret.left + caret.right) / 2 - (rect.left + rect.width * .46)
        : (caret.top + caret.bottom) / 2 - (rect.top + rect.height * .46);
      const expected = scenario === "selection" ? before
        : before.slice(0, offset) + (scenario === "ime" ? compositionText.repeat(samples) : "\n".repeat(samples)) + before.slice(offset);
      const actual = text();
      const settledSelection = { from: view.state.selection.from, to: view.state.selection.to };
      const selectionUnchangedByScroll = JSON.stringify(settledSelection) === JSON.stringify(this.selectionAfterInput);
      let undoRestores = true;
      let redoRestores = true;
      let undoSteps = 0;
      if (scenario !== "selection") {
        while (text() !== before && undoSteps < samples && root.editor.commands.undo()) undoSteps++;
        undoRestores = text() === before;
        for (let i = 0; i < undoSteps; i++) root.editor.commands.redo();
        redoRestores = text() === actual;
      }
      return {
        scenario, samples, writingMode: vertical ? "vertical-rl" : "horizontal-tb",
        lineNumbers: Boolean(root.closest("[data-show-line-numbers]")),
        frames: frames.length,
        frameGap: { p50: percentile(gaps, .5), p95: percentile(gaps, .95), max: percentile(gaps, 1) },
        framesOver25ms: gaps.filter(value => value > 25).length,
        movingFrames: movements.length,
        movement: { p50: percentile(movements, .5), p95: percentile(movements, .95), max: percentile(movements, 1) },
        alignmentError: +Math.abs(delta).toFixed(2),
        follow: {
          moved: settleTimes.length,
          startDelay: { p50: percentile(startDelays, .5), p95: percentile(startDelays, .95) },
          settle: { p50: percentile(settleTimes, .5), p95: percentile(settleTimes, .95), max: percentile(settleTimes, 1) },
        },
        geometry: { ...calls, geometryMs: +calls.geometryMs.toFixed(2) },
        textMatches: actual === expected, actualLength: actual.length, expectedLength: expected.length,
        selectionUnchangedByScroll, undoRestores, redoRestores, undoSteps,
      };
    },
  };
  return true;
}

export async function runTypewriterBenchmark({ page, evaluate, samples, scenario, interval = 100 }) {
  assert.ok(["typing", "selection", "ime"].includes(scenario));
  await evaluate(`(${installProbe})()`);
  await evaluate(`window.__typewriterProbe.interval = ${Number(interval)}; 1`);
  const compositionText = "日本語の変換を確定する。";
  if (scenario === "ime") {
    for (let i = 0; i < samples; i++) {
      await page.send("Input.imeSetComposition", { text: compositionText, selectionStart: compositionText.length, selectionEnd: compositionText.length });
      await new Promise(resolve => setTimeout(resolve, 50));
      await page.send("Input.insertText", { text: compositionText });
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } else {
    await evaluate(`window.__typewriterProbe.run(${JSON.stringify(scenario)}, ${samples})`);
  }
  await evaluate("window.__typewriterProbe.selectionAfterInput = {from: document.querySelector('.ProseMirror').editor.state.selection.from, to: document.querySelector('.ProseMirror').editor.state.selection.to}; 1");
  await new Promise(resolve => setTimeout(resolve, 800));
  const result = await evaluate(`window.__typewriterProbe.finish(${JSON.stringify(scenario)}, ${samples}, ${JSON.stringify(compositionText)})`);
  assert.ok(result.textMatches, `Manuscript changed unexpectedly: ${JSON.stringify(result)}`);
  assert.ok(result.selectionUnchangedByScroll, "Scrolling changed the selection");
  assert.ok(result.undoRestores && result.redoRestores, `Undo/redo failed: ${JSON.stringify(result)}`);
  return result;
}

// Compare cached overlays against a fresh, uncached DOM measurement. This also
// checks reflow/zoom invalidation instead of only checking that labels exist.
export async function validateTypewriterOverlays({ page, evaluate }) {
  const source = await readFile(new URL("../../src/editor/visualLineLayout.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/\bexport\s+/g, "");
  await evaluate(`window.__freshVisualBands = (() => { ${js}; return createVisualLineBands; })(); 1`);
  const check = async label => {
    await new Promise(resolve => setTimeout(resolve, 600));
    const result = await evaluate(`(() => {
      const root = document.querySelector('.ProseMirror');
      const vertical = getComputedStyle(root).writingMode === 'vertical-rl';
      const scroller = root.closest('.verticalTypewriterScroller');
      const bounds = scroller.getBoundingClientRect();
      const blocks = [...root.children].map(element => {
        const rect = element.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(element);
        return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,
          unnumbered:element.classList.contains('pm-comment'),fragments:[...range.getClientRects()].map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom}))};
      });
      const bands = window.__freshVisualBands(blocks, vertical ? 'vertical-rl' : 'horizontal-tb');
      const numbers = [...document.querySelectorAll('.visibleLineNumber')];
      let error = 0;
      for (const number of numbers) {
        const band = bands.find(b => b.number === Number(number.dataset.visualLineNumber));
        if (!band) return {ok:false,reason:'unknown line number'};
        const expected = vertical ? band.centerX-bounds.left : band.centerY-bounds.top;
        error = Math.max(error, Math.abs(parseFloat(vertical ? number.style.left : number.style.top)-expected));
      }
      const highlight = document.querySelector('.activeVisualLineHighlight');
      if (highlight) {
        const band = bands.find(b => b.number === Number(highlight.dataset.visualLineNumber) && b.blockIndex === root.editor.state.selection.$head.index(0));
        if (!band) return {ok:false,reason:'unknown active line',actualNumber:highlight.dataset.visualLineNumber,activeBlock:root.editor.state.selection.$head.index(0),fresh:bands.filter(b=>b.blockIndex===root.editor.state.selection.$head.index(0)),numberError:error};
        error = Math.max(error,Math.abs(parseFloat(highlight.style.left)-(band.left-bounds.left)),Math.abs(parseFloat(highlight.style.top)-(band.top-bounds.top)));
      }
      return {ok:error<=1,numbers:numbers.length,highlight:Boolean(highlight),maxError:+error.toFixed(3)};
    })()`);
    assert.ok(result.ok && result.numbers > 0 && result.highlight, `${label}: ${JSON.stringify(result)}`);
    return { label, ...result };
  };
  const results = [await check("after input/scroll")];
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  results.push(await check("after resize"));
  await evaluate("document.querySelector('.ProseMirror').style.fontSize='25px'; 1");
  results.push(await check("after font change"));
  return results;
}

export async function validateTypewriterManualControls({ evaluate }) {
  const result = await evaluate(`(async () => {
    const root=document.querySelector('.ProseMirror'), view=root.editor.view;
    const scroller=root.closest('.verticalTypewriterScroller');
    const vertical=getComputedStyle(root).writingMode==='vertical-rl';
    const position=()=>vertical?scroller.scrollLeft:scroller.scrollTop;
    const next=()=>{const doc=view.state.doc;const index=Math.min(doc.childCount-1,view.state.selection.$head.index(0)+3);let pos=1;for(let i=0;i<index;i++)pos+=doc.child(i).nodeSize;view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.create(doc,pos)));};
    next();
    await new Promise(requestAnimationFrame);
    scroller.dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true}));
    const wheelPosition=position(), wheelSelection=view.state.selection.head;
    await new Promise(resolve=>setTimeout(resolve,500));
    const wheelStable=Math.abs(position()-wheelPosition)<=1 && view.state.selection.head===wheelSelection;
    next();
    await new Promise(requestAnimationFrame);
    root.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true}));
    const dragPosition=position(), dragSelection=view.state.selection.head;
    await new Promise(resolve=>setTimeout(resolve,500));
    const dragStable=Math.abs(position()-dragPosition)<=1 && view.state.selection.head===dragSelection;
    window.dispatchEvent(new PointerEvent('pointercancel'));
    return {wheelStable,dragStable};
  })()`);
  assert.ok(result.wheelStable && result.dragStable, `Manual control failed: ${JSON.stringify(result)}`);
  return result;
}
