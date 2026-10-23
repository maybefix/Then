// QA 用の一時ライブラリと、QA アプリのアプリ状態を作る。毎回まっさらにする
// （同じ識別子の %APPDATA% と %LOCALAPPDATA% の中身も消す）。利用者のライブラリや設定は読まない・書かない。
//
// 使い方: node .claude/skills/then-safe-change/scripts/qa/qa-seed.mjs <identifier> <spec.json> <libraryDir>
//   libraryDir は scratchpad の中にする（作業のあと qa-cleanup.mjs で消す）。
//
// spec.json:
// {
//   "library": "QAライブラリ",
//   "works": [
//     { "name": "作品A",
//       "files": { "本文.txt": "作品Aの本文です。\n" },               // 作品の中のファイル（文字列か JSON）
//       "then": { "project.json": { "ideaThreads": [] },            // 作品の .then/ の中のファイル
//                 "boards/qa-board.canvas": { "nodes": [], "edges": [], "then": { "version": 1, "name": "QAボード", "scope": "project", "createdAt": 1, "updatedAt": 1 } } } }
//   ],
//   "open": { "work": "作品A", "file": "本文.txt" },                // 起動時に開く作品とファイル
//   "appState": { "settings": {}, "rightSidebarTab": "idea" }        // アプリ状態に足す値
// }
// 文字列の中の {work:作品A} は、その作品フォルダの絶対パスに置き換わる（Canvas の出どころなどに使う）。
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";

const [identifier, specPath, libraryDir] = process.argv.slice(2);
if (!identifier?.startsWith("local.then.qa.") || !specPath || !libraryDir) {
  throw new Error("usage: qa-seed.mjs local.then.qa.<topic> <spec.json> <libraryDir>");
}
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const lib = path.resolve(libraryDir);
const appData = path.join(process.env.APPDATA, identifier);
const localData = path.join(process.env.LOCALAPPDATA, identifier);
for (const dir of [lib, appData, localData]) rmSync(dir, { recursive: true, force: true });

const workPath = (name) => path.join(lib, name);
const expand = (value) => {
  if (typeof value === "string") return value.replace(/\{work:([^}]+)\}/g, (_, name) => workPath(name));
  if (Array.isArray(value)) return value.map(expand);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item)]));
  return value;
};
const write = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  const expanded = expand(value);
  writeFileSync(file, typeof expanded === "string" ? expanded : JSON.stringify(expanded, null, 2));
};

write(path.join(lib, ".then", "library.json"), { schemaVersion: 1, id: `qa-${identifier.split(".").pop()}`, name: spec.library ?? "QAライブラリ" });
for (const work of spec.works) {
  for (const [name, content] of Object.entries(work.files ?? {})) write(path.join(workPath(work.name), name), content);
  const thenFiles = { "project.json": {}, ...(work.then ?? {}) };
  for (const [name, content] of Object.entries(thenFiles)) write(path.join(workPath(work.name), ".then", name), content);
}
const open = spec.open ?? { work: spec.works[0].name, file: Object.keys(spec.works[0].files ?? {})[0] };
const now = Date.now();
write(path.join(appData, "app-state.json"), {
  settings: {},
  ...spec.appState,
  lastWorkspacePath: workPath(open.work),
  lastFilePath: open.file ? path.join(workPath(open.work), open.file) : null,
  recentWorkspaces: spec.works.map((work, index) => ({
    path: workPath(work.name),
    name: work.name,
    lastOpenedAt: work.name === open.work ? now : now - 1000 * (index + 1),
    library: { name: spec.library ?? "QAライブラリ", role: "project" },
  })),
});
console.log(JSON.stringify({ library: lib, works: Object.fromEntries(spec.works.map((work) => [work.name, workPath(work.name)])), appData, localData }, null, 2));
