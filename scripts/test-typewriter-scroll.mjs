import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const code = ts.transpileModule(await readFile("src/editor/typewriterScroller.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { createTypewriterScroller } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

function harness({ position = 0, target = 28, clamp = value => value, pixel = 1 } = {}) {
  let time = 0, id = 0, enabled = true, measurements = 0, settled = 0;
  const frames = new Map(), positions = [];
  const animator = createTypewriterScroller({
    requestFrame: callback => { frames.set(++id, callback); return id; },
    cancelFrame: key => frames.delete(key), now: () => time,
    enabled: () => enabled, read: () => position,
    write: value => { position = clamp(value); positions.push(position); },
    measureTarget: () => { measurements++; return target; },
    pixelSize: () => pixel, onSettled: () => settled++,
  });
  return {
    animator, frames, positions,
    step(dt = 16) {
      time += dt;
      const pending = [...frames.values()]; frames.clear();
      for (const callback of pending) callback(time);
    },
    finish() { for (let i = 0; frames.size && i < 100; i++) this.step(); assert.equal(frames.size, 0); },
    target: value => target = value, enabled: value => enabled = value,
    get position() { return position; }, get measurements() { return measurements; }, get settled() { return settled; },
  };
}

const smooth = harness();
smooth.animator.request(); smooth.finish();
assert.equal(smooth.position, 28);
assert.ok(smooth.positions.length > 5, "A line transition must be spread across several frames");
assert.ok(smooth.positions[0] < 14, "The first frame must not jump a whole line");
assert.equal(smooth.measurements, 2, "Measure geometry at start and settlement, not on every frame");
assert.equal(smooth.settled, 1);

// Requested from inside an animation frame, the first step happens at once
// and moves by a frame's worth rather than a single pixel.
const inFrame = harness();
inFrame.animator.request(true);
assert.equal(inFrame.positions.length, 1, "A request made inside a frame must not wait for the next one");
assert.ok(inFrame.positions[0] >= 5 && inFrame.positions[0] < 14, `first step moves a frame's worth (${inFrame.positions[0]})`);
inFrame.finish();
assert.equal(inFrame.position, 28);

// Catching up after a new column must not trail the caret for long.
const quick = harness();
quick.animator.request();
let elapsed = 0;
while (quick.position !== 28 && elapsed < 1000) { quick.step(); elapsed += 16; }
assert.ok(elapsed <= 160, `the scroll reaches the caret within ~10 frames (${elapsed} ms)`);

const retarget = harness();
retarget.animator.request(); retarget.step();
retarget.target(56); retarget.animator.request();
assert.equal(retarget.frames.size, 1, "Retargeting must reuse the pending animation frame");
retarget.finish(); assert.equal(retarget.position, 56);
assert.ok(retarget.positions.every((value, i) => !i || value >= retarget.positions[i - 1]));

const rtl = harness({ target: -80, pixel: 0.8 });
rtl.animator.request(); rtl.finish(); assert.equal(rtl.position, -80);

const edge = harness({ target: 100, clamp: value => Math.min(20, value) });
edge.animator.request(); edge.finish(); assert.equal(edge.position, 20);
assert.ok(edge.positions.length < 10, "Unreachable scroll positions must not leave an animation running");

const composition = harness();
composition.animator.request(); composition.step();
const paused = composition.position;
composition.enabled(false); composition.step();
assert.equal(composition.position, paused, "IME composition must stop caret following");
assert.equal(composition.frames.size, 0);

const layout = harness();
layout.animator.request(); layout.step();
layout.target(42); layout.animator.invalidate(); layout.finish();
assert.equal(layout.position, 42, "A layout change must invalidate the cached target");
layout.animator.request(); layout.animator.stop();
assert.equal(layout.frames.size, 0, "Manual scroll/unmount must cancel the animation");
console.log("typewriter-scroll: smooth movement, retargeting, RTL, boundaries, composition and layout checks passed");
