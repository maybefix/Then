# brew

Tauri v2 + React + TypeScript + Vite で作る、Markdown本文執筆向けのスニペットエディタ。

リリース時のソフト名は `brew`。Windows 向け Tauri デスクトップアプリとして提供する。

## 実装済み

- Milkdown による Markdown WYSIWYG 編集
- 本文 Markdown の自動保存・復元
  - Tauri 実行時はアプリデータフォルダの `app-state.json`
  - ブラウザ実行時は `localStorage`
- `.md` ファイルのオープン、保存、名前を付けて保存
- プロジェクトフォルダ配下のサブフォルダと `.md` ファイルを辿る階層パンくず
- パンくずメニューからの新規ファイル/フォルダ作成、リネーム、削除
- パンくずメニュー内の上下ボタンによる並び替えと `.brew/project.json` への順序保存
- `+` ボタンから開くモーダルでのスニペット追加、編集、削除、並び替え、検索
- ダブルクリックとドラッグアンドドロップによるスニペット挿入
- モーダルでのフォント、文字サイズ、行間、タイプライタースクロール設定
- Tauri 実行時の Windows OS フォント一覧取得
- 保存状態表示、文字数表示、挿入・保存トースト
- `brew` 名での Tauri リリースビルドとインストーラ生成

## 起動

```powershell
npm install
npm run tauri:dev
```

ブラウザで UI 確認だけを行う場合:

```powershell
npm run dev:local
```

## ビルド確認

```powershell
npm run build
npm run tauri:build
```

## ドキュメント

- `docs/CURRENT_STATE.md`: 現在地点
- `docs/REQUIREMENTS_GAP_LIST.md`: 要件整理と不足リスト
