import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import ts from "typescript";

const compiledPath = join(process.cwd(), ".tmp", `command-palette-test-${process.pid}.mjs`);
const source = await readFile("src/components/dialogs/CommandPalette.tsx", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
});
await writeFile(compiledPath, compiled.outputText);

try {
  const dom = new JSDOM("<!doctype html><html><body><button id='previous'>Before</button><button id='other'>After</button><div id='root'></div></body></html>", {
    url: "http://localhost/",
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);

  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { CommandPalette } = await import(pathToFileURL(compiledPath).href);
  const { act, createElement, useState } = React;
  const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));
  const root = createRoot(document.getElementById("root"));
  const previous = document.getElementById("previous");
  const other = document.getElementById("other");
  const executed = [];
  const closeReasons = [];
  const command = (id, disabledReason) => ({
    id,
    label: id,
    disabledReason,
    run: () => executed.push(id),
  });
  const full = [command("disabled", "本文を開いてください"), command("one"), command("two"), command("three")];

  function Harness({ commands }) {
    const [open, setOpen] = useState(true);
    return open ? createElement(CommandPalette, { commands, onClose: (reason) => {
      closeReasons.push(reason);
      setOpen(false);
    } }) : null;
  }

  previous.focus();
  await act(async () => root.render(createElement(Harness, { commands: full })));
  const input = document.querySelector(".commandPaletteInput");
  assert.equal(document.activeElement, input, "opening focuses the search input");
  assert.equal(input.getAttribute("role"), "combobox");
  assert.equal(document.getElementById(input.getAttribute("aria-controls"))?.getAttribute("role"), "listbox");
  assert.equal(document.getElementById(input.getAttribute("aria-activedescendant"))?.textContent?.includes("本文を開いてください"), true);
  assert.equal(document.querySelector('[aria-disabled="true"] .commandPaletteDisabledReason')?.textContent, "本文を開いてください");

  const tab = new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  input.dispatchEvent(tab);
  assert.equal(tab.defaultPrevented, true, "Tab stays inside the modal dialog");
  other.focus();
  assert.equal(document.activeElement, input, "focus cannot move behind the modal dialog");

  for (let index = 0; index < 3; index++) {
    await act(async () => input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
  }
  assert.equal(document.getElementById(input.getAttribute("aria-activedescendant"))?.textContent, "three");

  await act(async () => root.render(createElement(Harness, { commands: [...full] })));
  assert.equal(document.getElementById(input.getAttribute("aria-activedescendant"))?.textContent, "three", "a new commands array alone does not reset selection");

  await act(async () => root.render(createElement(Harness, { commands: full.slice(0, 2) })));
  assert.equal(document.getElementById(input.getAttribute("aria-activedescendant"))?.textContent, "one", "selection stays in range after the command list shrinks");
  await act(async () => input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  await nextTask();
  assert.deepEqual(executed, ["one"], "Enter executes the clamped command");
  assert.deepEqual(closeReasons, ["command"], "running a command uses the command close reason");
  assert.equal(document.activeElement, previous, "closing restores the previous focus");

  previous.focus();
  await act(async () => root.render(createElement(Harness, { key: "second", commands: full })));
  const secondInput = document.querySelector(".commandPaletteInput");
  await act(async () => secondInput.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  assert.deepEqual(executed, ["one"], "disabled commands do not execute");
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(secondInput, "no match");
    secondInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  assert.equal(secondInput.getAttribute("aria-expanded"), "false", "an empty result list is collapsed");
  assert.equal(secondInput.hasAttribute("aria-activedescendant"), false, "an empty result list has no active option");
  assert.equal(document.querySelector('[role="status"]')?.textContent, "一致するコマンドがありません");
  await act(async () => secondInput.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  await nextTask();
  assert.deepEqual(closeReasons, ["command", "dismiss"], "Escape dismisses the palette");
  assert.equal(document.activeElement, previous, "Escape restores the previous focus");

  previous.focus();
  await act(async () => root.render(createElement(Harness, { key: "backdrop", commands: full })));
  await act(async () => document.querySelector(".commandPaletteBackdrop").dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true })));
  await nextTask();
  assert.deepEqual(closeReasons, ["command", "dismiss", "dismiss"], "backdrop uses the dismiss close reason");

  previous.focus();
  await act(async () => root.render(createElement(Harness, {
    key: "third",
    commands: [{ id: "focus", label: "Focus elsewhere", run: () => other.focus() }],
  })));
  const thirdInput = document.querySelector(".commandPaletteInput");
  await act(async () => thirdInput.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  await nextTask();
  assert.equal(document.activeElement, other, "a command can move focus without the closing palette taking it back");
  assert.equal(closeReasons.at(-1), "command", "a command that changes focus is not treated as dismissal");

  const editor = document.createElement("div");
  editor.tabIndex = 0;
  document.body.append(editor);
  const restored = [];
  function RestoringHarness() {
    const [open, setOpen] = useState(true);
    return open ? createElement(CommandPalette, {
      commands: full,
      onClose: () => setOpen(false),
      restoreFocus: (target) => {
        restored.push(target);
        target.focus();
      },
    }) : null;
  }
  editor.focus();
  await act(async () => root.render(createElement(RestoringHarness, { key: "restore" })));
  const restoreInput = document.querySelector(".commandPaletteInput");
  await act(async () => restoreInput.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  await nextTask();
  assert.deepEqual(restored, [editor], "Escape hands the manuscript back through the caller's focus restorer");
  assert.equal(document.activeElement, editor, "Escape returns focus to the manuscript");

  await act(async () => root.unmount());
  dom.window.close();
  console.log("command palette behavior tests passed");
} finally {
  await unlink(compiledPath);
}
