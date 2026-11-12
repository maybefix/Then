import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// BINDER 1-5 (3.9): an edited synopsis changes only the synopsis line, and goes
// to the open tab when there is one, else to the file only if it is unchanged.
const dir = path.resolve("test-artifacts/synopsis-actions");
await mkdir(dir, { recursive: true });
const bundle = async (entry, name) => {
  await build({ entryPoints: [entry], outfile: path.join(dir, name), bundle: true, platform: "node", format: "esm", external: ["yaml"] });
  return import(`${pathToFileURL(path.join(dir, name)).href}?${Date.now()}`);
};
const { readSynopsis, writeSynopsis } = await bundle("src/corkboard/synopsis.ts", "synopsis.mjs");
const { saveSynopsis, overwriteSynopsis } = await bundle("src/corkboard/synopsisWriter.ts", "writer.mjs");

const BOM = String.fromCharCode(0xfeff);
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test("読む: なし・空・あり・扱えない値・壊れたYAML", () => {
  assert.deepEqual(readSynopsis("本文だけ。"), { kind: "none" });
  assert.deepEqual(readSynopsis("---\nslug: a\n---\n本文"), { kind: "none" });
  assert.deepEqual(readSynopsis("---\nsynopsis:\n---\n本文"), { kind: "text", text: "" });
  assert.deepEqual(readSynopsis("---\nsynopsis: 書庫の手紙。\n---\n本文"), { kind: "text", text: "書庫の手紙。" });
  assert.deepEqual(readSynopsis("---\nsynopsis: \"a: b\"\n---\n"), { kind: "text", text: "a: b" });
  assert.deepEqual(readSynopsis("---\nsynopsis: |\n  一行目\n  二行目\n---\n"), { kind: "readonly", text: "一行目 二行目" });
  assert.deepEqual(readSynopsis("---\nsynopsis: [a]\n---\n").kind, "readonly");
  assert.deepEqual(readSynopsis("---\nsynopsis: a\n: : b\n---\n"), { kind: "error" });
});

test("書く: 概要の行だけが変わり、本文・ほかの項目・改行・BOMはそのまま", () => {
  const file = `${BOM}---\r\nslug: a # 残す\r\nsynopsis: 前\r\ntags:\r\n  - x\r\n---\r\n\r\n　本文。\r\n---\r\n続き\r\n`;
  const next = writeSynopsis(file, "後の概要");
  assert.equal(next, file.replace("synopsis: 前", "synopsis: 後の概要"));
});

test("書く: 概要のないファイルには末尾に足す。フロントマターがなければ作る", () => {
  assert.equal(writeSynopsis("---\nslug: a\n---\n本文\n", "あらすじ"), "---\nslug: a\nsynopsis: あらすじ\n---\n本文\n");
  assert.equal(writeSynopsis("本文\r\n", "あらすじ"), "---\r\nsynopsis: あらすじ\r\n---\r\n本文\r\n");
  // A body that starts with a rule stays body.
  assert.equal(writeSynopsis("---\n\n本文\n\n---\n続き", "あ"), "---\nsynopsis: あ\n---\n---\n\n本文\n\n---\n続き");
});

test("書く: 空にすると空の synopsis: を残す。概要がなければ何も変えない", () => {
  assert.equal(writeSynopsis("---\nsynopsis: 前\nslug: a\n---\n本文", ""), "---\nsynopsis:\nslug: a\n---\n本文");
  assert.equal(writeSynopsis("本文", ""), "本文");
  assert.equal(writeSynopsis("---\nslug: a\n---\n本文", ""), "---\nslug: a\n---\n本文");
});

test("書く: 改行は除き、YAMLで意味を持つ文字は引用する", () => {
  assert.equal(writeSynopsis("本文", "一行目\n二行目"), "---\nsynopsis: 一行目二行目\n---\n本文");
  assert.equal(readSynopsis(writeSynopsis("本文", "時刻: 夜 #1")).text, "時刻: 夜 #1");
  assert.equal(readSynopsis(writeSynopsis("本文", "true")).text, "true");
  assert.equal(readSynopsis(writeSynopsis("本文", "- 箇条")).text, "- 箇条");
});

test("書く: 扱えない値と壊れたYAMLは書かない", () => {
  assert.throws(() => writeSynopsis("---\nsynopsis: |\n  a\n---\n", "b"));
  assert.throws(() => writeSynopsis("---\nsynopsis: a\n: : b\n---\n", "b"));
});

function host({ active = null, tabs = {}, files = {} } = {}) {
  const log = [];
  const disk = { ...files };
  return {
    log,
    disk,
    isActiveTab: (p) => p === active,
    openTabMarkdown: (p) => (p in tabs ? tabs[p] : null),
    updateActiveMarkdown: (markdown) => log.push(["active", markdown]),
    updateBackgroundTab: (p, markdown) => log.push(["background", p, markdown]),
    readFile: async (p) => {
      log.push(["read", p]);
      return { path: p, name: p, content: disk[p].content, contentHash: disk[p].hash };
    },
    saveFile: async (p, content, expectedHash) => {
      log.push(["save", p, content, expectedHash]);
      if (disk[p].hash !== expectedHash) throw new Error("document content conflict");
      disk[p] = { content, hash: `${disk[p].hash}+` };
      return { path: p, name: p, content, contentHash: disk[p].hash };
    },
    isConflict: (error) => String(error).includes("document content conflict"),
  };
}

test("作業中のタブで開いているなら、タブへ反映し、ファイルには書かない", async () => {
  const h = host({ active: "a.md", tabs: { "a.md": "---\nsynopsis: 前\n---\nタブの本文（未保存）" }, files: { "a.md": { content: "古い", hash: "h1" } } });
  assert.deepEqual(await saveSynopsis(h, "a.md", "後", null), { status: "tab" });
  assert.deepEqual(h.log, [["active", "---\nsynopsis: 後\n---\nタブの本文（未保存）"]]);
});

test("裏のタブで開いているなら、そのタブへ反映する", async () => {
  const h = host({ active: "a.md", tabs: { "a.md": "A", "b.md": "B本文" }, files: {} });
  assert.deepEqual(await saveSynopsis(h, "b.md", "概要", null), { status: "tab" });
  assert.deepEqual(h.log, [["background", "b.md", "---\nsynopsis: 概要\n---\nB本文"]]);
});

test("開いていないなら、読んだときのハッシュを付けて書く", async () => {
  const h = host({ files: { "c.md": { content: "本文", hash: "h1" } } });
  const result = await saveSynopsis(h, "c.md", "概要", { content: "本文", contentHash: "h1" });
  assert.equal(result.status, "saved");
  assert.deepEqual(h.log, [["save", "c.md", "---\nsynopsis: 概要\n---\n本文", "h1"]]);
  assert.equal(h.disk["c.md"].content, "---\nsynopsis: 概要\n---\n本文");
});

test("開いていないファイルが外で変わっていたら書かず、今のファイルを返す", async () => {
  const h = host({ files: { "c.md": { content: "外で書いた本文", hash: "h2" } } });
  const result = await saveSynopsis(h, "c.md", "概要", { content: "本文", contentHash: "h1" });
  assert.equal(result.status, "conflict");
  assert.equal(result.current.content, "外で書いた本文");
  assert.equal(h.disk["c.md"].content, "外で書いた本文");
  // 「この概要で上書きする」: the outside body is kept, only the synopsis is added.
  const again = await overwriteSynopsis(h, "c.md", "概要", result.current);
  assert.equal(again.status, "saved");
  assert.equal(h.disk["c.md"].content, "---\nsynopsis: 概要\n---\n外で書いた本文");
});

test("変わらないときは読みも書きもしない", async () => {
  const h = host({ tabs: { "a.md": "---\nsynopsis: 同じ\n---\n" } });
  assert.deepEqual(await saveSynopsis(h, "a.md", "同じ", null), { status: "unchanged" });
  const h2 = host({ files: { "c.md": { content: "本文", hash: "h1" } } });
  assert.deepEqual(await saveSynopsis(h2, "c.md", "", { content: "本文", contentHash: "h1" }), { status: "unchanged" });
  assert.deepEqual(h.log, []);
  assert.deepEqual(h2.log, []);
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`not ok - ${name}\n${error.stack}`);
  }
}
if (failed) throw new Error(`${failed} failed`);
console.log(`${cases.length} passed`);
