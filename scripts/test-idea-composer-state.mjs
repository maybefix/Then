import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createServer } from "vite";

const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { IdeaComposerBox } = await server.ssrLoadModule("/src/components/snippets/IdeaComposerBox.tsx");
  const root = createRoot(document.querySelector("#root"));
  const render = async text => act(async () => root.render(React.createElement(IdeaComposerBox, { text },
    React.createElement("textarea", { defaultValue: text }),
    React.createElement("div", { className: "ideaClipHost" }, React.createElement("button", null, "clip")),
    React.createElement("button", { id: "submit" }, "submit"),
  )));
  await render("");
  const box = document.querySelector(".ideaCaptureBox");
  assert.equal(box.dataset.empty, "true");
  await act(async () => document.querySelector("textarea").focus());
  assert.equal(box.dataset.clipFocused, undefined);
  await act(async () => document.querySelector(".ideaClipHost button").focus());
  assert.equal(box.dataset.clipFocused, "true", "clip menu focus keeps the empty composer collapsed");
  await act(async () => document.querySelector("#submit").focus());
  assert.equal(box.dataset.clipFocused, undefined, "focus outside the clip host expands the composer");
  await render(" ");
  assert.equal(box.dataset.empty, undefined, "spaces must match textarea placeholder semantics");
  await render("Idea");
  assert.equal(box.dataset.empty, undefined);
  await act(async () => document.querySelector(".ideaClipHost button").focus());
  await act(async () => document.querySelector(".ideaClipHost button").blur());
  assert.equal(box.dataset.clipFocused, undefined, "leaving the composer clears clip focus");
  await render("");
  assert.equal(box.dataset.empty, "true", "clearing/submitting restores the collapsed state");
  await act(async () => root.unmount());
  console.log("PASS Idea composer empty/focus/clip/clear behavior");
} finally {
  await server.close();
  dom.window.close();
}
