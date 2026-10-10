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
dom.window.close();
console.log("PASS editor overlays: node reuse, zero mutations on unchanged frames, active labels, ordering and clear");
