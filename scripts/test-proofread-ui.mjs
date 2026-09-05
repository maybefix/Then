import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { createRoot } from "react-dom/client";

const dir = path.resolve("test-artifacts/proofread-ui");
await mkdir(dir, { recursive: true });
await build({
  entryPoints: ["src/components/proofread/ProofreadPane.tsx"],
  outfile: path.join(dir, "pane.mjs"),
  bundle: true, platform: "node", format: "esm",
  external: ["react", "react/jsx-runtime"],
});
const { default: Pane } = await import(pathToFileURL(path.join(dir, "pane.mjs")));
const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = createRoot(document.getElementById("root"));
const options = { maxSentenceLength: 80, maxCommasPerSentence: 4, skipDialogue: true, disabledChecks: [] };
const noop = () => {};
const props = { text: "期待に答える。", documentKey: "a", active: true, options, onOptionsChange: noop,
  disabledRuleIds: [], onDisabledRuleIdsChange: noop, onJump: noop, onReplace: noop, projectTerms: [], globalTerms: [], hasProject: true,
  onProjectTermsChange: noop, onGlobalTermsChange: noop, onExportTermFile: async () => null, onImportTermFile: async () => null,
  canUseTermFiles: true, ignoredKeys: [], onIgnoredKeysChange: noop, disabledCheckIds: [], onDisabledCheckIdsChange: noop };
const render = async (patch = {}) => { await act(async () => { root.render(React.createElement(Pane, { ...props, ...patch })); }); };
const tab = (label) => [...document.querySelectorAll("button[role='tab']")].find(b => b.textContent.startsWith(label));

// 校正は入力が止まってから走る。指摘は本文と一緒に出る。
await render();
await act(async () => { await new Promise(r => setTimeout(r, 500)); });
assert.ok(document.body.textContent.includes("異字同訓"), "常時動作するルールの指摘が出る");
assert.ok(!document.body.textContent.includes("解析"), "解析器を呼ぶ操作は出さない");

// 異字同訓は検出項目が多いので、ルール一覧では畳んで出し、停止中の件数を添える。
await act(async () => { tab("ルール").click(); });
const folded = [...document.querySelectorAll("details.proofCheckGroup > summary")].map(s => s.textContent);
assert.ok(folded.some(label => /検出項目 1\d\d件/.test(label)), `many checks must fold: ${JSON.stringify(folded)}`);
assert.ok(!folded.some(label => /停止中/.test(label)));
assert.ok([...document.querySelectorAll(".proofCheckName")].some(s => s.textContent.includes("こたえる")), "checks are named by the report item");

await render({ disabledCheckIds: ["ijidokun/057", "ijidokun/094"] });
assert.ok([...document.querySelectorAll("details.proofCheckGroup > summary")].some(s => s.textContent.includes("（2件を停止中）")));

// 項目の少ないルールは畳まずにそのまま並べる。
assert.ok(document.querySelectorAll("ul.proofCheckList").length > 0);

await act(async () => { root.unmount(); });
dom.window.close();
console.log("proofread UI OK: issue list, folded check list and disabled count");
