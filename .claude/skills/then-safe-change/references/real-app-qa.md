# 実機確認（QA 用アプリ）

ふだんの Then と別の識別子で build した QA 用アプリを、scratchpad の一時ライブラリで動かす。設定もライブラリも利用者のものとは共有しない。画面は WebView2 のデバッグポートから操作する。

## 目次
1. 流れ
2. 一時ライブラリの spec
3. 操作の仕方
4. 画面の部品と落とし穴
5. 確かめる項目の表
6. 片付け

## 1. 流れ

識別子は `local.then.qa.<topic><MMDD>` にする（例 `local.then.qa.ideasplit1023`）。`<skill>` は `.claude/skills/then-safe-change`、`<qa>` は scratchpad の中のフォルダ。

1. **build**（3〜4分、バックグラウンドで。終わると通知が来る）。`npm run build` と同時に動かさない。
   ```bash
   node <skill>/scripts/qa/qa-build.mjs local.then.qa.<topic> --log <qa>/build.log
   ```
   出来上がりは `src-tauri/target/release/Then.exe`。ふだん用の build はここで上書きされるので、最後の報告に書く。
2. **一時ライブラリを作る**（build のあいだに spec を書いておく。次の章）。
   ```bash
   node <skill>/scripts/qa/qa-seed.mjs local.then.qa.<topic> <qa>/seed.json <qa>/lib
   ```
3. **起動する**: 「QA アプリを起動する。止める条件は q.mjs stop、10分間操作がない、45分」と書いてから、バックグラウンドで動かす。
   ```bash
   node <skill>/scripts/qa/qa-session.mjs local.then.qa.<topic> --port 47811
   ```
4. **手助けを読み込み、起動画面を抜ける**:
   ```bash
   Q="node <skill>/scripts/qa/q.mjs"
   $Q evalfile <skill>/scripts/qa/qa-page.js
   $Q eval 'qa.startup()'
   ```
5. **確かめる**（3章）。1回の呼び出しで1つの確認をして、結果を見てから次へ進む。
6. **保存を確かめる**: 操作のあと2秒以上待ってから（遅延保存は0.7秒）、作品の `.then/` のファイルを node で読み、`qa.idea.snapshot()` などの画面の値と突き合わせる。
7. **再起動**: `$Q stop` で止め、残りが0であることを確かめる。同じ識別子で `qa-session.mjs` を起動し直す（アプリ状態は `%APPDATA%\<identifier>` に残っている）。再起動の前に画面の全体を JSON に保存しておき、起動後と比べる。
8. **片付け**（6章）。

## 2. 一時ライブラリの spec

`qa-seed.mjs` の先頭に形が書いてある。見本（Idea を確かめたときのもの）:

```json
{
  "library": "QAライブラリ",
  "works": [
    { "name": "作品A",
      "files": { "本文.txt": "作品Aの本文です。\n" },
      "then": {
        "project.json": { "ideaThreads": [
          { "id": "idea-inbox", "kind": "inbox", "title": "インボックス", "starred": false, "createdAt": 1, "updatedAt": 1,
            "fragments": [{ "id": "a-inbox-1", "body": "インボックスのメモ", "used": false, "createdAt": 1, "updatedAt": 1 }] },
          { "id": "qa-scene", "kind": "thread", "title": "場面", "starred": false, "createdAt": 1, "updatedAt": 1,
            "fragments": [{ "id": "a1", "body": "場面の一", "used": false, "createdAt": 1, "updatedAt": 1 }] } ] },
        "boards/qa-board.canvas": { "nodes": [
            { "id": "qa-node-1", "type": "text", "x": 120, "y": 120, "width": 260, "height": 150, "text": "Canvasのカード" },
            { "id": "qa-node-2", "type": "text", "x": 460, "y": 120, "width": 260, "height": 150, "text": "元Ideaのカード",
              "thenOrigin": { "source": "idea", "sourceId": "a1", "sourceThreadId": "qa-scene", "sourceWorkspacePath": "{work:作品A}", "copiedAt": 1 } } ],
          "edges": [], "then": { "version": 1, "name": "QAボード", "scope": "project", "createdAt": 1, "updatedAt": 1 } } } },
    { "name": "作品B", "files": { "本文.txt": "作品Bの本文です。\n" },
      "then": { "project.json": { "ideaThreads": [] } } }
  ],
  "open": { "work": "作品A", "file": "本文.txt" },
  "appState": { "settings": {}, "rightSidebarTab": "idea" }
}
```

- 作品の切り替えを確かめるなら、作品を2つ用意し、それぞれに見分けのつくデータを入れる。
- 保存先のファイル: Idea は `.then/project.json` の `ideaThreads`、スレッド内の並び順と開いているカードは `.then/reference-layouts/default.json`、Canvas のボードは `.then/boards/<id>.canvas`、取り込んだ資料は `.then/references/imports/`。
- `appState.rightSidebarTab` に `"idea"`・`"plot"`・`"ai"` などを入れると、最初からその右サイドバーが開く。
- 設定は、既定のままでよければ `{}` にする。利用者の設定を写さない。

## 3. 操作の仕方

- **クリック**: `$Q eval 'qa.label("Idea Board を開く").click()'` のように、要素の `click()` で足りる。キャンバスのカードを選ぶときのように、本物のマウスの押下が要るものは `$Q click <x> <y>` を使う。座標は `getBoundingClientRect()` で出し、`document.elementFromPoint` でその点がほかの部品に隠れていないか確かめる（右サイドバーの下に入ることがある）。
- **文字入力**: 入力欄に `focus()` してから `$Q type '文字'`。React の onChange が本物の入力と同じく動く。置き換えたいときは、先に `select()` する。
- **キー**: `$Q key Enter`、`$Q key Escape`、`$Q key i --mods ctrl,alt`（Ctrl+Alt+I）。ショートカットは本文にフォーカスしてから押す（`document.querySelector(".ProseMirror").focus()`）。
- **select**: `qa.setSelect(selectElement, value)`。value を直接入れるだけでは React が気づかない。
- **ドラッグ**: CDP でのドラッグは難しいので、ページの中で `new DataTransfer()` を作り、`dragstart` → `dragover` → `drop` → `dragend` の `DragEvent` を順に `dispatchEvent` する。`dragover` の `defaultPrevented` で受け付けたかが、`dataTransfer.types` と `getData()` で中身が分かる。
- **待つ**: `await qa.waitFor(() => 条件, ミリ秒, "何を")`。決め打ちの待ち時間より速く確実。

## 4. 画面の部品と落とし穴

- **起動画面**: ボタンの文字は「前回の執筆を続ける作品A」のように作品名が続くので、先頭で比べる（`qa.startup()` がしている）。ライブラリの初期設定が出たら「あとで」。
- **通知**: `.toast`。操作（「元に戻す」など）の付いた通知は5秒で消える。押すなら、操作と同じ eval の中で `qa.clickToast()` する。
- **確認と入力のダイアログ**: `.modal`。ボタンは `qa.dialogButton("削除")`。入力欄は `.modal input`。
- **右サイドバーの切り替え**: `aria-label` が「補助ペイン：…」のボタンのほう（左には「表示するファイル：…」がある）。`qa.rightPane("バインダー")`。
- **画面モード**: `.modeMenuButton` から「本文」などを選ぶ。`qa.mode("本文")`。
- **作品の切り替え**: パンくずの先頭（`aria-label="プロジェクトを切り替え"`）→ `.workspaceRecordButton`。`qa.switchWork("作品B")`。
- **設定**: 「設定」ボタン → タブ（「外観」「本文」「ファイル」「キャンバス」「出力」「AI」）。`qa.openSettings("ファイル")`。
- **Idea**: 一覧と詳細は同時に DOM にある（`section.ideaView[aria-label="スレッド一覧"|"スレッド詳細"]`）。探すときは、どちらかに絞る。`qa.idea.*` に一通りの操作がある。
- **OS のダイアログ**（ファイル選択、保存先選択）は操作できない。代わりの入口（「新しいテキスト資料」など）を使い、確かめられなかったことを書く。
- **invoke の差し替え**: `window.__TAURI_INTERNALS__.invoke` は差し替えられない。Rust への呼び出しを見たいときは、CDP の `Network.enable` で `http://ipc.localhost/<command>` への要求を見る。

## 5. 確かめる項目の表

手順書の工程9に、次の形で書く。

| 確認したこと | 結果 |
|---|---|
| （利用者が挙げた項目を、挙げた順に） | （画面で見えたこと。文言はそのまま引用。保存ファイルと突き合わせたなら、そう書く） |

続けて、「今の挙動の癖を実機で確かめた結果」「確かめられなかったこと（理由）」「片付け」を書く。

## 6. 片付け

```bash
$Q stop
node <skill>/scripts/qa/qa-cleanup.mjs local.then.qa.<topic> --library <qa>/lib
git status --short
```

`qa-cleanup.mjs` は、QA の Then・WebView2・テストの node と Edge が残っていれば止め、`%APPDATA%\<identifier>` と `%LOCALAPPDATA%\<identifier>` と一時ライブラリを消して、残りの数を出す。全部が0で、`git status` に意図しない変更（`src-tauri/Cargo.toml` の改行など）がないことを確かめてから、報告に書く。
