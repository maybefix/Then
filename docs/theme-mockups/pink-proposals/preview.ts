// Isolated design preview. The app and all components are the production ones.
// The IPC fixture only supplies invented manuscript/project data in memory.
import { createDefaultState } from "../../../src/storedStateModel";
import type { AppTheme } from "../../../src/types";
import { appThemeValues } from "../../../src/types";

const params = new URLSearchParams(location.search);
const typewriterEnabled = params.get("typewriter") === "1";
const auditSample = params.get("sample") === "theme-audit";
const auditData = auditSample || params.get("audit") === "1";
const requestedTheme = params.get("app-theme");
const appTheme = appThemeValues.includes(requestedTheme as AppTheme) ? requestedTheme as AppTheme : null;
const proposal = ["charcoal", "paper", "split", "reverse"].includes(params.get("theme") ?? "")
  ? params.get("theme")! : "charcoal";
const implementedThemes: Record<string, AppTheme> = {
  charcoal: "aplil-dark", paper: "aplil-light", split: "blossom-dark", reverse: "blossom-light",
};
const root = "C:/theme-preview/library/夜明けの手紙";
const body = `# 第一章　夜明けの手紙

　雨がやんだのは、夜明けの少し前だった。窓を開けると、濡れた庭の匂いが部屋に入り込んできた。

　机の上には、昨日届いた一通の手紙が置かれている。差出人の名前はない。ただ、見覚えのある小さな文字で、私の名前だけが書かれていた。

「春になったら、あの場所で会いましょう」

　便箋に書かれていたのは、それだけだった。私は手紙を裏返し、もう一度、表に戻した。窓の向こうでは、遠くの屋根が少しずつ明るくなっていた。

## 窓辺の約束

　あの人と最後に話したのは、三年前の春だった。駅前の喫茶店で、二人とも、冷めてしまった珈琲には手をつけなかった。

「ここを出ることにしたの」

　そう言って笑った顔を、今でも覚えている。引き止める言葉は、いくらでも思いついたはずなのに、私は何も言えなかった。

　庭の桜には、まだ小さな蕾しかない。それでも、季節は確かに進んでいる。私は引き出しから新しい便箋を取り出した。

## 返事を書く

　最初の一行を決めるまで、ずいぶん長くかかった。言いたいことはたくさんあった。けれど、今は短い言葉でよかった。

「私も、会いたいです」

　書き終えた文字を見つめているうちに、庭の隅で鳥が鳴いた。新しい一日が始まろうとしていた。` + (auditSample ? `

## 記法と表の確認

**太字の文章**と、*斜体の文章*。｜東雲《しののめ》の空に、漢字《かんじ》のルビを付ける。

> 引用文は本文と区別して読めることを確認する。

[参考リンク](https://example.com) と ${String.fromCharCode(96)}inline code${String.fromCharCode(96)}。

| 項目 | 内容 |
| --- | --- |
| 主人公 | 美月 |
| 場所 | 駅前の喫茶店 |

「会話」と通常の文章を読み比べる。
` : "");
const files = new Map<string, string>();
const file = (name: string, content: string) => {
  const path = `${root}/${name}`;
  files.set(path, content);
  return { path, name: name.split("/").pop()!, kind: "file", children: [], fileId: path, contentHash: null, modifiedAt: 1 };
};
const children = [
  file("01_夜明けの手紙.md", body),
  file("02_駅前の喫茶店.md", "# 第二章　駅前の喫茶店\n\n　あの日の約束を、もう一度思い出す。"),
  file("03_春の帰り道.md", "# 第三章　春の帰り道\n\n　街の桜が咲き始めた。"),
  { path: `${root}/登場人物`, name: "登場人物", kind: "folder", children: [file("登場人物/美月.md", "# 美月\n主人公。手紙を受け取る。"), file("登場人物/遥.md", "# 遥\n三年前に街を離れた友人。") ] },
  { path: `${root}/資料`, name: "資料", kind: "folder", children: [] },
];
const folder = { path: root, name: "夜明けの手紙", children,
  library: { path: "C:/theme-preview/library", name: "作品ライブラリ", role: "project", projects: [{ path: root, name: "夜明けの手紙" }], misplacedProjects: [] } };
const state = createDefaultState();
Object.assign(state, { markdown: body, lastWorkspacePath: root, lastFilePath: children[0].path, rightSidebarTab: "plot" });
Object.assign(state.settings, { theme: appTheme ?? implementedThemes[proposal], skipStartupPortal: true,
  writingMode: params.get("writing") === "horizontal" ? "horizontal-tb" : "vertical-rl",
  editorDisplayMode: params.get("display") === "paged" ? "paged" : "continuous",
  uiFontScale: ["1", "1.25", "1.5"].includes(params.get("scale") ?? "") ? Number(params.get("scale")) : 1,
  fontSize: 18, typewriterScroll: typewriterEnabled, showTypewriterGuide: typewriterEnabled, highlightCurrentLine: false });
if (params.get("manuscript") === "1") state.settings.manuscript = { ...state.settings.manuscript, layoutMode: "manuscript", showGrid: true };
if (auditData) state.snippets[0].fragments = [
  { id: "audit-idea-1", body: "主人公が手紙を読み、三年前の約束を思い出す。", used: false, createdAt: 1, updatedAt: 1 },
  { id: "audit-idea-2", body: "喫茶店の窓際。冷めた珈琲と、伝えられなかった言葉。", used: false, createdAt: 1, updatedAt: 1 },
];
const plotCards = [
  { id: "p1", kind: "chapter", num: "1", title: "第一幕　届いた手紙", body: "", expanded: true, managerCollapsed: false },
  { id: "p2", kind: "section", num: "001", title: "夜明けの手紙", body: "差出人のない手紙が、三年前の記憶を呼び起こす。", expanded: true, managerCollapsed: false },
  { id: "p3", kind: "section", num: "002", title: "駅前の喫茶店", body: "二人が最後に会った場所へ。伝えられなかった言葉。", expanded: true, managerCollapsed: false },
  { id: "p4", kind: "section", num: "003", title: "春の約束", body: "返事を書き、新しい一歩を踏み出す。", expanded: true, managerCollapsed: false },
];
let callbackId = 1;
const responses: Record<string, (args: any) => unknown> = {
  load_app_state: () => state,
  save_app_state: ({ state: savedState }) => { (window as any).__previewSavedState = structuredClone(savedState); return null; },
  list_project_text_files: () => folder,
  read_text_file: ({ path }) => ({ path, name: path.split("/").pop(), content: files.get(path) ?? "", fileId: path, contentHash: null }),
  load_project_file_progress: () => ({ fileProgress: { [children[0].path]: "writing" }, revision: 0, migratedCount: 0, contentHash: "", rebased: false }),
  load_project_checkpoints: () => ({ snapshots: [], warnings: [], migratedCount: 0, migrationComplete: true }),
  load_project_plot_cards: () => plotCards,
  load_project_snippets: () => auditData ? state.snippets : [],
  get_system_fonts: () => [], get_font_faces: () => [],
  list_installed_plugins: () => ({ plugins: [], errors: [] }),
  load_reference_layout: () => ({ version: 3, name: "default", cards: [], recent: [], ideaThreads: [] }),
  "plugin:event|listen": () => callbackId++,
  "plugin:window|is_maximized": () => false,
  "plugin:window|is_fullscreen": () => false,
  journal_recovery_scan: () => [], load_library_property_types: () => ({}),
};
const previewWindow = window as any;
previewWindow.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
previewWindow.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
  transformCallback(callback: unknown) { const id = callbackId++; previewWindow[`_${id}`] = callback; return id; },
  async invoke(command: string, args = {}) {
    if (responses[command]) return structuredClone(responses[command](args));
    if (/^(list_|load_project_snippets|load_project_proofread)/.test(command)) return [];
    return null;
  },
};
// Use the registered production themes directly, without proposal CSS overrides.
await import("../../../src/main");
