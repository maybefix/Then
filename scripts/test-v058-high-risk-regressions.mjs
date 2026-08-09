import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function importStandaloneTypeScript(path) {
  const source = await readFile(path, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  return import(moduleUrl);
}

const { manageAsyncRegistration } = await importStandaloneTypeScript(
  "src/utils/asyncRegistration.ts",
);

let resolveRegistration;
let disposalCount = 0;
const cleanup = manageAsyncRegistration(new Promise((resolve) => {
  resolveRegistration = resolve;
}));
resolveRegistration(() => {
  disposalCount += 1;
});
await Promise.resolve();
cleanup();
cleanup();
assert.equal(disposalCount, 1, "a completed registration must be disposed exactly once");

let resolveLateRegistration;
let lateDisposalCount = 0;
const cleanupBeforeRegistration = manageAsyncRegistration(new Promise((resolve) => {
  resolveLateRegistration = resolve;
}));
cleanupBeforeRegistration();
resolveLateRegistration(() => {
  lateDisposalCount += 1;
});
await Promise.resolve();
assert.equal(
  lateDisposalCount,
  1,
  "a registration completed after cleanup must dispose itself instead of leaking",
);

const registrationError = new Error("registration failed");
let observedError = null;
manageAsyncRegistration(
  Promise.reject(registrationError),
  (error) => {
    observedError = error;
  },
);
await Promise.resolve();
assert.equal(observedError, registrationError, "active registration failures must be reported");

const appSource = await readFile("src/App.tsx", "utf8");
const editorSource = await readFile("src/VerticalTextEditor.tsx", "utf8");

assert.doesNotMatch(
  appSource,
  /suppressNextEditorUpdateRef/,
  "document loading must not leave a flag that discards the first user edit",
);
assert.match(
  appSource,
  /const handleTextChange = useCallback\([\s\S]*?didMountEditorRef\.current = true;[\s\S]*?const nextFullText = updateMarkdownBody\(markdown, nextText\);/,
  "the first editor update must immediately enter the markdown update path",
);
assert.match(
  editorSource,
  /content:\s*textToDoc\(textRef\.current\)/,
  "a newly mounted editor must initialize its document without an update callback",
);
assert.match(
  editorSource,
  /editor\.commands\.setContent\(textToDoc\(text\), false\)/,
  "external text synchronization must remain explicitly non-emitting",
);
assert.match(
  appSource,
  /listen<string>\("then-open-export-source", \(event\) => \{\s*void handleProjectFileSelectRef\.current\(event\.payload\);\s*\}\)/,
  "the stable Tauri listener must call the latest file-selection handler through a ref",
);
assert.match(
  appSource,
  /return manageAsyncRegistration\([\s\S]*?listen<string>\("then-open-export-source"[\s\S]*?\n\s*\);\s*\n\s*\}, \[\]\);/,
  "the Tauri event must be registered once and use race-safe cleanup",
);

console.log("v0.5.8 high-risk regression tests passed");
