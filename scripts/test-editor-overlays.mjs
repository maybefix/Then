import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import ts from "typescript";

const source = await readFile("src/editor/overlayElements.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { syncOverlayElements } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const dom = new JSDOM("<!doctype html><div id='layer'></div>");
const { document, MutationObserver } = dom.window;
const layer = document.querySelector("#layer");
const fragment = (numbers, active) => {
  const result = document.createDocumentFragment();
  for (const number of numbers) {
    const span = document.createElement("span");
    span.className = `visibleLineNumber${number === active ? " active" : ""}`;
    span.dataset.visualLineNumber = String(number);
    span.textContent = String(number);
    span.style.left = `${number * 10}px`;
    result.appendChild(span);
  }
  return result;
};
syncOverlayElements(layer, fragment([1, 2, 3], 2));
const original = [...layer.children];
const observer = new MutationObserver(() => {});
observer.observe(layer, { childList: true, subtree: true, attributes: true, characterData: true });
syncOverlayElements(layer, fragment([1, 2, 3], 2));
assert.deepEqual(observer.takeRecords(), [], "an unchanged frame must not touch the DOM");
syncOverlayElements(layer, fragment([2, 3, 4], 3));
assert.equal(layer.children[0], original[1], "scrolling reuses labels that remain visible");
assert.equal(layer.children[1], original[2]);
assert.equal(layer.children[0].classList.contains("active"), false);
assert.equal(layer.children[1].classList.contains("active"), true);
assert.deepEqual([...layer.children].map(n => n.textContent), ["2", "3", "4"]);
syncOverlayElements(layer, fragment([4, 2, 3], 4));
assert.deepEqual([...layer.children].map(n => n.textContent), ["4", "2", "3"], "reordering retains the correct label order");
syncOverlayElements(layer, document.createDocumentFragment());
assert.equal(layer.children.length, 0);
observer.disconnect();
const scrollSource = await readFile("src/editor/scrollOverlay.ts", "utf8");
const scrollJs = ts.transpileModule(scrollSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { scrollOverlayTranslation } = await import(`data:text/javascript;base64,${Buffer.from(scrollJs).toString("base64")}`);
const viewport = { left: 0, right: 500, top: 0, bottom: 600 };
const root = { left: 0, right: 5000, top: 0, bottom: 600 };
const snapshot = { root, viewport, coverage: { left: -500, right: 1000, top: 0, bottom: 600 } };
const shifted = (x, y = 0) => ({ left: root.left + x, right: root.right + x, top: root.top + y, bottom: root.bottom + y });
assert.deepEqual(scrollOverlayTranslation(snapshot, shifted(-120), viewport, 1), { x: -120, y: 0 });
assert.deepEqual(scrollOverlayTranslation(snapshot, shifted(-0.5), viewport, 2), { x: -0.5, y: 0 });
assert.deepEqual(scrollOverlayTranslation(snapshot, shifted(-1.25), viewport, 0.8), { x: -1.25, y: 0 });
assert.equal(scrollOverlayTranslation(snapshot, shifted(-0.5), viewport, 1), null, "fractional movement must retain the normal renderer's rounding");
assert.equal(scrollOverlayTranslation(snapshot, shifted(-501), viewport, 1), null, "newly exposed lines must be rendered before reuse");
assert.equal(scrollOverlayTranslation(snapshot, { ...root, right: 5001 }, viewport, 1), null, "typesetting changes invalidate the painted labels");
assert.equal(scrollOverlayTranslation(snapshot, root, { ...viewport, left: 1, right: 501 }, 1), null, "viewport relocation invalidates cached coordinates");
const horizontalRoot = { left: 0, right: 500, top: 0, bottom: 5000 };
const horizontalSnapshot = { root: horizontalRoot, viewport,
  coverage: { left: 0, right: 500, top: -600, bottom: 1200 } };
assert.deepEqual(scrollOverlayTranslation(horizontalSnapshot, { ...horizontalRoot, top: -80, bottom: 4920 }, viewport, 1), { x: 0, y: -80 });
assert.equal(scrollOverlayTranslation(horizontalSnapshot, { ...horizontalRoot, top: -601, bottom: 4399 }, viewport, 1), null);

dom.window.close();
console.log("PASS editor overlays: node reuse, pixel-exact scrolling, coverage/resize guards, active labels, ordering and clear");
