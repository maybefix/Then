import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const continuous = readFileSync(
  new URL("../src/VerticalTextEditor.tsx", import.meta.url),
  "utf8",
);
const paged = readFileSync(
  new URL("../src/SeparatedPagedTextEditor.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");

assert.match(
  app,
  /settings\.editorDisplayMode === "paged"[\s\S]*?<SeparatedPagedTextEditor/,
  "paged mode must use the separated editor component",
);
assert.match(
  app,
  /<VerticalTextEditor[\s\S]*?editorDisplayMode="continuous"/,
  "continuous mode must remain on the existing VerticalTextEditor path",
);
assert.match(
  paged,
  /className="separatedPagedRenderer"[\s\S]*?aria-hidden="true"/,
  "the visible paged renderer must be read-only",
);
assert.doesNotMatch(
  paged,
  /contentEditable|contenteditable/,
  "the paged renderer must not introduce an editable fragmented DOM",
);
assert.match(
  paged,
  /className="separatedPagedInputBridge"/,
  "paged mode must use a dedicated native input bridge",
);
assert.match(
  paged,
  /scrollCaretIntoView:\s*\(\)\s*=>\s*undefined/,
  "paged mode must not participate in typewriter scrolling",
);
assert.match(
  continuous,
  /typewriterScrollRef\.current = typewriterScroll && editorDisplayMode === "continuous"/,
  "the existing typewriter-scroll guard must remain continuous-only",
);
assert.match(
  css,
  /\.separatedPagedInputBridge\s*\{[\s\S]*?position:\s*absolute[\s\S]*?opacity:\s*0\.01/,
  "the IME bridge must be a caret-positioned native control",
);
assert.match(
  css,
  /\.separatedPagedRenderer\s*\{[\s\S]*?column-fill:\s*auto/,
  "only the read-only renderer should own CSS fragmentation",
);

console.log("v0.6.1 paged editor separation tests passed");
