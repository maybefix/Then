// AppDialogModal: closing hands focus back through the caller's restorer, so a
// dialog opened from the manuscript (Ctrl+N, the palette's "表を挿入…") does not
// put the caret back at the start of the document
// (docs/DIALOG_CARET_RESTORE_FIX_PLAN.md).
import assert from "node:assert/strict";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import ts from "typescript";

await mkdir(join(process.cwd(), ".tmp"), { recursive: true });
const compiledPath = join(process.cwd(), ".tmp", `app-dialog-focus-test-${process.pid}.mjs`);
const source = await readFile("src/components/dialogs/AppDialogModal.tsx", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
});
await writeFile(compiledPath, compiled.outputText);
const quickPostPath = join(process.cwd(), ".tmp", `quick-post-focus-test-${process.pid}.mjs`);
await writeFile(quickPostPath, ts.transpileModule(await readFile("src/components/posts/QuickPostModal.tsx", "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText);

try {
  const dom = new JSDOM("<!doctype html><html><body><div id='editor' tabindex='0'>本文</div><button id='tree'>第二章.md</button><div id='root'></div></body></html>", {
    url: "http://localhost/",
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { AppDialogModal } = await import(pathToFileURL(compiledPath).href);
  const { QuickPostModal } = await import(pathToFileURL(quickPostPath).href);
  const { act, createElement, useState } = React;
  const root = createRoot(document.getElementById("root"));
  const editor = document.getElementById("editor");
  const tree = document.getElementById("tree");

  const inputDialog = {
    type: "input",
    title: "新規ファイルを作成",
    label: "ファイル名",
    value: "",
    confirmLabel: "作成",
    error: "",
    resolve: () => {},
  };
  const noop = () => {};
  function Harness({ onRestoreFocus }) {
    const [open, setOpen] = useState(true);
    return open
      ? createElement(AppDialogModal, {
          dialog: inputDialog,
          onClose: () => setOpen(false),
          onSubmit: (event) => event.preventDefault(),
          onValueChange: noop,
          onFieldValueChange: noop,
          onChoice: noop,
          onOption: noop,
          onRestoreFocus,
        })
      : null;
  }
  const pressEscape = () =>
    act(async () => {
      document.activeElement.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });

  // 1. Opened from the manuscript: closing goes through the caller's restorer.
  const restored = [];
  editor.focus();
  await act(async () => root.render(createElement(Harness, {
    key: "restore",
    onRestoreFocus: (target) => {
      restored.push(target);
      target.focus();
    },
  })));
  assert.equal(document.activeElement, document.querySelector(".modal input"), "opening focuses the name field");
  await pressEscape();
  assert.equal(document.querySelector(".modal"), null, "Escape closes the dialog");
  assert.deepEqual(restored, [editor], "closing hands the manuscript back through the caller's restorer, not a bare focus()");
  assert.equal(document.activeElement, editor);

  // 2. Without a restorer: back to the element that had focus, as before.
  tree.focus();
  await act(async () => root.render(createElement(Harness, { key: "plain" })));
  await pressEscape();
  assert.equal(document.activeElement, tree, "without a restorer, closing focuses the previous element");

  // 3. The previous element is gone: nothing is restored.
  const removed = [];
  const temporary = document.createElement("button");
  document.body.append(temporary);
  temporary.focus();
  await act(async () => root.render(createElement(Harness, {
    key: "gone",
    onRestoreFocus: (target) => removed.push(target),
  })));
  temporary.remove();
  await pressEscape();
  assert.deepEqual(removed, [], "a previous element that left the page is not restored");

  // 4. The post field (Ctrl+Alt+I, the palette's "アイデアに投稿…") hands focus back the same way.
  const postRestored = [];
  function PostHarness() {
    const [open, setOpen] = useState(true);
    return open
      ? createElement(QuickPostModal, {
          onPost: async () => true,
          onClose: () => setOpen(false),
          onRestoreFocus: (target) => {
            postRestored.push(target);
            target.focus();
          },
        })
      : null;
  }
  editor.focus();
  await act(async () => root.render(createElement(PostHarness, { key: "post" })));
  assert.equal(document.activeElement, document.querySelector(".quickIdeaModal textarea"), "the post field takes focus");
  await pressEscape();
  assert.equal(document.querySelector(".quickIdeaModal"), null, "Escape closes the post field");
  assert.deepEqual(postRestored, [editor], "closing the post field hands the manuscript back through the caller's restorer");
  assert.equal(document.activeElement, editor);

  await act(async () => root.unmount());
  dom.window.close();
  console.log("app dialog focus tests passed");
} finally {
  await unlink(compiledPath);
  await unlink(quickPostPath);
}
