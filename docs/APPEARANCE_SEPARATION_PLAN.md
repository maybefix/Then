# 見た目を管理するCSSとテーマ適用の分離手順書

見た目の定義と、その定義を画面に適用する処理の置き場所を整理する。CSSの値・セレクタ・宣言の順番、Reactのフックの順番、UI・文言・設定と保存形式を保つ。

- 作成日: 2026-11-02（Asia/Tokyo）
- 使用スキル: .claude/skills/then-safe-change/SKILL.md
- ブランチ: codex/appearance-separation
- 戻し先: checkpoint/before-appearance-separation（f3c6d6dc7b021b7eb1b3f027cb015e880b8e7183）
- このチェックポイントは、開始時点で未コミットだったAI機能削除の変更を保存したもの。mainと同じ内容ではない。未追跡のlanding-page/は対象外としてそのまま残した。
- この文書の行番号は、このチェックポイントでの番号。

| 工程 | 内容 | 状態 |
|---|---|---|
| 1 | 調査 | 完了 |
| 2 | 仕組みの説明 | 完了 |
| 3 | 依存関係 | 完了 |
| 4 | 影響範囲 | 完了。変更前の一式は93本中90本成功・3本失敗 |
| 5 | 案 | 作成済み |
| 6 | 人の確認（確認1） | 承認済み（2026-11-02） |
| 7 | 実施 | 完了 |
| 8 | 自動テストの前後比較 | 完了。新規の失敗0 |
| 9 | QA用アプリで実機確認 | 完了。再起動と保存先も確認 |
| 10 | 完了（確認2） | 実装・検証・片付け完了。2026-11-02にpush・PR作成の承認取得 |

## 工程1: 調査の結果

### 今の配置と行数

- src/App.tsx: 8,608行。テーマ属性、フォント・サイズのCSS変数の適用と、キャンバスへの外観設定の受け渡しが残っている。
- src/App.css: 15,494行。キャンバスCSS 1,778行、テーマ選択画面CSS 177行、明暗別の上書き30行、既定の配色関連24行がある。合計2,009行は今回の分離の中心。
- キャンバス本体: App.css 11242〜12861、埋め込み: 13364〜13377、サイドパネル: 13422〜13565。コメント・空行込み。
- テーマ選択画面: App.css 10484〜10660。
- 明暗別上書き: 9425〜9429、13764〜13770、13772〜13779、13829〜13833、15027〜15031。
- src/styles/themes/は42ファイル、計4,812行。うち39ファイルはテーマの系統別、foundations.cssは368行、shared-variants.cssは345行、index.cssは読み込みの41行。
- 各テーマ固有の定義はすでに分離されている。例えばdefault.cssはDefaultのライト・ダーク、newsroom.cssはNewsroomのライト・ダークをまとめている。一つのファイルに全テーマが集中している状態ではない。
- 複数テーマに共通する見た目はfoundations.cssとshared-variants.cssにある。後者にはテーマ名を列挙する38個のルールがあり、テーマ単位で管理しにくい部分として次の段階の候補にする。

### テストと履歴

- 文字列を読むテストの調査結果: tmp/appearance-separation/css-text-deps.txt。
- App.cssの文字列へ直接依存するテストがある。document-tabs、ui-scale-layout、v0511-themes、v060-paged-recovery、v061-plugins、v065-shell、v066-ideaなど。正規表現や期待値を弱めず、CSSの読み込み先を分離後の全ファイルに対応させる。
- ブラウザがApp.cssを読み込むテストと、本番のmain.tsxがある。App.cssを読み込み用の入口として残し、呼び出し側の指定を保つ。
- TITLEBAR_CONTRAST_FIX_PLAN.mdとKNOWN_ISSUES.mdには、原稿面と操作盤の色が違うテーマ、帯・選択行のコントラスト、既知の配色の制限が記録されている。

## 工程2: 仕組みの説明

### 言葉

- CSS変数: 背景色やフォントなどを名前で共有する値。
- セレクタ: CSSをどの画面部品に適用するかの指定。
- 適用順: 同じ優先度の指定が重なると、後から読んだ指定が勝つ。移すだけでも読み込む順番が変わると見た目が変わる。
- 純粋な関数: 渡された値から結果を作るだけで、保存・通信・Reactの状態更新をしない処理。

### データの形と操作

| 操作・場面 | 今の処理 | 分離後も保つこと |
|---|---|---|
| テーマを選ぶ | ThemePickerModalからupdateSettingsでsettings.themeを変え、Appのdata-themeに反映 | 設定の保存経路と選択画面の開閉を保つ |
| フォントやサイズを変える | 縦書きフォントの補正後、buildAppShellStyleが12個のCSS変数を作る | 本文・見出しは補正後、プロットと開始画面は設定のフォントを使う |
| 埋め込みキャンバスを開く | Appの外観を継承。キャンバス自身にはdata-themeとstyleを置かない | 親の最新設定を継承する |
| 別ウィンドウのキャンバスを開く | Appがテーマ・フォント・倍率をpayloadへ入れ、CanvasWindowAppが自分のrootへ適用 | payloadの形と受け取りを保つ |
| アプリがCSSを読む | main.tsxがApp.css、themes/index.cssの順で読む | 既存のCSSの順番とテーマの上書き順を保つ |

### 保存・復元と他の機能

設定のstate、updateSettings、起動時の正規化と復元、ウィンドウ間のイベント、ボードの保存、作品を開く処理は移さない。Canvasのpayloadに入る外観設定だけを、同じ形を返す関数で組み立てる。ExportWindowAppの設定の読み込みと適用は今回は維持するが、CSSを共有するため画面確認の対象に含める。

### 今の挙動の癖（修正しない）

1. 埋め込みキャンバスは親からテーマを継承する。別窓は開いたときのpayloadのテーマを使用する。Idea・資料のライブ更新にはテーマ設定が含まれていない。今回、テーマのライブ同期は追加しない。
2. Night Libraryなどは操作盤と原稿面の配色が違う。CSS変数がどの面で評価されるかを変えない。
3. KNOWN_ISSUES.mdにあるPromiseの帯の右側のアイコンや、白い帯のパンくず区切りのコントラストはこの分離で修正しない。

## 工程3: 依存関係

| 区分 | 読む／呼ばれる | 書く／呼ぶ | 方針 |
|---|---|---|---|
| A. Reactに依存しない処理 | settings、補正後のフォント、キャンバスpayload | data-themeとstyle、payloadの外観部分を返す | 外観専用の純粋な関数へ |
| B. 値 | appState.settings、テーマ選択画面の開閉状態 | 既存のsetState | Appに残す |
| C. 操作 | テーマ選択・設定更新・Canvas起動 | updateSettings、openIdeaCanvasBoard | 操作は残し、外観値の組み立てだけ委譲 |
| D. 自動処理 | useVerticalMetricFontFamily、CanvasのthemeStyleのuseMemo | フォント登録、値の保持 | 呼び出し順と依存配列を保つ。新しい独自フックは作らない |
| E. 作品を開く経路 | 起動・作品切り替え | appStateとpayload | 移さない |
| F. JSX | main.appShell、canvasWindowRoot | 現在と同じ属性・CSS変数 | 組み立てを委譲。要素を増やさずpropsの契約を保つ |
| G. 外部とのやり取り | Tauriのpayloadとイベント | 同じpayload | Rustと通信を変えない |
| H. テスト | App.css文字列、実際のCSSの読み込み、appShellStyle関数 | 既存の期待値 | 分離先を同じ順で読む。ブラウザで適用後の値も比較 |

結び目は、CSSの元の順番、CSS内のフォントファイルへの相対パス、原稿面ごとのCSS変数の継承、埋め込みと別窓の違い、CSS本文を読むテストの5点。

## 工程4: 影響範囲

| まとまり | 重さ | 起こりうる回帰 | 確認 |
|---|---|---|---|
| CSSの分割と読み込み | 中 | 色・余白・角丸・重なり順が変わる | CSSの展開順・宣言比較、ブラウザ、QA |
| フォントの参照先 | 中 | Then Serifのロゴフォントが読めない | URLの参照先比較とロゴ確認 |
| 外観属性の関数化 | 中 | テーマやフォントが反映されない | 純粋関数の実行テスト、埋め込みと別窓確認 |
| 設定・ボードの保存と復元 | 高だが今回変更しない | 保存先の混同 | 作品A/Bの切り替え、再起動、保存ファイル比較 |
| テーマ別CSSの内容 | 変更しない | テーマごとの配色が変わる | 全テーマの既存コントラストテストと追加比較 |

変更前の一式はスキル付属suite.mjsで実施済み。当時のpackage.jsonには94本のtest:*があり、スキル既定でtest:sidebar-file-moveを除いた93本を実行した。build成功、90本成功・3本失敗。工程8に前後比較を記録した。

## 工程5: 案

### 方針と移すもの

1. CSSの順番を保つため、App.cssを標準のCSS @importを並べる入口にする。既存のmain.tsxと、App.cssをlinkで読むテストの入口は維持する。
2. キャンバス本体・埋め込み・サイドパネルをsrc/components/canvas/の専用CSSに、テーマ選択画面をsrc/components/dialogs/themePicker.cssに分ける。
3. 明暗別の共通上書きをsrc/styles/themes/内の用途別ファイルへ分ける。ただし現在の位置で読み込む。既存foundations.cssの末尾などへ単純に足すと適用順が変わるため、それはしない。
4. 既定値はsrc/styles/app/defaults.cssとprogressDefaults.cssに移す。最初の:rootは配色・フォント・寸法の既定値をまとめたブロックとして移す。24行だけを抜き出して同じルールを分断することは避ける。
5. 抜き出すブロックの間にあるCSSも、順番を保つためsrc/styles/app/のファイルへ移す。今回は内部のセレクタや宣言を整理しない。大きなbase.cssのさらなる部品別分割は次の段階にする。
6. 入口を展開したCSSが変更前と同じ宣言順・値になることを、構文解析で比較する。フォント定義はsrc/fonts.cssに置き、元と同じフォルダから同じ相対URLを使う。URLの変更も避ける。
7. Appのテーマ属性とstyleの組み立てを既存appShellStyle.tsの純粋な関数に、Canvasの外観payloadと適用属性の組み立てをcanvasAppearance.tsの純粋な関数に分離する。フォント補正フックはAppの元の位置に残す。CanvasのuseMemoの位置と依存配列も保つ。
8. テーマ選択画面の状態と開閉、保存・復元・Canvas起動そのものは残す。

### CSSの読み込み順の案

次の20の範囲を、この順のまま入口から読む。各範囲は、途中でルールやmedia queryを切らない位置で調査済み。実施時にmove-linesの先頭・末尾の一致も確認する。

| 現在のApp.css行 | 移し先（案） |
|---|---|
| 1〜23 | fonts.css |
| 24〜64 | styles/app/defaults.css |
| 65〜9423 | styles/app/base.css |
| 9424〜9430 | styles/themes/shared-idea.css |
| 9431〜10483 | styles/app/ideaPlot.css |
| 10484〜10660 | components/dialogs/themePicker.css |
| 10661〜11241 | styles/app/exportWorkspace.css |
| 11242〜12861 | components/canvas/canvas.css |
| 12862〜13363 | styles/app/workspaceModes.css |
| 13364〜13377 | components/canvas/canvasEmbedded.css |
| 13378〜13421 | styles/app/exportEmbedded.css |
| 13422〜13565 | components/canvas/canvasSidePanel.css |
| 13566〜13763 | styles/app/fileTree.css |
| 13764〜13780 | styles/themes/shared-outline.css |
| 13781〜13824 | styles/app/fileActions.css |
| 13825〜13834 | styles/themes/shared-sidebar.css |
| 13835〜15017 | styles/app/focusProofread.css |
| 15018〜15025 | styles/app/progressDefaults.css |
| 15026〜15032 | styles/themes/shared-progress.css |
| 15033〜15494 | styles/app/progressLibrary.css |

App.cssは20行程度の入口になる。これは15,494行のCSSがなくなる意味ではなく、定義を用途ごとに移すという意味。今回独立させたい範囲は約2,009行で、それ以外の移動は読み込み順を保つため。App.tsxの削減は数行程度。前の約10行という見込みはフォントフックの移動を含んでいたが、指定スキルの方針に合わせて移さない。

### 最終的なテーマ単位の管理に向けて

現在の39ファイルをテーマごとの編集先として保つ。共通ルールは共通のまま意味を明示する。shared-variants.cssに列挙されたテーマ名と各ルールの関係は、今回の見た目維持を検証した後の段階で、テーマ別の変数・選択可能な共通の見た目として整理する。テーマごとの重複コピーや、light/darkのファイル分割は今回行わない。

### テストと実施手順

- move-lines.mjsのdry-run → 移動 → verify-move.mjs（lost 0）で、まとまりごとに確認する。
- npx tsc --noEmitと関係する既存テストを、まとまりごとに実行してコミットする。
- CSSを文字列で読むテストには、入口の@importを元の順に展開する共通の読み込み処理を用意する。テストの正規表現・期待値は維持する。
- CSSの宣言順とURL実体の比較、外観値の実行テストを追加する。
- ブラウザで全62テーマの代表要素の色・枠・余白・フォント・角丸を変更前と比較する。既存のwindow-controls、tree-row-contrast、app-shell-style、ui-scale、canvasテストも実行する。
- 追加テストはCSSの読み込み順の逆転、テーマ継承の破壊の2つの意図的な変更で失敗することを確認し、今回の変更だけを元に戻す。チェックポイントの無関係な変更を消す操作はしない。
- 変更後の一式を実行し、変更前と比較する。新規の失敗は単独で2回実行して切り分ける。
- 一式が終わってからQA用アプリlocal.then.qa.appearance1102をbuildする。通常用のrelease/Then.exeがQA buildに置き換わる点は最終報告に記す。
- QAの一時ライブラリに作品A/B、本文、Idea、資料、色の違うCanvasカードを用意する。テーマ選択、倍率、縦横書き、埋め込み/別窓Canvas、カード・メニュー・モーダル・サイドパネル、Export、切り替え・保存・再起動を確認する。
- QAを止めて片付け、プロセスを数えて報告する。

### コミットのまとまり

1. CSSの分割、順序を保つ入口、既存テストの読み込み対応。
2. 外観値の組み立ての分離と実行テスト。
3. 全体テスト・QAの結果と手順書の更新。

### 確認してほしい方針

推奨: CSSを用途別に移し、読み込み順をそのまま保つ。外観の組み立てだけを純粋な関数へ移す。既存のテーマ別ファイルは維持し、共通テーマルールの構造変更は次の段階とする。

代案: 今回はキャンバスとテーマ選択画面のCSSだけを先に分離し、テーマの共通上書き・適用関数は次回に回す。

## 工程6: 人の確認

2026-11-02: 利用者が「手順書どおり進める（推奨）」を選択。実施の承認を得た。

## 工程7: 実施

| コミット | 内容 |
|---|---|
| 59100fc | CSSを20ファイルへ移し、App.cssを順序を保つ入口にした。CSS本文を読む既存テストの期待値は変えず、importを展開して読む形に対応 |
| 29d9ccd | 外観属性・キャンバスの外観設定を純粋な関数へ分離し、実行テストを追加。Canvas保存テストの依存ファイルの読み込みを補完 |

| ファイル | 前 | 後 | 削減 |
|---|---:|---:|---:|
| App.css | 15,494 | 20 | 15,474 |
| App.tsx | 8,608 | 8,603 | 5 |
| CanvasWindowApp.tsx | 3,774 | 3,769 | 5 |

CSSの行数は用途別ファイルへ移した結果であり、定義の削除ではない。verify-moveで空行以外の欠落0行。入口を展開した全行も、空行以外はコメント・フォントURL・順番を含めて変更前と一致した。切り出した各CSSは単独で構文解析できる。全変更ファイルのCRLFとgit diff --checkも確認した。移動元の区切りの空行は新ファイルの末尾から除いた。

App.tsxに残したものは、フォント補正フック、設定のstate・保存・復元、Canvas起動そのもの。移動した4つのpayload項目はmove-linesでそのまま移した。JSXのテーマ・style指定は同じ値を返す属性オブジェクトの受け渡しへ変え、実行テストで値を照合した。CanvasのuseMemoの位置と依存配列は同じ。

編集先の案内をsrc/styles/README.mdに追加した。

## 工程8: 自動テスト

変更前の実行記録: tmp/appearance-separation/suite/suite-before.json。build成功、93本中90本成功・3本失敗。残プロセスはすべて0。最初の制限環境での実行は途中停止し、suite-before-sandbox.jsonに別途保存。正式な記録はブラウザに接続できる権限で実行し直した結果。

| 変更前の失敗 | 内容 |
|---|---|
| test:canvas-save | テストのdata URLから./utils/fontStackを解決できない |
| test:v058-bundle | 700,110 bytes。既存上限500 kBを超えている |
| test:v0511-themes | Shubokuのプロット面の枠なし指定を確認する既存の検査 |

### 変更後と前後比較

- 正式な一式: beforeは93本中90本成功・3本失敗、afterは94本中92本成功・2本失敗。ビルドは両方成功。
- 両方成功90本、両方失敗2本、成功に変わったもの1本、追加した成功1本、新規の失敗0本。
- test:canvas-saveは、新旧の依存ファイルをテストから解決できるようにして成功。ボード切り替え、保存失敗、作品切り替え、アンマウント、再マウント、ゴミ箱、StrictModeを実際に描画して確認した。
- test:v058-bundleは前700,110 bytes・後700,059 bytesで、既存の500 kB上限をともに超える。
- test:v0511-themesは前後とも同じShubokuの枠なし指定の検査で失敗。今回、配色や枠の仕様は変更していない。
- 新しいtest:appearanceは、62テーマの外観属性、補正したフォントの使い分け、Canvasの設定の受け渡し、埋め込み時の継承、payloadがない場合の既定値、CSS importの順番・階層・重複・循環検知を実行して成功。
- 意図的なCSSの順序変更と、埋め込みCanvasへの古いテーマの直接指定をそれぞれ入れ、テストが失敗することを確認。元の内容へ戻した後に成功を確認した。
- ヘッドレスEdgeで、62テーマ × 本文/埋め込みCanvas/別窓Canvas/テーマ選択 × 1280×720・倍率1と960×680・倍率1.25の496場面を前後比較。色・背景・枠・余白・角丸・影・フォント・倍率などの計算後の値がすべて一致した。記録はtmp/appearance-separation/styles-before.jsonとstyles-after.json。
- 前後の一式とも、終了後のQA Then・QA WebView2・test Edge・test nodeはすべて0。

## 工程9: 実機確認

- 専用識別子: local.then.qa.appearance1102。QA用のアプリ設定と一時ライブラリは利用者のものと分離した。
- QA buildは成功（170秒）。ビルド中のCargo.tomlの改行だけの変更はスキルのツールが元に戻した。Rustの変更はない。
- 実機のUI表示サイズは、実際の選択肢である130%で確認した。125%はヘッドレスEdgeの前後比較で用いた。QA操作で選択肢にない125%を指定した待機タイムアウトは、選択肢を確認して130%へ戻して再実行した。

| 確認したこと | 結果 |
|---|---|
| 起動画面とフォントファイル | Workbenchで起動し、Then Serifがloaded、ロゴ表示を確認。本文ではThen Ideographic Spaceと縦書き補正用フォントの読み込みも確認 |
| テーマ切り替え | Defaultの明暗、Workbenchライト、Night Libraryダーク、Promise・Newsroom・Shuboku・Air・Passionの明暗、計14テーマ。実アプリの背景色・文字色が分離前の記録と一致。テーマ選択画面の配置も確認 |
| 本文の縦書き・横書き | rootの書字方向、本文の書字方向とフォントの切り替えを確認。最後は縦書きへ戻した |
| UI倍率 | 設定の130%を選び、CSS変数と実際のtopbarのzoomが1.3であることを確認 |
| 埋め込みCanvas | Passionダーク、Night Libraryダーク、Workbenchライトで表示。自身のdata-themeとstyleはなく、親のテーマ・フォントと倍率を継承。テーマを変えるとそのまま追従した |
| カードの編集と保存 | 実際のクリック・Enter・文字入力で緑カードの本文を編集。保存済みの表示、JSONの本文・色と画面の一致を確認。青カードも維持 |
| 別窓Canvas | Night Libraryダーク、UIフォントSegoe UI、本文フォントNoto Serif JP、倍率1.3をpayloadから適用。2枚のカードと接続線、Ideaサイドパネルを確認 |
| ボードメニューと名前変更ダイアログ | 配色と表示範囲を確認。名前変更はキャンセルし、ボード名を維持 |
| 別窓の既存のテーマ動作 | メインをWorkbenchライトに変えても、別窓は開いた時点のNight Libraryダークのまま。既存の動作を維持 |
| 作品切り替え | AからBへ切り替えても、AのボードのSHA-256は編集後と同じ。Aへ戻ると本文とカードが復元された |
| エクスポート画面 | Workbenchライトの埋め込み画面を表示し、白い出力画面・2つの対象ファイル・操作部を確認。実際のPDF/DOCX書き出しは今回の実機確認では行っていない |
| 再起動 | 一度停止し、同じ識別子で再起動。テーマ、130%倍率、作品名、本文、縦書き、補正フォント、背景色・文字色が再起動前と一致 |
| 再起動後のCanvas | カード本文・色と倍率を復元。ボードのSHA-256は同じ。BにAのボードが作られていないことも確認 |

スクリーンショットと確認値はtmp/appearance-separation/qa/に保存した（startup.png、theme-picker.png、canvas-embedded.png、canvas-window.png、window-rename.png、export.png、canvas-after-restart.png、themes.json、before-restart.json、after-restart.jsonなど）。

### 片付け

- QAのThenとWebView2を停止し、QA用のRoaming/Localの設定フォルダと一時ライブラリを削除。削除先の絶対パスを事前の記録と照合した。
- qa-cleanupの結果: QA Then 0、QA WebView2 0、test Edge 0、test node 0、テスト用プロファイル0。記録はtmp/appearance-separation/qa/cleanup.log。
- 開発用のsrc-tauri/target/release/Then.exeはQA版のbuildで置き換わっている。インストール済みのThenは変更していない。

## 工程10: 完了

実装・自動検証・実機確認・片付けまで完了。2026-11-02に利用者から「AI機能の削除を含めてPRをpushしてください」との回答を受け、既存の公開リポジトリmaybefix/Thenのcodex/appearance-separationブランチへpushした。

| 残る作業 | 位置づけ |
|---|---|
| base.cssのさらなる部品別分割 | 今回は既存の順番を保つため移した共通CSS。今後、対象部品を決めて分割する |
| shared-variants.cssのテーマ名列挙の整理 | テーマ単位での管理を進める次の段階。今回、各テーマ固有の39ファイルは維持 |
| test:v058-bundleの既存上限超過 | 前後とも失敗。今回の分離ではサイズが51 bytes減った |
| test:v0511-themesのShubokuの既存検査 | 前後とも同じ失敗。配色・枠の仕様は今回変更しなかった |

開始時から未追跡だったlanding-page/は変更・コミットしていない。

## 2026-11-02: 利用者の動作検証用インストーラー

利用者の依頼で、AI機能削除と外観分離を含む通常版NSISインストーラーを生成した。バージョンは0.7.0、製品名Then、識別子local.then、アプリ本体はx64。QA版ではなく通常設定でビルドし直した。現在の開発用src-tauri/target/release/Then.exeも通常版に戻っている。

- コードのコミット: 1ed76c323b1ab8ff6223528069d282bc033eec0d
- 成果物: src-tauri/target/release/bundle/nsis/Then_0.7.0_x64-setup.exe
- 検証用の写し: artifacts/appearance-separation-2026-11-02/Then_0.7.0_ai-removal_appearance_1ed76c3_x64-setup.exe
- サイズ: 35,951,235 bytes
- SHA-256: a4fa0fc7d0864c5339c5c2570e871ee87f76e7ff680940568d3e6abf4574cb9b
- 検査: NSIS形式、更新日時、写しとのハッシュ一致、アプリのPEヘッダーがx64、製品名Then、バージョン0.7.0。Then.exeとAGPL-3.0.txt、Vivliostyle-NOTICE.md、NotoCJK-OFL.txtの同梱を7-Zipで確認した。
- 記録: tmp/appearance-separation/installer/build.log、result.json、archive-list.txt。

インストーラーの実行とインストール後の動作検証は、利用者が行う。生成・検査のプロセスは完了しており、アプリやインストーラーの新しいプロセスは起動していない。
