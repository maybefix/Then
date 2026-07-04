# フォルダ削除・Trash・チェックポイント・AST 実装計画

作成日: 2026-07-04

## 目的

左サイドバーのファイルツリーで、中身のあるフォルダを削除できるようにする。

現状はバックエンドが `std::fs::remove_dir` を使っているため、空フォルダだけ削除できる。これは誤削除を避ける安全策として一定の意味はあるが、他のエディタの一般的な挙動とは異なり、UI上も「削除ボタンは押せるが失敗する」という分かりにくい状態になっている。

この計画では、フォルダ削除を単なるファイルシステム操作ではなく、Then のプロジェクト状態変更として扱う。削除対象を事前に列挙し、Trash へ移動し、Project AST・開いているタブ・検索結果・アウトライン・チェックポイント復元仕様を一貫して同期する。

## 結論

採用する方針:

- 中身のあるフォルダ削除を許可する。
- 削除は完全削除ではなく、原則として OS ゴミ箱またはアプリ内 Trash へ移動する。
- 削除時に自動チェックポイントは作らない。
- チェックポイントはユーザーが任意のタイミングで明示的に作成する原稿版管理機能として扱う。
- 削除前に削除対象を再帰的に列挙し、件数と内容を確認ダイアログへ表示する。
- 削除後は削除 manifest を使って `projectFolder`、`ProjectAst`、開いているタブ、現在ファイル、フォーカス中フォルダ、検索/アウトライン表示を同期する。
- チェックポイント復元は `snapshot.files` だけでなく `snapshot.projectTree` も使い、空フォルダを含むプロジェクト構造を復元できるようにする。

採用しない方針:

- 中身のあるフォルダを削除不可のままにする。
- `remove_dir_all` による即時完全削除へ直行する。
- フォルダ削除のたびに自動チェックポイントを作る。
- AST を正本として削除/復元の根拠にする。
- チェックポイントを Trash の代替として使う。

## 背景

### 現状の削除実装

`src-tauri/src/lib.rs` の `delete_project_entry` は、ファイルには `remove_file`、フォルダには `remove_dir` を使っている。

`remove_dir` は空フォルダしか削除できない。そのため中身のあるフォルダを削除しようとすると、UIでは削除操作を開始できるがバックエンドで失敗する。

`docs/CURRENT_STATE.md` にも「フォルダ削除は安全のため空フォルダのみ対応」と記載されている。

### 他エディタとの比較

VS Code、Obsidian、JetBrains 系 IDE などでは、ファイルツリーから中身のあるフォルダを削除できるのが一般的である。ただし、多くは OS ゴミ箱へ移動する、削除確認を出す、参照破壊を検査する、などの安全策を別レイヤーで持っている。

Then でも「削除できない」ことを安全策にするのではなく、「削除できるが戻せる」「影響範囲が見える」「アプリ状態が壊れない」ことを安全策にする。

## 責務分離

### Trash の責務

Trash は削除操作の復元性を担う。

- 誤って削除したファイル/フォルダを戻せるようにする。
- テキストファイル、非テキストファイル、空フォルダを区別せず扱う。
- フォルダ削除時の実体移動を担う。
- チェックポイント履歴を汚さない。

### チェックポイントの責務

チェックポイントは原稿の意味ある版管理を担う。

- ユーザーが明示的に作成した時点の原稿状態を保存する。
- 本文テキスト、AST由来のメタ情報、プロジェクトツリーを保持する。
- 削除操作のたびに自動作成しない。
- 復元時は保存済みの原稿状態へ戻す。
- Trash の代替にはしない。

### AST / ProjectAst の責務

AST は本文から派生するキャッシュであり、正本ではない。

- 削除時に AST を保存対象として扱わない。
- 削除 manifest に基づいて ProjectAst から削除済みファイルを除外する。
- 復元後はファイルシステム上のテキストから再構築する。
- 検索、アウトライン、文字数などの派生表示を最新状態へ同期する。

## 用語

### Delete Plan

削除実行前にバックエンドで作る削除予定情報。

削除対象の root、配下のファイル/フォルダ、テキストファイル件数、非テキストファイル件数、空フォルダ件数、総バイト数などを持つ。

### Delete Manifest

削除実行後にバックエンドが返す確定結果。

削除または Trash 移動された path 一覧、ファイル一覧、フォルダ一覧、Trash 移動の成否、復元に必要な情報を持つ。

### Trash

削除済み項目の退避先。

OS ゴミ箱を優先する。OS ゴミ箱が使えない場合はアプリ内 Trash を使う。

### Project Change Transaction

削除、復元、移動、リネームなど、プロジェクト構造を変える操作を一貫して扱う概念。

この計画ではフォルダ削除を Project Change Transaction として実装する。

## データ設計

### DeleteProjectEntryPlan

フロントエンドへ削除確認を出すための型。

```ts
type DeleteProjectEntryPlan = {
  rootPath: string;
  rootName: string;
  rootKind: "file" | "folder";
  fileCount: number;
  folderCount: number;
  textFileCount: number;
  nonTextFileCount: number;
  emptyFolderCount: number;
  totalBytes: number;
  paths: string[];
  filePaths: string[];
  folderPaths: string[];
  textFilePaths: string[];
  nonTextFilePaths: string[];
  warnings: string[];
};
```

`warnings` には、読み取り不可、Trash利用不可、プロジェクト外参照、対象が存在しない、などを入れる。

### DeleteProjectEntryResult

削除実行後に UI と AST を同期するための型。

```ts
type DeleteProjectEntryResult = {
  deletedRootPath: string;
  deletedRootName: string;
  deletedPaths: string[];
  deletedFilePaths: string[];
  deletedFolderPaths: string[];
  deletedTextFilePaths: string[];
  deletedNonTextFilePaths: string[];
  movedToTrash: boolean;
  trashPath: string | null;
  fallbackUsed: "none" | "appTrash" | "permanentDelete";
  completedAt: number;
};
```

`deletedPaths` は ProjectAst、タブ、フォーカス状態を同期するための正本とする。

### App Trash Metadata

アプリ内 Trash を使う場合は、移動先に manifest を保存する。

```ts
type AppTrashManifest = {
  id: string;
  originalRootPath: string;
  originalRootName: string;
  trashedRootPath: string;
  movedAt: number;
  paths: {
    originalPath: string;
    trashedPath: string;
    kind: "file" | "folder";
  }[];
};
```

保存場所はプロジェクトルート直下ではなく、アプリデータディレクトリ配下を基本にする。プロジェクト内に `.trash` を置くと、原稿ツリーや検索対象に混ざるため避ける。

## バックエンド実装

### 追加 Tauri command

既存の `delete_project_entry(path: String) -> Result<(), String>` は互換のため残してもよいが、ファイルツリーからの削除は新APIへ移行する。

追加する command:

- `plan_delete_project_entry(root_path: String, path: String) -> Result<DeleteProjectEntryPlan, String>`
- `delete_project_entry_to_trash(root_path: String, path: String) -> Result<DeleteProjectEntryResult, String>`
- `restore_project_entry_from_app_trash(root_path: String, trash_id: String) -> Result<ProjectFolder, String>`

`root_path` を必須にし、削除対象がプロジェクトルート配下にあることを検証する。

### パス検証

削除対象は必ず canonicalize して検証する。

- `root_path` が存在するディレクトリであること。
- `path` が存在すること。
- `path` が `root_path` 配下であること。
- `path` が `root_path` 自体ではないこと。
- `.brew` などアプリ内部管理ディレクトリは削除対象から除外または禁止する。
- symlink は実体追跡でプロジェクト外へ出ないように扱う。

### 削除対象の列挙

`plan_delete_project_entry` は削除前に対象を再帰的に列挙する。

列挙時に行うこと:

- ファイルとフォルダを分ける。
- テキストファイルと非テキストファイルを分ける。
- 空フォルダ数を数える。
- 総バイト数を計算する。
- 権限エラーや読み取り不可を warning に入れる。
- symlink は通常ファイル/ディレクトリと別扱いにし、必要なら warning を出す。

テキストファイル判定は既存の `list_project_folder` と同じ基準を使う。

### Trash 実行

削除実行は次の順序にする。

1. 削除直前に再度 plan を作る。
2. 対象がプロジェクト配下か再検証する。
3. OS ゴミ箱へ移動を試みる。
4. OS ゴミ箱が使えない場合はアプリ内 Trash へ移動する。
5. それも失敗した場合はエラーにする。
6. 完全削除は通常経路では実行しない。

完全削除を提供する場合は、別API・別確認・別文言にする。

### App Trash

OS ゴミ箱が失敗する環境に備え、アプリ内 Trash を用意する。

保存先例:

```text
<app_data_dir>/trash/<workspace_hash>/<trash_id>/
```

同名衝突を避けるため、`trash_id` は timestamp と random suffix を含める。

App Trash へ移動する際は、元パスと移動先の対応を `AppTrashManifest` として保存する。

### project order config の扱い

`.brew/project.json` などの並び順設定がある場合、削除した path に対応する order entry を掃除する。

ただし Trash から戻す可能性があるため、復元時には次のいずれかを選ぶ。

- manifest に order 情報を含めて復元する。
- 復元後に通常の並び順ルールへ再配置する。

フル機能としては manifest に order 情報を含めて復元する。

## フロントエンド実装

### 削除フロー

`handleDeleteProjectEntry` は次の流れへ変更する。

1. `plan_delete_project_entry` を呼ぶ。
2. plan を使って確認ダイアログを出す。
3. ユーザーが確認したら `delete_project_entry_to_trash` を呼ぶ。
4. result の manifest を使って UI 状態を同期する。
5. `refreshProjectFolder(projectFolder.path)` を呼ぶ。
6. ProjectAst を更新または再構築する。
7. toast で結果を知らせる。

### 確認ダイアログ

フォルダ削除時の文言例:

```text
「資料」フォルダを削除しますか？

配下のテキストファイル 12 件、その他ファイル 2 件、フォルダ 4 件をゴミ箱へ移動します。
チェックポイントには影響しません。
```

ファイル削除時の文言例:

```text
「第一章.txt」を削除しますか？

ファイルをゴミ箱へ移動します。
チェックポイントには影響しません。
```

Trash が使えず App Trash へ移動する場合:

```text
OSのゴミ箱を利用できないため、Then のアプリ内Trashへ移動します。
```

完全削除しかできない場合は、通常の削除確認とは別に強い確認を出す。

```text
ゴミ箱へ移動できないため、完全に削除します。
この操作はOSのゴミ箱から復元できません。
```

### UI 状態同期

削除成功後は `DeleteProjectEntryResult` を正本として状態を更新する。

同期対象:

- `projectFolder`
- `openTabs`
- active tab
- `currentFilePath`
- `focusedFolderPath`
- `activeBreadcrumbPath`
- `appState.lastFilePath`
- `projectAst`
- project search results
- current outline
- save status
- error state

削除対象配下のタブは閉じる。

現在開いているファイルが削除対象だった場合:

1. 削除後の project tree から次のテキストファイルを探す。
2. あればそのファイルを開く。
3. なければ scratch document に切り替える。
4. `lastFilePath` は null または次に開いたファイルへ更新する。

フォーカス中フォルダが削除対象配下だった場合:

1. 削除対象の親フォルダへ戻す。
2. 親も存在しない場合は project root へ戻す。

### 削除ボタンの扱い

中身のあるフォルダでも削除ボタンは有効にする。

ただし、次の場合は disabled または別メッセージにする。

- プロジェクトルートそのもの。
- アプリ管理ディレクトリ。
- 読み取り不可で plan を作れない対象。
- 削除権限がない対象。

## ProjectAst 実装

### 追加関数

`src/editor/ast/projectAst.ts` に次を追加する。

```ts
export function removeProjectAstPaths(
  projectAst: ProjectAst,
  deletedPaths: string[],
): ProjectAst
```

処理内容:

- `deletedPaths` を正規化する。
- `ProjectAst.files` から削除対象とその配下の file を除外する。
- `recomputeProjectAst` で集計値を再計算する。
- `updatedAt` を更新する。

### 削除時の AST 同期

削除成功後:

1. `projectAstBuildIdRef.current += 1` で進行中の index build を無効化する。
2. `removeProjectAstPaths(current, result.deletedPaths)` を適用する。
3. `refreshProjectFolder` 後に `createProjectAstSkeleton(refreshed, current)` を適用する。
4. pending file があれば既存の project AST build flow で再indexする。

削除されたファイルの AST は即座に検索対象から消える必要がある。

### 復元時の AST 同期

チェックポイント復元後:

1. `projectAstBuildIdRef.current += 1`
2. `refreshProjectFolder(projectFolder.path)`
3. `createProjectAstSkeleton(restoredFolder, null)` で skeleton を作る。
4. 復元した文書は `upsertProjectAstDocument` で即時反映する。
5. その他ファイルは既存の非同期 index build で補完する。

AST はキャッシュなので、snapshot から AST を直接復元しない。

## チェックポイント実装

### 現状

チェックポイントは `ManuscriptSnapshot` として以下を持っている。

- `projectTree`
- `files`
- `fileCount`
- `totalTextLength`
- `totalVisibleTextLength`

現在の復元処理は主に `snapshot.files` を使い、各 file の `path` へ `save_text_file` している。親フォルダは `save_text_file` 側で作られる可能性があるが、空フォルダや非テキストファイルの復元は保証していない。

### 改善方針

チェックポイント復元では `snapshot.projectTree` を使い、空フォルダを含む構造を復元する。

復元処理の順序:

1. 復元対象 snapshot が現在 workspace と一致するか検証する。
2. 復元確認を出す。
3. `snapshot.projectTree` からフォルダ構造を作成する。
4. `snapshot.files` を `save_text_file` で保存する。
5. snapshot に存在しない現在のテキストファイルを削除するか確認する。
6. `projectFolder` を refresh する。
7. open tabs を restored documents に合わせて更新する。
8. ProjectAst を再構築する。

### 追加 command

空フォルダ復元のため、バックエンドに次を追加する。

- `ensure_project_folder_tree(root_path: String, tree: ProjectFolder) -> Result<(), String>`

この command は `ProjectFolder` の構造だけを見てディレクトリを作る。ファイルは作らない。

検証:

- tree root が現在 workspace root と一致すること。
- 各 folder path が root 配下であること。
- `.brew` など管理ディレクトリを不正に作らないこと。

### 追加ファイル削除の扱い

現状の復元処理は、snapshot に存在しない現在のテキストファイルを削除している。

この仕様は維持できるが、フォルダ削除対応後は削除対象が増えるため、復元確認で明示する。

文言例:

```text
「終盤改稿前」に戻しますか？

現在のテキストファイル 3 件はチェックポイントに存在しないため、ゴミ箱へ移動します。
空フォルダを含むプロジェクト構造も復元します。
```

追加ファイル削除も `delete_project_entry_to_trash` を使い、完全削除しない。

### 自動チェックポイントは作らない

フォルダ削除時に自動チェックポイントは作らない。

理由:

- 削除の復元性は Trash が担う。
- チェックポイントはユーザーが意味ある時点を残すための機能である。
- 整理操作のたびにチェックポイントが増えると履歴が汚れる。
- 現状のチェックポイントは非テキストファイルや空フォルダの完全バックアップではない。

復元操作前の「復元前の退避」は、既存通り維持してよい。これは削除操作ではなく、チェックポイント復元という大きな状態変更に対する退避であり、責務が異なる。

## App State との整合

### openTabs

削除対象配下のタブは閉じる。

閉じる前に未保存変更がある場合:

- 削除確認前に保存確認を出す。
- 保存する場合は保存後に削除 plan を作り直す。
- 保存しない場合はそのタブの未保存変更は破棄されることを確認文へ含める。

### appState.markdown

active document が削除された場合は、次に開く document または scratch document の本文へ更新する。

### cursorPositions

削除された path の cursor position は削除する。

チェックポイント復元で同じ path が戻った場合、本文長が一致する場合のみ復元する既存方針を維持する。

### lastFilePath

削除された path を指している場合は null にするか、次に開いたファイルへ更新する。

### workspace history

workspace root 自体は削除対象にしないため、recent workspaces には影響させない。

## エラー処理

### plan 作成失敗

削除確認を出さず、toast と `lastError` に理由を表示する。

### Trash 移動失敗

OS Trash に失敗した場合は App Trash に fallback する。

App Trash にも失敗した場合は削除しない。

完全削除へ進む場合は、通常の confirm とは別に明示確認を必須にする。

### 部分失敗

フォルダ移動は root 単位の rename/trash move を基本にし、部分削除が起きにくいようにする。

App Trash で複数ファイルを個別移動する場合は、失敗時に rollback を試みる。

rollback に失敗した場合は、`DeleteProjectEntryResult` に成功分と失敗分を含め、UIを refresh して実ファイルシステムを正とする。

## セキュリティと安全性

- canonical path で root 配下検証を行う。
- symlink が root 外へ出る場合は削除対象として扱わないか、symlink 自体だけを削除する。
- root path 自体の削除は禁止する。
- アプリ管理ディレクトリの削除は禁止する。
- Trash への移動結果を検証する。
- delete manifest はフロントから渡さず、バックエンドが実ファイルシステムから作る。
- フロントの `ProjectEntry` 情報だけを信用しない。

## UI/UX

### 左サイドバー

ファイル、空フォルダ、中身のあるフォルダのいずれも削除可能にする。

削除確認には対象件数を必ず表示する。

### パンくずメニュー

パンくず内の削除ボタンも同じ削除フローを使う。

### Toast

成功時:

```text
「資料」をゴミ箱へ移動しました
```

App Trash fallback 時:

```text
「資料」をThenのTrashへ移動しました
```

失敗時:

```text
「資料」を削除できませんでした
```

### チェックポイント説明

削除確認では「チェックポイントには影響しません」と明記する。

チェックポイント復元では「Trash の復元」ではなく「保存済みの原稿状態へ戻す」と説明する。

## テスト計画

### Rust unit/integration

- 空フォルダの plan が正しい。
- 中身のあるフォルダの plan が正しい。
- ネストしたフォルダの file/folder count が正しい。
- テキストファイルと非テキストファイルを区別できる。
- root path 自体を削除できない。
- root 外 path を削除できない。
- `.brew` など管理ディレクトリを削除できない。
- OS Trash 失敗時に App Trash へ fallback する。
- App Trash manifest が作られる。
- App Trash から元パスへ復元できる。
- symlink の扱いが root 外へ漏れない。

### TypeScript unit

- `removeProjectAstPaths` が単一ファイルを除外する。
- `removeProjectAstPaths` がフォルダ配下の複数ファイルを除外する。
- `removeProjectAstPaths` が集計値を再計算する。
- 削除対象ではない類似 prefix path を誤削除しない。
- 削除 manifest から openTabs を正しくフィルタできる。
- 削除 manifest から次に開くファイルを選べる。

### UI/integration

- 中身のあるフォルダで削除確認が出る。
- 確認にファイル件数、フォルダ件数、非テキストファイル件数が表示される。
- 削除後にサイドバーから消える。
- 削除後に検索結果から消える。
- 削除対象のタブが閉じる。
- active file 削除時に次のファイルまたは scratch へ切り替わる。
- focused folder 削除時に親または root へ戻る。
- チェックポイント復元で削除済みフォルダ配下のテキストファイルが戻る。
- チェックポイント復元で空フォルダが戻る。
- チェックポイント復元後に ProjectAst が再構築される。

## 実装順序

この順序は機能を削るためではなく、依存関係を壊さずフル機能へ到達するための順序である。

1. Rust に delete plan 型と recursive collector を追加する。
2. Rust に `plan_delete_project_entry` command を追加する。
3. Rust に Trash 移動層を追加する。
4. Rust に App Trash fallback と manifest 保存を追加する。
5. Rust に `delete_project_entry_to_trash` command を追加する。
6. Rust に `ensure_project_folder_tree` command を追加する。
7. TypeScript に delete plan/result 型を追加する。
8. `projectAst.ts` に `removeProjectAstPaths` を追加する。
9. `handleDeleteProjectEntry` を plan -> confirm -> trash delete -> manifest sync へ変更する。
10. 左サイドバーとパンくずメニューの削除を同じ flow に統一する。
11. openTabs/currentFile/focusedFolder/appState/projectAst の同期処理を共通 helper 化する。
12. チェックポイント復元に `snapshot.projectTree` のフォルダ構造復元を追加する。
13. チェックポイント復元時の追加ファイル削除を Trash 経由へ変更する。
14. ProjectAst rebuild / invalidation の競合を `projectAstBuildIdRef` で整理する。
15. Rust tests を追加する。
16. TypeScript tests を追加する。
17. UI integration tests を追加する。
18. ドキュメントとユーザー向け文言を更新する。

## 既存コードへの主な変更箇所

- `src-tauri/src/lib.rs`
  - delete plan 作成
  - Trash 移動
  - App Trash fallback
  - folder tree 復元
  - 既存 `delete_project_entry` の利用箇所移行

- `src/App.tsx`
  - `handleDeleteProjectEntry`
  - `handleRestoreManuscriptSnapshot`
  - open tabs 同期
  - ProjectAst invalidation
  - 確認ダイアログ文言

- `src/editor/ast/projectAst.ts`
  - `removeProjectAstPaths`
  - path 配下判定 helper

- `src/utils/projectTree.ts`
  - 削除対象配下判定 helper の共通化
  - 次に開くファイル選択 helper

- `src/types.ts`
  - delete plan/result 型
  - Trash manifest 型
  - 必要なら checkpoint restore option 型

- `docs/CURRENT_STATE.md`
  - 「フォルダ削除は安全のため空フォルダのみ対応」を削除または更新

## 完了条件

- 中身のあるフォルダを左サイドバーから削除できる。
- 削除は原則として OS ゴミ箱または App Trash へ移動される。
- 削除確認で配下のテキストファイル、非テキストファイル、フォルダ件数が分かる。
- 削除後に ProjectAst、検索、アウトライン、タブ、現在ファイル、フォーカス状態が破綻しない。
- 削除時に自動チェックポイントは作られない。
- 明示的に作成したチェックポイントから、削除済みフォルダ配下の本文ファイルを復元できる。
- チェックポイント復元で空フォルダを含む `projectTree` が復元される。
- 追加ファイル削除を伴うチェックポイント復元でも、削除は Trash 経由で行われる。
- AST は常に本文から再生成可能なキャッシュとして扱われ、削除/復元の正本にならない。
