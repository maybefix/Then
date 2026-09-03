# Then プラグイン制作・パッケージ・配布設計

作成日: 2026-09-02

状態: 設計案。本文中で「現行」と明記した機能を除き、SDKのnpm配布、開発CLI、`.thenplugin`導入、公式カタログは未実装である。

## 1. 目的

Then Plugin APIを使うプラグインについて、開発開始から利用者への配布までの標準経路を定義する。

この文書は次を扱う。

- Then本体、SDK、公式プラグインのリポジトリ境界
- SDKを使ったプラグイン開発
- TypeScriptとCSSから単一JavaScriptを生成するビルド
- `.thenplugin`パッケージの形式
- Thenへの導入と更新
- GitHub Releasesを使う初期配布
- Then内の公式プラグインカタログへの発展

Plugin APIそのものの現行仕様は [`PLUGIN_API_V1.md`](PLUGIN_API_V1.md) を参照する。

## 2. 結論

初期の標準構成を次のようにする。

| 対象 | 方針 |
| --- | --- |
| Then本体 | プラグインホスト、権限検査、インストーラー、パッケージ仕様を所有する |
| SDK | Then本体リポジトリ内で開発し、独立したnpmパッケージとして公開する |
| パッカー | SDKのCLIとして提供する。各プラグインへコピーしない |
| 公式プラグイン | Then本体とは別の `then-plugins` リポジトリで開発する |
| 開発言語 | TypeScriptを推奨し、ビルド後は単一JavaScriptにする |
| CSS | 開発時は別ファイルを許可し、ビルド時にJavaScriptへ埋め込む |
| 配布物 | 標準ZIPを独自拡張子にした `.thenplugin` とする |
| 初期配布先 | `then-plugins` リポジトリのGitHub Releasesとする |
| 初期導入経路 | Thenのプラグイン管理画面にある「ファイルから導入…」とする |
| 将来の導入経路 | Then内の公式プラグインカタログから直接導入できるようにする |
| フォルダ導入 | 一般配布には使わず、開発者向け機能として残す |

OSのファイル関連付け、ダブルクリック導入、ドラッグ＆ドロップ、公開マーケットプレイス、自動更新、作者署名は初期範囲に含めない。

## 3. 現行実装

Then v0.6.1では、`manifest.json`を含むフォルダを利用者が選択する。Thenはmanifestと単一JavaScriptエントリを検査し、ユーザーデータ領域の`plugins/<plugin-id>/`へコピーする。

現行SDKは次の2ファイルだけである。

```text
plugin-sdk/
├── then.d.ts
└── manifest.schema.json
```

- `then.d.ts`: 実行時にThenが注入するグローバル`then` APIの型定義
- `manifest.schema.json`: manifest schema v1のJSON Schema

現行のTicketはCSSを外部ファイルとして持たず、`main.js`内の`<style>`へ埋め込んでいる。そのため、現行Ticketは`manifest.json`と`main.js`だけで動作する。

## 4. リポジトリ境界

### 4.1 Then本体リポジトリ

`maybefix/Then`は次を所有する。

```text
Then/
├── src/plugins/                 # フロントエンドのプラグインホスト
├── src-tauri/src/               # 導入、検査、削除を行うバックエンド
├── plugin-sdk/                  # SDKとCLIのソース
├── tests/fixtures/plugins/      # ホストAPI検証用の小さなプラグイン
└── docs/
    ├── PLUGIN_API_V1.md
    └── PLUGIN_DEVELOPMENT_AND_DISTRIBUTION.md
```

パッケージ形式の読取側と書出側が分裂しないよう、`.thenplugin`インストーラー、JSON Schema、パッカーの仕様はこのリポジトリで管理する。

### 4.2 公式プラグインリポジトリ

公式プラグインは、Then本体から分離した`maybefix/then-plugins`で管理する。

```text
then-plugins/
├── package.json
├── package-lock.json
├── plugins/
│   ├── ticket/
│   │   ├── manifest.json
│   │   ├── package.json
│   │   ├── src/
│   │   ├── tests/
│   │   └── README.md
│   └── selection-notes/
├── registry.json
└── .github/workflows/
```

公式プラグインを分離する理由は次のとおりである。

- Then本体と異なるバージョン、リリース周期を持てる
- プラグイン更新のためにThen本体を再リリースしなくてよい
- Plugin APIのテストと、各プラグイン固有機能のテストを分離できる
- 将来、プラグインごとに保守者を分けやすい
- アプリ本体のIssueとプラグイン固有のIssueを分離できる

初期は公式プラグインをモノレポで管理する。規模や保守者が増えた場合に、個別リポジトリへ分離する。

### 4.3 SDK専用リポジトリ

初期はSDKをThen本体リポジトリ内に置く。パッケージ仕様が安定し、SDKのリリース周期がThen本体から独立した段階で、`then-plugin-sdk`リポジトリへの分離を検討する。

## 5. SDKの位置づけ

SDKは実行時ライブラリではない。プラグインの開発依存であり、完成した`.thenplugin`へSDK自体を同梱しない。

Then本体はプラグインの`main.js`を読み込み、実行時に`then` APIオブジェクトを注入する。

概念的には次の実行になる。

```js
const activate = new Function("then", pluginSource);
activate(thenApi);
```

SDKは次の機能を提供する。

1. `then` APIのTypeScript型定義
2. manifestの型とJSON Schema
3. プラグインプロジェクトの雛形生成
4. TypeScriptとCSSのビルド
5. manifest、権限、出力物の検証
6. `.thenplugin`の作成

SDKのnpmパッケージ名は公開前に利用可能性を確認して確定する。この文書では仮に`@maybefix/then-plugin-sdk`と記載する。

Plugin API v1を対象にするSDKはSDK v1系列として配布し、Then本体のアプリバージョンとは独立してバージョニングする。

## 6. SDKパッケージ構成

Then本体リポジトリ内の`plugin-sdk`を、単独でnpm公開できるパッケージへ拡張する。

```text
plugin-sdk/
├── package.json
├── README.md
├── then.d.ts
├── manifest.schema.json
├── bin/
│   └── then-plugin.mjs
├── src/
│   ├── build.mjs
│   ├── create.mjs
│   ├── pack.mjs
│   └── validate.mjs
└── templates/
    └── basic/
```

`package.json`の`types`には`then.d.ts`を、`bin`には`then-plugin`コマンドを登録する。

## 7. プラグインプロジェクトの作成

### 7.1 雛形生成

開発者は次のようにプロジェクトを作る。

```powershell
npx @maybefix/then-plugin-sdk create my-plugin
cd my-plugin
npm install
```

生成物は次を標準とする。

```text
my-plugin/
├── package.json
├── package-lock.json
├── manifest.json
├── tsconfig.json
├── src/
│   ├── main.ts
│   └── styles.css
├── dist/
└── release/
```

### 7.2 package.json

```json
{
  "name": "my-plugin",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "then-plugin build",
    "validate": "then-plugin validate",
    "pack": "then-plugin pack"
  },
  "devDependencies": {
    "@maybefix/then-plugin-sdk": "^1.0.0"
  }
}
```

### 7.3 tsconfig.json

SDKのグローバル型定義を読み込む。

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "types": ["@maybefix/then-plugin-sdk"]
  },
  "include": ["src"]
}
```

プラグインコードは`then`をnpmパッケージからimportしない。TypeScript上の型はSDKから得るが、実体はThen本体が実行時に提供する。

```ts
void then.commands.registerCommand(
  {
    id: "open-panel",
    title: "パネルを開く"
  },
  async () => {
    await then.views.open("my-panel");
  }
);

void then.views.registerToolView(
  {
    id: "my-panel",
    title: "My Panel"
  },
  async (container) => {
    const button = document.createElement("button");
    button.textContent = "選択範囲を取得";
    button.onclick = async () => {
      const selection = await then.editor.getSelection();
      button.textContent = selection?.text || "選択されていません";
    };
    container.append(button);
  }
);
```

誤った利用例:

```ts
// 実行時のthenをSDKからimportしてはならない。
import { then } from "@maybefix/then-plugin-sdk";
```

## 8. CSSとアセット

Plugin API v1の配布物は単一JavaScriptを実行する。開発時のCSSは別ファイルとして記述できるが、ビルド時に文字列として`main.js`へ埋め込む。

```css
.myPluginButton {
  border: 1px solid var(--then-border);
  border-radius: var(--then-radius-button);
  background: var(--then-accent);
  color: var(--then-on-accent);
}
```

```ts
import styles from "./styles.css";

const style = document.createElement("style");
style.textContent = styles;
document.head.append(style);
```

SDKのビルド処理はCSS importを文字列へ変換し、最終的に単一の`dist/main.js`を生成する。

Plugin API v1では、外部CSS、画像、フォント、追加JavaScriptをランタイムアセットとして直接参照する仕組みを提供しない。画像は必要な範囲でdata URLとしてJavaScriptへ埋め込む。複数ランタイムアセットは、専用の安全な読取方式を設計した後のAPIで扱う。

## 9. manifest

### 9.1 現行manifest schema v1

初期の`.thenplugin`対応では、既存Plugin APIとの互換性を優先し、現行manifest schema v1をそのまま梱包できるようにする。

```json
{
  "schemaVersion": 1,
  "id": "io.github.example.my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "main": "main.js",
  "description": "選択範囲を表示するプラグイン",
  "icon": {
    "paths": ["M5 4h14v16H5z"]
  },
  "permissions": [
    "document:selection",
    "views",
    "commands"
  ]
}
```

公開プラグインのIDには、所有者を識別しやすい逆ドメインまたはGitHub名前空間を推奨する。

プラグインIDは、導入先ディレクトリ、プロジェクトデータ、永続アンカーの所有者識別に使うため、公開後は変更しない。現行Ticketの`example.todo-board`を正式公開前に変更する場合は一度だけ変更し、すでに利用者データが存在する場合は別途データ移行を設計する。

### 9.2 将来のmanifest schema

更新と互換性判定を導入する前に、manifest schemaとPlugin API versionを分離し、Then本体の対応範囲を宣言できるようにする。

```json
{
  "schemaVersion": 2,
  "apiVersion": 1,
  "id": "io.github.example.my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "main": "main.js",
  "engines": {
    "then": ">=0.6.2 <0.7.0"
  },
  "permissions": ["views"]
}
```

schema v2の詳細は別途確定する。`.thenplugin`導入の初期実装をschema v2の完成でブロックしない。

## 10. 開発CLI

### 10.1 create

```powershell
then-plugin create my-plugin
```

- プロジェクト雛形を生成する
- ID、表示名、初期権限を対話または引数で設定する
- TypeScript、CSS、manifest、npm scriptsを生成する

### 10.2 build

```powershell
then-plugin build
```

- TypeScriptをJavaScriptへ変換する
- npm依存を単一ファイルへバンドルする
- CSSをJavaScriptへ埋め込む
- ES module構文を残さない
- 実行時の`import()`や`require()`を残さない
- `dist/main.js`と`dist/manifest.json`を生成する
- 開発用ソースマップは生成可能にするが、配布物には既定で含めない

### 10.3 validate

```powershell
then-plugin validate
```

- manifestをJSON Schemaで検証する
- ID、バージョン、権限を検証する
- manifestの`main`がパッケージ内部を指す相対パスであることを確認する
- `main.js`がUTF-8のJavaScriptであることを確認する
- `main.js`の2 MiB上限を確認する
- 配布対象外のファイルが含まれていないことを確認する
- 可能な範囲で、利用APIとmanifest権限の不一致を警告する

権限の静的検出は補助機能であり、文字列参照や動的呼出しを完全には判定できない。最終的な権限検査はThen本体が実行時に行う。

### 10.4 pack

```powershell
then-plugin pack
```

- クリーンビルドを行う
- `validate`を実行する
- 配布対象ファイルだけを決定的な順序でZIPへ格納する
- `<plugin-id>-<version>.thenplugin`を生成する
- SHA-256を表示し、チェックサムファイルを生成する

生成例:

```text
release/
├── io.github.example.my-plugin-1.0.0.thenplugin
└── io.github.example.my-plugin-1.0.0.thenplugin.sha256
```

同じソース、依存ロックファイル、SDKバージョンから同一のパッケージを再生成できるよう、エントリ順、タイムスタンプ、圧縮設定を固定する。

## 11. `.thenplugin`パッケージ形式

### 11.1 基本形式

| 項目 | 値 |
| --- | --- |
| 拡張子 | `.thenplugin` |
| コンテナ | 標準ZIP |
| 推奨ファイル名 | `<plugin-id>-<version>.thenplugin` |
| MIME type | `application/vnd.then.plugin+zip` |
| 文字コード | manifestとJavaScriptはUTF-8 |

ZIP直下に`manifest.json`を置く。ZIPの外側へ単一の親フォルダを作らない。

```text
io.github.example.my-plugin-1.0.0.thenplugin
├── manifest.json       # 必須
├── main.js             # 必須。実際の名前はmanifest.mainが指定
├── README.md           # 任意。配布説明用
├── LICENSE             # 任意
└── NOTICE              # 任意
```

Plugin API v1では、実行に必要なコードとCSSを`main.js`へまとめる。README、LICENSE、NOTICEは実行時に読み込まない。

### 11.2 初期パッケージ制約

- `manifest.json`はZIP直下に1つだけ置く
- `main`はパッケージ内の通常ファイルを指す相対パスとする
- 絶対パス、`..`、Windowsドライブ接頭辞を禁止する
- シンボリックリンク、ハードリンクを禁止する
- 同名エントリを禁止する
- `main.js`は現行どおり2 MiB以下とする
- ZIPのファイル数、圧縮後容量、展開後総容量、圧縮率、パス長に上限を設ける
- 初期版ではmanifest、main、README、LICENSE、NOTICE以外のファイルを拒否する

ZIP全体の具体的な上限値は、Ticketを含む実パッケージの計測後にインストーラー実装と同時に確定する。

## 12. Thenへの導入

### 12.1 利用者向け導線

初期の導入操作は次のとおりとする。

```text
Ctrl+P
  → プラグインを管理…
  → ファイルから導入…
  → .thenpluginを選択
```

現在の「プラグインを追加…」は「ファイルから導入…」へ変更する。

フォルダ選択による導入は、通常の利用者向けボタンから外す。開発者モードを有効にした場合だけ「開発中のフォルダを読み込む…」として表示する。

### 12.2 導入処理

Thenは次の順序で処理する。

1. `.thenplugin`を選択する
2. ZIPを展開する前に、構造、エントリ数、容量を検査する
3. `manifest.json`を読み、schema、ID、バージョン、main、権限を検査する
4. プラグイン名、バージョン、要求権限、互換性、発行元確認状態を表示する
5. 利用者の承認を得る
6. 承認時に記録したパッケージSHA-256を再確認する
7. アプリデータ領域内のstagingディレクトリへ安全に展開する
8. 展開後のmanifestとmainを再検査する
9. `plugins/<plugin-id>/`へアトミックに移動する
10. 読み込みに成功した後で導入完了を表示する

検査から導入までにファイルが差し替えられることを防ぐため、manifestの構造比較だけでなくパッケージ全体のSHA-256を比較する。

### 12.3 データの扱い

プラグイン本体とプロジェクトデータを分離する現行方針を維持する。

- プラグイン本体: Thenのユーザーデータ領域`plugins/<plugin-id>/`
- プロジェクトデータ: `<project>/.then/plugin-data/<plugin-id>/`
- 永続アンカー: `<project>/.then/anchors.json`

プラグインを削除または更新しても、プロジェクトデータと永続アンカーは自動削除しない。

## 13. 更新

初期の`.thenplugin`導入では、新規導入を先に完成させる。更新は次の段階で追加する。

更新時は次の規則を適用する。

- 同じプラグインIDだけを更新対象とする
- versionはSemVerとして検証する
- 通常更新は現在より新しいversionだけを許可する
- 同一versionの再導入とダウングレードは、通常操作では拒否する
- 権限が増える場合は必ず再確認する
- Then本体との互換性がない更新は拒否する
- 新版をstagingへ導入して起動検査に成功するまで旧版を保持する
- 更新失敗時は旧版へ戻す
- プロジェクトデータは引き継ぐ

署名のない配布物に対する無人の自動更新は行わない。

## 14. 公式プラグインの配布

### 14.1 GitHub Releases

初期配布は`then-plugins`リポジトリのGitHub Releasesを使う。Then本体のReleaseへ公式プラグインを混在させない。

Ticket 2.2.2の例:

```text
タグ: ticket-v2.2.2
Release:
├── example.todo-board-2.2.2.thenplugin
└── example.todo-board-2.2.2.thenplugin.sha256
```

Releaseの公開処理はGitHub Actionsで行う。

1. 依存をロックファイルどおりに導入する
2. プラグイン固有テストを実行する
3. SDKの`validate`を実行する
4. SDKの`pack`を実行する
5. SHA-256を生成する
6. タグのプラグインIDとmanifest versionが一致することを確認する
7. GitHub Releaseへ不変の成果物として添付する

公開済みversionの成果物を差し替えない。修正時はversionを上げる。

### 14.2 初期の入手導線

公式カタログを実装するまで、プラグイン管理画面に次を用意する。

- 「ファイルから導入…」
- 「公式プラグインを入手」

「公式プラグインを入手」は、`then-plugins`内の利用者向け一覧ページを外部ブラウザで開く。利用者は`.thenplugin`をダウンロードし、Thenの「ファイルから導入…」で選択する。

## 15. 公式プラグインカタログ

手動ダウンロードが成立した後、プラグイン管理画面へ「公式プラグイン」タブを追加する。

```text
導入済み | 公式プラグイン
```

カタログは`then-plugins`リポジトリで管理する`registry.json`から取得する。

```json
{
  "schemaVersion": 1,
  "plugins": [
    {
      "id": "example.todo-board",
      "name": "Ticket",
      "version": "2.2.2",
      "description": "プロジェクト単位のチケット管理",
      "downloadUrl": "https://github.com/maybefix/then-plugins/releases/download/ticket-v2.2.2/example.todo-board-2.2.2.thenplugin",
      "sha256": "...",
      "minThenVersion": "0.6.2"
    }
  ]
}
```

ThenはHTTPSでカタログを取得し、選択されたパッケージをダウンロードする。ダウンロード後は手動ファイル導入と同じ検査経路を使い、カタログ記載のSHA-256とも照合する。

カタログ取得に失敗しても、導入済みプラグインの起動とローカルファイルからの導入は利用できるようにする。

初期カタログは公式プラグインだけを扱う。第三者投稿、審査、評価、課金を含むマーケットプレイスとは分離する。

## 16. テストの責務

### 16.1 Then本体

Then本体では、小さなテスト専用プラグインを使って次を検証する。

- manifest検査
- `.thenplugin`の安全な展開
- ZIP Slip、symlink、重複エントリ、容量制限
- 権限確認と実行時権限検査
- iframeサンドボックス
- commands、views、storage、anchorsなどのPlugin API
- 導入、削除、失敗時ロールバック
- 旧フォルダ形式の開発者向け互換

### 16.2 then-plugins

公式プラグイン側では各機能を検証する。

- Ticketのカンバン、モーダル、ゴミ箱、ステータスバー
- Selection Notesのアンカーと一覧
- ビルド後の`main.js`がThenのテストホストで起動できること
- manifest権限が実利用APIと一致すること
- `.thenplugin`を再生成できること

現行のThen本体テストがTicket固有の挙動を検証している場合、リポジトリ分離時にプラグイン固有テストを`then-plugins`へ移す。Then本体には同じTicketソースの複製を残さない。

## 17. 実装段階

### Phase 1: ローカルパッケージを成立させる

- `plugin-sdk`をnpm公開可能なパッケージ構成へ変更する
- `validate`と`pack`を実装する
- Ticketから`.thenplugin`を生成する
- Thenに「ファイルから導入…」を追加する
- ZIP検査、staging展開、アトミック導入を実装する
- 現行の権限確認UIを再利用する
- フォルダ導入を開発者向けとして残す

完了条件は、Ticketを`.thenplugin`へ梱包し、別のThen環境へそのファイルだけで導入できることである。

### Phase 2: 公式プラグインを分離して配布する

- `then-plugins`リポジトリを作成する
- TicketとSelection Notesを移動する
- テスト責務をThen本体と公式プラグインへ分割する
- GitHub Actionsで検証、梱包、Release公開を行う
- Thenのプラグイン管理画面から公式配布ページを開けるようにする

### Phase 3: 更新を実装する

- SemVer検証を必須にする
- 同一IDの更新導線を追加する
- 権限差分を表示する
- staging、旧版保持、ロールバックを実装する
- Then互換性情報をmanifestへ追加する

### Phase 4: 公式カタログを実装する

- `registry.json`を公開する
- 「公式プラグイン」タブを追加する
- HTTPSダウンロードとSHA-256照合を追加する
- カタログからの手動承認付き導入を実装する

### Phase 5: 信頼モデルを拡張する

- 作者またはレジストリ署名
- 信頼済み発行元
- 署名済み更新
- 第三者プラグインの審査と公開フロー

## 18. 初期範囲外

次は`.thenplugin`による手動配布が安定した後に検討する。

- Windowsへの`.thenplugin`ファイル関連付け
- ダブルクリックでのThen起動と導入
- ドラッグ＆ドロップ導入
- 外部URLから任意パッケージを直接導入する機能
- 無人自動更新
- 有料プラグイン
- 評価、レビュー、ダウンロード数
- Plugin API v1での複数ランタイムアセット

## 19. 未確定事項

実装開始前または各Phaseで次を確定する。

- SDKの正式なnpmパッケージ名とscope
- 公式プラグインリポジトリの正式名称
- `.thenplugin`の圧縮後容量、展開後総容量、ファイル数、圧縮率の上限
- manifest schema v2の導入時期と互換性規則
- 公式プラグイン一覧ページのURL
- カタログのホスティングURLとキャッシュ方針
- 署名方式と発行者IDの所有権確認方法

これらが未確定でも、Phase 1のローカル`.thenplugin`作成と手動導入は実装できる。
