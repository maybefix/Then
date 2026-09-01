import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const continuous = readFileSync(
  new URL("../src/VerticalTextEditor.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");

assert.match(
  app,
  /<VerticalTextEditor[\s\S]*?editorDisplayMode=\{settings\.editorDisplayMode\}/,
  "paged and continuous modes must retain the established ProseMirror renderer",
);
assert.match(
  app,
  /separateNativeInput=\{settings\.editorDisplayMode === "paged"\}/,
  "only paged mode must enable the native input bridge",
);
assert.match(
  continuous,
  /editable:\s*!separateNativeInputRef\.current/,
  "the fragmented ProseMirror renderer must become read-only while input is separated",
);
assert.match(
  continuous,
  /className="pagedNativeInputBridge"/,
  "paged mode must use a dedicated native input bridge",
);
assert.match(
  continuous,
  /typewriterScrollRef\.current = typewriterScroll && editorDisplayMode === "continuous"/,
  "the existing typewriter-scroll guard must remain continuous-only",
);
assert.match(
  css,
  /\.pagedNativeInputBridge\s*\{[\s\S]*?position:\s*absolute[\s\S]*?opacity:\s*0\.01/,
  "the IME bridge must be a caret-positioned native control",
);
assert.match(
  css,
  /\.verticalTypewriterShell\[data-editor-display="paged"\][\s\S]*?\.pm-root\s*\{[\s\S]*?column-fill:\s*auto/,
  "the established ProseMirror renderer must continue to own paged layout and decorations",
);

console.log("v0.6.1 paged editor separation tests passed");
