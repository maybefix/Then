# Then Plugin API v1

Then v0.6.1 では、プラグイン本体をアプリ全体へ一度だけ導入し、プロジェクトごとのデータだけを各プロジェクトへ分離して保存する。

SDKの型定義は [`plugin-sdk/then.d.ts`](../plugin-sdk/then.d.ts)、manifest用JSON Schemaは [`plugin-sdk/manifest.schema.json`](../plugin-sdk/manifest.schema.json) にある。

SDKのnpm配布、開発CLI、`.thenplugin`パッケージ、公式プラグインリポジトリ、配布カタログの目標設計は [`PLUGIN_DEVELOPMENT_AND_DISTRIBUTION.md`](PLUGIN_DEVELOPMENT_AND_DISTRIBUTION.md) を参照する。

## 配置と分離

- プラグイン本体: Then のユーザーデータ領域にある `plugins/<plugin-id>/`
- プロジェクトデータ: `<project>/.then/plugin-data/<plugin-id>/storage.json`
- 永続アンカー: `<project>/.then/anchors.json`
- 文書本文とエディタAST: 変更しない

アンカーは本文オフセット、選択文字列、前後コンテキストをサイドカーへ保存する。編集中は変更差分で位置を写像し、Thenを閉じている間に外部編集された場合は文字列と前後コンテキストから再接続する。ID自体は再接続の成否にかかわらず不変である。候補を一意に決められない場合、`anchors.resolve` は誤った場所へ移動せず `null` を返す。

## 導入

コマンドパレット（Ctrl+P）から「プラグインを管理…」を開き、「プラグインを追加…」から `manifest.json` を含むフォルダを選ぶ。Thenが名前、バージョン、要求権限を表示し、確認後にアプリ全体へ導入する。v1 は `manifest.json` と単一のJavaScriptエントリを導入する。同じIDの上書き導入は行わない。

削除するときは「プラグインを管理…」の一覧から対象を選び、「削除」を実行する。確認後、Thenのユーザーデータ領域にあるプラグイン本体だけを削除する。プロジェクト内の `.then/plugin-data/<plugin-id>/` と、そのプラグインが作成した永続アンカーは、誤消去を防ぎ再導入後に利用できるよう残す。

```json
{
  "schemaVersion": 1,
  "id": "example.selection-notes",
  "name": "Selection Notes",
  "version": "1.0.0",
  "main": "main.js",
  "description": "選択範囲を記録するサンプル",
  "icon": {
    "paths": ["M5 4h14v16H5z", "M8 8h8M8 12h8M8 16h5"]
  },
  "permissions": [
    "document:read",
    "document:selection",
    "document:navigate",
    "document:anchors",
    "views",
    "storage",
    "commands"
  ]
}
```

IDにはASCII小文字、数字、ピリオド、ハイフンだけを使う。エントリは2 MiB以下とする。すべての新規プラグインに `icon` が必須である。`icon.paths` は固定の `0 0 24 24` viewBoxへ描くSVG path dataの配列で、1〜8本、1本1024バイト以下とする。ThenはSVG文字列をHTMLとして挿入せず、path dataだけを描画する。

## 実行モデル

プラグインは `sandbox="allow-scripts"` の不透明オリジンiframe内で動く。Then本体のDOM、Tauri API、ファイルシステム、ネットワークへ直接アクセスできない。利用できるのは、manifestで宣言しホストが実行時にも検査する `then` APIだけである。

`main.js` はES moduleではなく、グローバル引数 `then` を受け取るスクリプトとして記述する。

## API

### 選択とカーソル

```js
const selection = await then.editor.getSelection();
// { documentPath, from, to, head, line, text }

await then.editor.moveCursor({ documentPath: "chapter/one.txt", offset: 120 });
await then.editor.moveCursor({ documentPath: "chapter/one.txt", from: 120, to: 140 });
await then.editor.moveCursor({ anchorId: "..." });
```

文書パスはプロジェクト相対で、区切り文字は `/` とする。

### 永続アンカー

```js
const anchor = await then.anchors.create(); // 現在の選択範囲
const explicit = await then.anchors.create({ from: 10, to: 20 });
const resolved = await then.anchors.resolve(anchor.id);
await then.anchors.reveal(anchor.id);
await then.anchors.delete(anchor.id);
```

アンカーは作成したプラグインだけが解決、移動、削除できる。

### 変更通知

```js
const changeSubscription = then.workspace.onDidChangeTextDocument((event) => {
  // event = { documentPath, version, changes: { from, to, insertedText }, text }
});

const selectionSubscription = then.workspace.onDidChangeSelection((selection) => {
  // selection = { documentPath, from, to, head, text }
});

changeSubscription.dispose();
```

プロジェクトを切り替えたとき、プロジェクト保存領域を使うプラグインは
`onDidChangeWorkspace` で状態を読み直す。通知にはプロジェクト名と、プロジェクトが
開かれているかどうかが含まれる。

```js
const workspaceSubscription = then.workspace.onDidChangeWorkspace(async ({ hasProject }) => {
  if (!hasProject) return;
  const notes = (await then.storage.get("notes")) ?? [];
  renderNotes(notes);
});
```

### プロジェクト保存領域

```js
const notes = (await then.storage.get("notes")) ?? [];
await then.storage.set("notes", [...notes, { text: "memo" }]);
await then.storage.delete("notes");
```

保存値はJSONとして表現できる値に限る。プロジェクトを開いていない場合は利用できない。

### コマンドとショートカット

```js
await then.commands.registerCommand(
  {
    id: "capture-selection",
    title: "選択範囲を記録",
    keybinding: "Mod+Alt+M",
    menus: ["editor.selection"],
  },
  async () => { /* ... */ },
);
```

コマンドはThenのコマンドパレットにも現れる。`Mod` はWindows/LinuxのCtrl、macOSのCommandを表す。Then組み込みショートカットは優先される。

`menus: ["editor.selection"]` を指定したコマンドは、本文に空でない選択範囲があるとき、その右クリックメニューの「プラグイン」にも表示される。ハンドラでは `then.editor.getSelection()` から対象範囲を取得する。

### ツールビュー

```js
await then.views.registerToolView(
  { id: "selection-notes", title: "Notes" },
  async (container) => {
    const button = document.createElement("button");
    button.textContent = "選択範囲を記録";
    button.onclick = async () => {
      const selection = await then.editor.getSelection();
      const anchor = await then.anchors.create(selection);
      console.log(anchor.id);
    };
    container.append(button);
  },
);
```

ビュー内の `document` はプラグイン自身のiframeだけを指し、Then本体のDOMには到達しない。

ツールビューは右サイドバーのレイアウト内へ埋め込まれ、Zoneモードでサイドバーを一時表示・非表示にした場合もサイドバーと一体で動く。画面端へ独立したオーバーレイを作ってはならない。

同じプラグインから `registerToolView` を複数回呼び出すと、右サイドバーへ複数のビューを登録できる。`id` はそのプラグイン内のツールビューと作業画面を通して重複させない。各ビューには、manifestのアイコンを上書きする識別用アイコンを任意で指定できる。

```js
await then.views.registerToolView(
  {
    id: "tickets-unstarted",
    title: "未着手チケット",
    icon: { paths: ["M5 4h14v16H5z", "M8 8h8M8 12h5"] },
  },
  renderUnstartedTickets,
);

await then.views.registerToolView(
  {
    id: "tickets-doing",
    title: "進行中チケット",
    icon: { paths: ["M12 3a9 9 0 1 0 9 9", "M12 7v5l3 2"] },
  },
  renderDoingTickets,
);
```

ビュー別アイコンも固定の `0 0 24 24` viewBoxへ描画され、manifestと同じSVG path data制約を受ける。指定しない場合はプラグインのmanifestアイコンを使う。

### 作業画面

```js
await then.views.registerScreen(
  { id: "notes-library", title: "Selection Notes" },
  async (container) => {
    const heading = document.createElement("h1");
    heading.textContent = "Selection Notes";
    container.append(heading);
  },
);
```

作業画面を登録すると、本文・キャンバス・エクスポート・チェックポイントと同じトップバーの画面切替領域にmanifestのアイコンが追加される。選択時はトップバーを残した作業領域全体へプラグイン画面を表示する。独立ウィンドウや本文上のオーバーレイにはしない。

画面を登録するプラグインはmanifestへ `icon` を指定しなければならない。各作業画面の定義にも任意の `icon` を指定でき、未指定時はmanifestのアイコンを使う。タイトルはボタンのツールチップとアクセシブル名に使用される。

### ビューを開く

```js
await then.views.open("notes-library");
```

同じプラグインが登録したツールビューまたは作業画面をIDで開く。作業画面はトップバーのモードを切り替え、ツールビューは本文画面へ戻して右サイドバーを展開する。未登録IDや別プラグインのビューは開けない。

### 全面モーダル

```js
await then.views.registerModal(
  { id: "ticket-detail", title: "チケット詳細" },
  async (container) => {
    container.innerHTML = `<main class="backdrop"><section role="dialog" aria-modal="true">...</section></main>`;
  },
);

await then.views.openModal("ticket-detail");
await then.views.closeModal("ticket-detail");
```

全面モーダルは現在の本文、ツールビュー、作業画面を切り替えず、その上へプラグインiframeを重ねて表示する。閉じると直前の画面とサイドバー状態へ戻る。プラグイン側は背景、ダイアログ本体、保存・キャンセル操作をレンダリングし、キャンセル・背景クリック時には `closeModal` を呼ぶ。Then側でも `Escape` によって閉じられる。同時に表示できるプラグインモーダルは1つだけである。

モーダルはThen本体のDOMへアクセスせず、既存のサンドボックスとテーマトークンを維持する。ツールビューiframeの範囲に限定した疑似モーダルを作る必要はない。

### ステータスバー

```js
await then.statusBar.setItem({
  id: "current-ticket",
  text: "#001 冒頭を推敲する",
  tooltip: "現在のチケット",
  commandId: "open-current-ticket",
});

await then.statusBar.removeItem("current-ticket");
```

本文画面下部の中央へ短い状態項目を表示する。`commandId` は同じプラグインが登録したコマンドIDに限り、指定するとクリック可能になる。項目IDはプラグイン内で一意にする。アプリ再起動時には再登録が必要で、永続化したい値は `then.storage` に保存する。

### テーマとUI

Thenはプラグインiframeへ現在のテーマを同期し、以下のCSSカスタムプロパティを提供する。プラグインは明色・暗色を固定せず、これらのセマンティックトークンを使う。

```css
.toolCard {
  border: 1px solid var(--then-border);
  border-radius: var(--then-radius-card);
  background: var(--then-surface);
  color: var(--then-text);
  font-family: var(--then-font-family);
}

.toolButton {
  border-radius: var(--then-radius-button);
  background: var(--then-accent);
  color: var(--then-on-accent);
}
```

主なトークンは `--then-background`、`--then-surface`、`--then-surface-hover`、`--then-input-background`、`--then-border`、`--then-border-strong`、`--then-text`、`--then-text-secondary`、`--then-text-muted`、`--then-text-faint`、`--then-accent`、`--then-accent-strong`、`--then-on-accent`、`--then-accent-soft`、`--then-danger`、`--then-danger-soft`、`--then-control-hover`、`--then-radius-control`、`--then-radius-card`、`--then-radius-button`、`--then-font-family` である。

JavaScriptからテーマ変更へ反応する場合は `then.ui` を使う。

```js
const currentTheme = then.ui.getTheme();
const subscription = then.ui.onDidChangeTheme((theme) => {
  console.log(theme.id, theme.mode);
});
```

## 権限

| 権限 | 許可する機能 |
| --- | --- |
| `document:read` | 文書変更通知と変更後本文 |
| `document:selection` | 選択範囲の取得と選択変更通知 |
| `document:navigate` | 文書・位置・範囲へのカーソル移動 |
| `document:anchors` | 永続アンカーの作成、解決、移動、削除 |
| `views` | 右ツールビューと上部作業画面の登録 |
| `statusbar` | 本文画面下部の中央へ状態項目を追加・削除 |
| `storage` | プロジェクト単位データの読み書き |
| `commands` | コマンドとショートカットの登録 |

## サンプルプラグイン

- [`plugin-example`](plugin-example/): 選択範囲へ永続アンカー付きノートを保存するSelection Notes。右ツールビューと一覧画面の両方を実装している。
- [`ticket`](ticket/): プロジェクト単位のTicket管理。削除後も再利用しない固定の自動付番ID、全画面カンバン、手動並べ替え、本文画面を維持する全面詳細モーダル、ゴミ箱からの復旧、現在チケットのステータスバー表示、選択範囲からのチケット作成を実装している。

どちらも対象フォルダを「プラグインを追加…」で選べば、そのまま導入できる。

## v1の制限

- エントリは単一JavaScriptファイル。追加アセットとパッケージ依存のローダーは未提供。
- プラグイン更新UI、署名、配布レジストリは未提供。更新時は一度削除してから新しい版を導入する。
- 外部編集で同一文字列と同一コンテキストが複数生じたアンカーは、安全のため未解決になる。
