# brew 0.2.0 実装計画

## ゴール

0.2.0 では、既存機能を壊さずに、モックアップに沿った UI 構成と複数 Markdown ファイルの左側タブ切り替えを実装する。

## 実装ステップ

### 1. 純粋ロジック分離

UI 変更を入れる前に、`App.tsx` 内の純粋関数を `utils` に分離する。

- frontmatter の parse/compose/update。
- ProjectEntry の検索、親探索、並び替え。
- workspace 名、親パス、recent workspace 更新。

この段階では UI と挙動を変えない。以後の多タブ状態モデル導入時に、同じヘルパーを各タブ状態から使えるようにする。

### 2. ドキュメントタブ状態モデル導入

現在の `currentFilePath`、`currentFileName`、`documentKey`、`markdown` を、複数タブを扱える状態へ移行する。

- `openTabs: DocumentTab[]`
- `activeTabId: string`
- `DocumentTab` は scratch と file の両方を表現する。
- 各タブは本文、保存状態、ファイルパス、表示名、エディタ key を持つ。
- 既存の単一ファイル表示は active tab から導出する。

### 3. タブ操作の実装

左側タブで実際に複数 Markdown ファイルを開き、切り替えられるようにする。

- ファイルを開く時、既に開いていればそのタブをアクティブにする。
- 未オープンなら新しいタブを追加する。
- タブ切り替え時に本文、保存状態、パス、アウトライン文脈を切り替える。
- タブを閉じる時は未保存確認を行う。
- scratch 保存時は同じタブを保存先ファイルへ昇格する。

### 4. TabRail UI 導入

モックアップに沿って左側の TabRail を追加する。

- ファイルアイコン、ファイル名、閉じるボタンを表示する。
- アクティブタブを視覚的に示す。
- 下部に新しいタブ作成ボタンを置く。
- 既存のファイルメニューやパンくずと競合しないよう、段階的に配置する。

### 5. レイアウトコンポーネント分割

`App.tsx` から主要 UI を分割する。

- `WindowBar`
- `TabRail`
- `DocumentBar`
- `EditorPane`
- `SnippetPane`
- `StatusBar`

状態の所有は `App.tsx` に残し、表示コンポーネントは props で受ける。

### 6. スニペットと設定 UI の分割

スニペット操作、設定モーダル、入力/確認ダイアログを分離する。

- `SnippetPane`
- `SnippetCard`
- `SnippetModal`
- `SettingsModal`
- `AppDialog`

### 7. モックアップ準拠の視覚刷新

構造分割後に CSS を刷新する。

- WindowBar、TabRail、DocumentBar、EditorPane、SnippetPane、StatusBar の領域をモックアップに合わせる。
- 色、余白、境界、検索ボックス、スニペットカードを CSS 変数で整理する。
- タブ、カード、ボタンの寸法を固定し、テキストあふれを抑える。

### 8. 回帰確認

主要操作を確認する。

- `npm run build`
- scratch 起動。
- workspace 復元。
- 複数ファイルを開いてタブ切り替え。
- 各タブの保存、保存前確認、閉じる。
- スニペット検索、追加、編集、削除、挿入。
- フォルダツリー、パンくず、リネーム、削除、並び替え。
