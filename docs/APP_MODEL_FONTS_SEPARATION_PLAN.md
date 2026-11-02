# Appのモデル補助とフォント一覧を分離する手順書

App.tsxのA「小さな計算・モデル補助」とB「フォント一覧」を、用途別のファイルへ移す。仕様・保存形式・UI・文言・Rust・保存の順序は変えない。確認1でBのstate・Effectも専用Hookへ移す方針が選ばれた。Aのstate・ref・EffectはAppに残し、Bの取得順序とアンマウント時の取り消しを保って分離する。

- 作成日: 2026-11-02（日本時間）
- 使用スキル: .claude/skills/then-safe-change/SKILL.md
- ブランチ: codex/refactor-app-model-fonts
- 戻し先: checkpoint/before-app-model-fonts（7aa6865b5b0d2b8029ff6ddde1602183f78109c4）。コミットの内容はmain bf95eb7と同じ。
- この手順書のApp.tsxの行番号は、上記チェックポイントのもの（8,603行）。
- 開始時の既存変更: src/components/canvas/canvas.css、未追跡のlanding-page/、前の依頼で作成したdocs/APP_RESPONSIBILITY_MAP.md。今回の変更とは区別して保持し、無関係な変更をコミットに含めない。
- 作業記録: tmp/app-model-fonts-20261102/。既存Canvas CSSの写しと開始時のstatusを保存済み。

| 工程 | 内容 | 状態 |
|---|---|---|
| 1 | 調査 | 済 |
| 2 | 仕組みの説明 | 済 |
| 3 | 依存関係 | 済 |
| 4 | 影響範囲 | 済。「前」の94本は92成功・2失敗 |
| 5 | 案 | 推奨案を作成済み |
| 6 | 人の確認（確認1） | 済。Bのstate・Effectも専用Hookへ移す（2026-11-02） |
| 7 | 実施 | 済（Aと、state・Effectを含むB） |
| 8 | 自動テストの前後比較 | 済。既存92本と追加1本が成功。既存2失敗、新しい失敗0 |
| 9 | 実機確認 | 済。起動・操作・作品切り替え・再起動・保存ファイルを確認 |
| 10 | 完了（確認2） | 実施と検証は完了。push・PR作成の確認待ち |

## 工程1: 調査の結果

### 対象と置き場所

| 対象 | Appの行 | 移動先の案 | 行数 |
|---|---|---|---|
| 資料カードの重なり順の定数 | 315〜316 | src/referenceCardModel.ts（新規） | 2 |
| 資料のキー・履歴・重なり順 | 714〜746 | 同上 | 33 |
| 空タブの生成、空タブの除外、挿入、閉じたタブの作品判定、履歴上限 | 545〜570 | src/editor/documentTabState.ts（既存へ追加） | 26 |
| ファイルタブの生成 | 581〜597 | 同上 | 17 |
| 選択文字数の計算 | 650〜657 | src/editor/displayCharacterCount.ts（新規） | 8 |
| Canvasの追加位置 | 1,035〜1,045 | src/canvasPlacement.ts（新規） | 11 |
| フォント一覧の整形・代替一覧 | 514〜543 | src/systemFonts.ts（新規） | 30 |
| OSフォント一覧の取得 | 769〜777 | 同上 | 9 |
| フォント一覧のstate（確認1で追加） | 1,225 | src/useSystemFonts.ts（新規） | 1 |
| フォント取得のEffect（確認1で追加） | 3,266〜3,280 | 同上 | 15 |

最終的な移動対象は、コメントと空行を含む152行。Aは97行、Bは確認1で追加したstate・Effectを含め55行。Appにはimportや取得関数の組み立て・Hookの呼び出しが加わり、不要なimportも外したため、実際の減少は151行になった。

### 調査で分かったこと

- 対象の関数・定数には呼び出し箇所がある。名前の出現場所はsymbol-uses.mjsで確認した。ただし、実機確認の追加調査で、nextCanvasPlacementを呼ぶsendIdeaFragmentToCanvasとsendIdeaThreadToCanvasは、いずれもApp内に定義があるだけでUIへ接続されていないと分かった。座標補助は単体テストで確かめ、未接続の操作の追加・削除は行わない。
- isPathInsideFolder（572〜579行）は回復処理のためのパス判定なので残す。隣のタブ処理と一緒に動かさない。
- loadWorkspaceDocumentTabs（606〜648行）は、保存されたタブの照合とファイルの読み込みを行うため残す。
- テストの範囲を切り出す目印になっているselectedSnapshotFolderTreeとrestoreSnapshotTreeOrderは残す。
- referenceFileKeys.tsへ履歴処理を追加し、そこからMAX_RECENT_REFERENCESをstoredStateModel.tsから読むと、storedStateModel → referenceFileKeys → storedStateModelの循環になる。この案は採らず、新しいreferenceCardModel.tsへ置く。
- editor/ast/characterCount.tsへ文字数計算を追加し、WHITESPACE_PATTERNをstoredStateModel.tsから読むと、storedStateModel → library/libraryData → editor/ast/characterCount → storedStateModelの循環になる。この案も採らず、独立したdisplayCharacterCount.tsへ置く。
- 最初の責務マップではBにHookへの分離案も挙げたが、今回使うスキルの分離手順は「値・EffectをAppに残す」「新しいファイルにReactの仕組みを持ち込まない」を初案としている。今回はその範囲で提案する。

## 工程2: 仕組みの説明

### 言葉

- モデル補助: 配列や文字列を受け取り、タブ・履歴・座標・文字数などを返す小さな処理。
- 代替フォント一覧: OSから一覧を得られないときや取得前に表示する9種類の候補。
- IPC: 画面からRustへ処理を頼む呼び出し。今回動かすのはget_system_fontsの呼び出し窓口だけ。
- Effect: Reactの描画後に自動実行する処理。フォント取得のEffectはHookの中に持ち、Appの元のEffect位置でHookを呼ぶ。

### 1. データの形

| データ | 主な内容 | 所有する場所 |
|---|---|---|
| DocumentTab | 本文、保存済み本文、パス、保存状態、表示位置など | 型はtypes.ts、配列とアクティブなタブはApp |
| ReferenceLayout | 資料カード、最近の資料、Ideaの並び順 | 型はtypes.ts、状態はApp |
| FontOption | 表示名labelとCSSの指定cssFamily | 型はtypes.ts、取得した配列systemFontsはuseSystemFonts |
| JsonCanvasDocument | nodesとedgesなど | 型はcanvasTypes.ts、今回移すのは追加位置の計算だけ |

### 2. 利用者の操作と内部の処理

| 操作・場面 | 内部で起きること | 今回動かす部分 |
|---|---|---|
| 起動、作品切り替え、最後のタブを閉じる | 文書を開いていない状態を空タブで表す | 空タブの生成だけ |
| ファイルを開く | ファイルの本文と識別情報からタブを作り、表示・保存用の状態を設定する | タブの生成だけ |
| 新しいタブを追加する | 空タブを除き、アクティブなタブの右に挿入する。基準がなければ末尾 | 配列の計算だけ |
| 閉じたタブを戻す | 作品が一致する履歴を探し、最大10件の履歴を使う | 作品の判定と上限だけ |
| 資料を開く・前面へ出す・ピン留め | 最近使った資料を先頭へ移し、カードの重なり順を求める | キー、履歴、重なり順の計算だけ |
| 文章を選択する | 選択範囲の文字を数え、ステータスへ渡す | 文字数の計算だけ |
| 未接続のIdea→Canvas操作 | 2つの操作関数の中から追加座標を求める。現在のUIは別のドラッグ経路を使う | 座標の計算だけ。UIへの接続は追加しない |
| 起動 | 代替一覧を先に使い、TauriではOS一覧を取得し、整形後に置き換える | 整形・代替一覧・取得窓口 |
| 設定でUIや本文のフォントを選ぶ | systemFontsを選択肢として渡し、選んだ設定を保存する | 選択画面や保存は動かさない |

### 3. 保存

Aの補助関数とBのフォント取得は、利用者の原稿や設定を保存しない。get_system_fontsはRustのsrc-tauri/src/lib.rsにあり、OSのフォントを調べて文字列一覧を返す。

タブ、資料レイアウト、Canvas、フォント設定の保存処理はAppや既存モジュールに残す。作品を開くときのstateの反映順、700msの遅延保存、保存キュー、復元・回復は対象外。

フォント一覧自体は保存しない。選択したUI・本文などのフォント名は既存のアプリ設定として保存され、起動時には現在のOSから一覧を取得し直す。

### 4. ほかの機能との関係

- タブ生成は起動・作品切り替え・回復にも使われる。呼ぶ位置、引数、戻り値を保つ。
- 資料の履歴はIdeaへの資料追加にも使われる。複数追加の順序を保つ。
- カードの重なり順は資料カードとIdeaカードの両方に使われる。
- 選択文字数の計算は選択範囲だけを対象とし、文書全体のASTによる文字数計算とは別に残す。
- Canvasのボード取得・保存・イベント購読は動かさない。今回分離した配置補助を使う2操作は現在UIに接続されておらず、実機のドラッグ操作は別の処理を通る。
- フォント名のCSS指定への変換はstoredStateModel.tsのtoCssFontFamilyValueを使い続ける。ヒラギノの別名対応や引用符の処理を再実装しない。

### 5. 今の挙動の癖・境界条件

変更前の関数を一時ファイルへ抽出して実行し、以下を含む13項目が成功した。記録はtmp/app-model-fonts-20261102/characterization-before.json。今回はその挙動を保つ。

| 対象 | 現在の挙動 |
|---|---|
| 空タブのID | 現在時刻から作る。同じミリ秒なら同じIDになりうる。ID生成方法を変えない |
| 最近の資料 | 最大30件。重複は正規化したパスとscopeで判定し、新しい情報を先頭へ置く |
| 複数の資料を追加 | 順に先頭へ入れるため、入力がA・Bなら履歴の先頭はB・Aになる |
| 通常カードの重なり順 | 空なら1、最大9,999。上限で同じ値になっても振り直さない |
| ピン留めカードの重なり順 | 空なら10,001。通常カードの最大値とは別に計算する |
| Canvasの追加位置 | テキストカードの右端が最も大きいものを基準に、そのx・yに32を足す。幅のぶん横へ離す処理ではない。右端が同じなら先にあるカードを使う |
| テキストカードがないCanvas | グループなどがあっても120・120を返す |
| 選択文字数 | サロゲートペアは1文字、結合文字は別の文字として数える。空白除外では改行・全角空白も除く |
| フォント名 | 前後の空白と空候補を除く。大文字・小文字が違えば別候補。並びはlocaleCompareのまま |
| フォント取得 | ブラウザではIPCを呼ばず代替一覧。Tauriの空一覧も代替一覧。IPC失敗は元のEffectのcatchで代替一覧へ戻す（実施後はHook内） |

## 工程3: 依存関係

| 区分 | 読む／書く／呼ぶ関係 | 移動後 |
|---|---|---|
| A. Reactに依存しない処理 | タブモデルはtypes・createScratchDocumentTab・isSamePath、資料モデルはtypes・referenceFileKeys・MAX_RECENT_REFERENCES、文字数はWHITESPACE_PATTERN、座標はJsonCanvasDocumentを読む | それぞれの移動先でimport。新しいファイルはAppをimportしない |
| B. state | openTabs・closedDocumentTabs・referenceLayoutなどを操作側が書く。systemFontsは取得後に更新する | AのstateはAppに残し、systemFontsはHookへ移す |
| C-1. タブの操作 | 起動・開く・閉じる・戻す・保存・回復から生成や配列計算を呼ぶ | 呼ぶ名前・場所・順序を保つ |
| C-2. 資料の操作 | 資料やIdeaカードを開く・ピン留めする際に履歴・重なり順を呼ぶ | 操作はAppに残す |
| C-3. 選択とCanvas | updateSelectionCharCountとsendIdea*ToCanvasから計算を呼ぶ | 操作と保存はAppに残す |
| C-4. フォント取得 | isTauriRuntimeを読み、get_system_fontsを呼び、createFontOptionsで整形 | 実行環境の判定関数を引数で受ける取得関数を作る |
| D. Effect | Appの3,266〜3,280行。初回取得、失敗時の代替、アンマウント後の更新を止める | 内容と依存配列を保ってHookへ移す。Appの呼び出し位置で登録順を保つ |
| E. 作品を開く経路 | 空タブ・ファイルタブの生成を呼ぶ。フォント一覧は作品に依存しない | stateの反映と保存は変えない |
| F. JSX | DocumentTabsなどの既存props、SettingsModalへsystemFontsを渡す | props・条件・配置を変えない |
| G. App外とのやり取り | フォント取得のみget_system_fontsを呼ぶ。別窓のイベント購読は対象外 | IPC名・取得回数・ブラウザ分岐を保つ |
| H. 文字列を読むテスト | test-document-tabs.mjsの72行でfunction insertTabAfterの存在を確認。performanceとv058-countsは本文全体の再計数を禁止する確認 | タブ関数の確認だけ移動先を読む。Appへの接続や禁止事項の確認はAppに残す |

結び目は、共有定数への依存、タブ生成が複数の高リスク経路から呼ばれること、フォントの取得状態がReactのEffectにあること、文字列を読むテストの4つ。コードの計算部分と呼ぶ位置を変えずに分離する。

## 工程4: 影響範囲

### 4-1. 変更するファイル

| 区分 | ファイル |
|---|---|
| 必ず変更 | src/App.tsx、src/editor/documentTabState.ts、scripts/test-document-tabs.mjs、scripts/test-heading-extract-state.mjs、package.json、この手順書 |
| 新規 | src/referenceCardModel.ts、src/editor/displayCharacterCount.ts、src/canvasPlacement.ts、src/systemFonts.ts、src/useSystemFonts.ts、回帰テストscripts/test-app-model-fonts.mjs |
| 完了時に更新 | docs/APP_RESPONSIBILITY_MAP.md（現在の配置・完了した範囲） |
| 新しい問題が見つかった場合だけ | docs/KNOWN_ISSUES.md（今回の分離では修正せず記録） |
| 変更しない | Rust、画面部品・CSS、types.ts、storedStateModel.ts、referenceFileKeys.ts、editor/ast/characterCount.ts、本文の保存・作品切り替え・復元 |

### 4-2. まとまりごとの影響

| 対象 | 重さ | 理由 |
|---|---|---|
| 資料のキー・履歴・重なり順 | 中 | 表示順、重複判定、資料・Ideaの両方へ影響 |
| タブ生成・配列計算 | 中 | 起動や回復でも使う。実処理のI/Oとstate更新は動かさない |
| 選択文字数 | 低 | 選択表示の計算のみ。全本文の計数方法は変えない |
| Canvasの座標 | 低〜中 | 追加位置と重なり方に影響。ボードの取得・保存は動かさない |
| フォント一覧 | 中 | 設定画面の選択肢、空一覧・取得失敗・ブラウザ分岐に影響 |
| フォントのstateやEffectの所有者 | 中 | 確認1でHookへ移すことが選ばれた。非同期処理の寿命、StrictMode、Effectの順序を確認する |

### 4-3. 想定する回帰と既存テスト

| 起こりうること | 既存テストでの検知 | 今回の追加確認 |
|---|---|---|
| 新規タブの位置、空タブ、閉じたタブの作品判定が変わる | document-tabsは文字列中心。workspace-tabsなどは周辺のモデルを実行 | 対象関数の具体的な入出力とQAアプリのタブ操作 |
| 資料の履歴やピン留め順序が変わる | binder・idea-actionsは関連部分を実行するが、対象補助の全境界を保証しない | 履歴上限・scope・通常／ピン留め・上限到達を直接実行 |
| 選択文字数が変わる | v058-selection・v058-counts・performanceで周辺を確認 | 空白、改行、サロゲートペア、結合文字を直接実行 |
| Canvasの位置が変わる | canvas-saveなどは保存の周辺を実行 | テキストなし、右端、同率、非テキスト無視を直接実行 |
| フォントの候補・代替動作が変わる | appearance等の周辺テストのみ。対象の取得分岐に専用確認は見つからなかった | 別名・重複・空一覧・ブラウザ・IPC失敗を直接実行し、実機で選択・再起動 |
| 新しいimportで循環や初期化順の問題が出る | build・型検査で一部を検知 | 移動先を実際に読み込み、App全体でも起動する |

### 4-4. 「前」のテスト一式

2026-11-02に実行を完了。build成功、主なJSは700,059バイト。94本中92本成功・2本失敗。終了時のQA Then・QA WebView2・テストEdge・テストnodeはすべて0。

| 変更前からの失敗 | 理由 |
|---|---|
| test:v058-bundle | 最大JSが500 kBの上限を超える（700,059バイト） |
| test:v0511-themes | ShubokuのPlotの枠が残るというassertion |

suite.mjsの既定どおり、Rustを使うtest:sidebar-file-moveは除外する。既定の除外名test:aiは現在のpackage.jsonにはない。その他の登録済みテスト94本を対象とし、test:external-urlなどは含む。

開始時点のCanvas CSSの既存差分を保持した作業ツリーで実行している。結果のdirtyはその既存差分による。変更後も同じ差分を保って比較する。

結果ファイル: tmp/app-model-fonts-20261102/suite/suite-before.json。過去の失敗を決め打ちせず、完了後にここへ結果を追記する。

## 工程5: 案

### 5-1. 推奨する線引き

確認1で決まった範囲は、Aの計算処理と、Bの整形・取得・state・Effectの分離。Aのstate・ref・Effect・操作・保存・JSXはAppに残す。Bは専用HookをAppの元のEffect位置で呼ぶ。リファクタリングは、責務の配置と依存の明示に限り、不要な共通化や挙動の改善は行わない。

### 5-2. Bの取得関数の形

新しいsystemFonts.tsに、一覧の整形・代替一覧とcreateSystemFontLoader(isTauriRuntime)を置く。createSystemFontLoaderは、元のloadSystemFontsを中身そのままで内側に持ち、返す。

Appは元の取得関数があった位置で、const loadSystemFonts = createSystemFontLoader(isTauriRuntime)と組み立てる。Hookへ移した元のEffectは、渡された同じ取得関数を呼び続ける。isTauriRuntimeをAppから取得側へ引数で渡すため、Appをimportしたり、実行環境の判定を重複実装したりしない。

- フォント取得の失敗は、専用Hookへ移した元のEffectのcatchが扱う。
- systemFontsの初期値と設定画面へのpropsは同じ。
- stateとEffectはuseSystemFontsへ移し、Appはconst systemFonts = useSystemFonts(loadSystemFonts)で一覧を受け取る。

### 確認1で提示した選択肢

1. 推奨案: AとBの計算・取得を上記の場所へ分離し、state・EffectはAppに残す。スキルの初案に沿い、更新順序を変えずに責務を分けられる。
2. 採用された代案: BはsystemFontsのstateと取得Effectも専用Hookへ移す。最初の責務マップのBに近いが、スキルの初案から範囲を広げるため、Hookの実行位置と非同期結果の寿命も確認対象に加える。

### テストの直し方と追加する確認

- 既存のtest-document-tabs.mjsでは、insertTabAfterの定義の確認だけdocumentTabState.tsへ向ける。JSXや接続の確認はAppを読み続ける。
- 回帰テストは移動先をesbuildで束ね、対象の関数を実行する。期待値は変更前の抽出した関数でも確認する。
- 変更前に実行した13項目を土台に、入力配列の非破壊、空・null、ファイル識別情報、履歴上限・scope、フォントの引用符・別名・重複、ブラウザ／Tauri／失敗の分岐を確かめる。
- テストの効きは、移動後の履歴上限またはタブ挿入位置、フォント取得の代替分岐に意図的な変更を入れて落ちることを確認し、直後に元へ戻す。
- 全体の「後」の一式と前後比較は必須。新しい失敗は単独で2回確認してから原因を調べる。

### 移動の検証とコミット

1. 資料カードのモデル補助をmove-linesで分離する。
2. タブ補助を既存モデルへ移す。move-linesは既存の移動先へ書けないため、一時ファイルへ抽出してから既存ファイルへ追加し、最終ファイルをverify-moveで照合する。
3. 選択文字数とCanvas配置をそれぞれ小さく分離する。
4. フォント一覧を分離し、取得関数の組み立てをAppの元の位置に置く。
5. 回帰テストを追加する。各まとまりで型検査と関連テストを実行し、小さなコミットにする。

5つの移動単位のspecを一時フォルダに用意し、変更前ソースに対するdry-runはすべて成功した。先頭・末尾の一致を確認している。実施時は直前のソースに合わせて行番号を取り直す。

move-linesのdry-run後に実施し、verify-moveでは基準コミットからの削除行を最終移動先と照合する。lostが0、Appへ足したのが意図したimport・取得関数の組み立てだけであることを確認する。変更ファイルはCRLFを維持する。

### 今回やらないこと

保存キュー、作品の読み込み・切り替え、復元・回復、共有定数の置き直し、フォントの別名規則の変更、文字数の数え方の変更、カード位置の改善、未使用処理の削除、UIの変更は含めない。

## 工程6: 人の確認

2026-11-02、利用者の回答「Bはstate・Effectも専用Hookへ移す」を受けた。Aは提示した範囲、Bはフォントの整形・取得に加えてsystemFontsのstateと取得Effectもsrc/useSystemFonts.tsへ移す。

Appでは元のフォント取得Effect（3,266行）があった位置でconst systemFonts = useSystemFonts(loadSystemFonts)を呼ぶ。この値は元のstate宣言と設定画面のJSX以外から使われていないため、その位置で宣言しても先行参照は生じない。Hook内のEffectを元のEffect位置で登録し、他のEffectとの順序を保つ。Hookは条件分岐の外で毎回呼ぶ。取得関数はAppの元の位置で一度だけ組み立て、Hookへ渡す。Hookはstateと取得Effectを所有し、取得処理自体はsystemFonts.tsへ分ける。

stateの配置がHookへ移る点は、スキルの初案からの変更として利用者が選択した範囲。取得前の代替一覧、成功・失敗時の反映、アンマウント後に反映しない条件は保つ。これに合わせてsrc/useSystemFonts.ts、Hookの回帰テストを変更対象へ追加する。工程5に残す推奨案と代案は判断時点の記録であり、実施はこの決定を優先する。

## 工程7: 実施

| コミット | 内容 | App.tsxの行数 |
|---|---|---|
| 5f61354 | 資料カードのキー・履歴・重なり順をreferenceCardModel.tsへ分離 | 8,603 → 8,565 |
| 4e2b032 | タブの生成・挿入・作品判定をdocumentTabState.tsへ追加。対応テストの参照先だけ変更 | → 8,526 |
| f86fee4 | 選択文字数をdisplayCharacterCount.tsへ分離 | → 8,517 |
| e1b53bf | Canvas追加位置をcanvasPlacement.tsへ分離 | → 8,506 |
| 543dbef | フォント整形・取得をsystemFonts.ts、state・EffectをuseSystemFonts.tsへ分離 | → 8,452 |
| 6bcc496 | 回帰テストtest:app-model-fontsを追加 | 変更なし |
| 71e83c9 | 見出し抽出テストの読み込みを依存先込みに変更。期待値は不変 | 変更なし |

各まとまりで型検査と関係するテストを実行し、成功した。移動はmove-linesのdry-runで先頭・末尾を確認してから実施し、verify-moveで元と突き合わせた。チェックポイントからの全体の照合でもlostは0。Appへ足したのはimport、フォント取得関数の組み立て、Hookの呼び出しで、計算処理の中身を変えていない。

stateとEffectをHookへ移す際、HookはAppの元のフォント取得Effectの位置で呼ぶようにした。構文解析でAppのEffectとHookに移したEffectを実行位置の順に並べ、52個すべての本文と順序が変更前と同じことを照合した。

JSX・保存処理・作品切り替え・Rustは変更していない。共有定数の置き場所やフォント別名の規則も変えていない。変更ファイルはCRLFで保存している。

## 工程8: 自動テスト

### 足した回帰テスト

npm run test:app-model-fonts。モデル補助とフォントの13項目、実際のReactでHookを描画する5項目、合計18項目が成功した。

モデル補助・取得の期待値は、変更前のAppから抽出した関数でも確認済み。Hookの検証では、Reactそのものを使って描画し、stateのsetterを呼んだ回数だけ観測する薄い包みを挟んだ。アンマウント後の更新はReactが無視して画面に出ないため、setterを呼んでいないことも確かめている。

| Hookの確認 | 結果 |
|---|---|
| 初期の代替一覧、非同期取得成功、再描画しても再取得しない | 成功 |
| 取得失敗時に代替一覧を保つ | 成功 |
| アンマウント後に成功／失敗してもstateを更新しない | 成功 |
| 新しいHookの起動後、古いHookの応答が新しい状態を汚さない | 成功 |
| StrictModeのsetup・cleanup・再setupで、最初の取得結果を反映しない | 成功 |

### テストが効くことの確認

| 意図的に入れた変更 | 検知結果 | 復元 |
|---|---|---|
| 最近の資料の上限を30件から31件へずらす | 31 !== 30で失敗 | 元に戻した |
| Hookの成功応答から取り消しの条件を外す | アンマウント後にsetterを呼んだというassertionで失敗 | 元に戻した |

復元後は18項目すべて成功。意図的な不具合はコミットしていない。記録はtmp/app-model-fonts-20261102/mutation-results.json。

### テスト一式の前後比較

「後」の一式は6bcc496で実行。build成功、95本中92本成功・3本失敗だった。終了時のQA Then・QA WebView2・テストEdge・テストnodeはすべて0。

前からの2本に加え、test:heading-extract-stateが新しく失敗した。このテストはdocumentTabState.tsを単独でTypeScript変換し、data URLから読み込んでいた。今回モデルへ加わった実行時の依存先../utils/projectTreeをその方法では解決できなかった。単独で2回実行し、同じ失敗を確認した。

テストの読み込みをesbuildで依存先を含めて束ねる形へ変更した。検証する入力・期待値・assertionは変更していないことを、基準コミットのconst sourceTab以降と照合した。修正後は単独で2回成功した。

この対応で製品コードは変更していない。6bcc496から71e83c9までのsrc配下のコミット差分は0。全体一式の記録suite-after.jsonを残し、修正したテストはsuite.mjsのafter-loaderとして再実行して成功した。再ビルドの主なJSは一式の実行時と同じ700,143バイト。再実行後のプロセス残数もすべて0だった。

最終集計suite-after-verified.jsonは、全体一式と読み込み修正後の再実行を合わせたもの。verificationRunsに両方の出所を書き、最初の失敗記録を上書きしていない。以下の比較はこの集計とbeforeの比較であり、修正後に95本すべてを再実行したという意味ではない。

| 区分 | 本数 | 結果 |
|---|---|---|
| 前後とも成功 | 92 | 変更前に成功した全テスト。見出し抽出は読み込み対応後の再実行結果を使用 |
| 前後とも失敗 | 2 | バンドル上限とShubokuのPlot。理由は同じ |
| 後から追加 | 1 | test:app-model-fonts。18項目すべて成功 |
| 未解決の新しい失敗 | 0 | なし |

buildは前後とも成功。主なJSは700,059 → 700,143バイト（+84バイト）。比較の出力はtmp/app-model-fonts-20261102/suite/comparison.txtに保存した。



## 工程9: 実機確認

### やり方

71e83c9からlocal.then.qa.appmodelfonts1102という独立した識別子でQAアプリをbuildした。buildは成功（294秒）。一時ライブラリに作品A・作品B、本文・二章・資料、Idea、Canvasを用意した。利用者のライブラリ・設定は使っていない。

操作はQA用のWebView2へCDPで送り、DOMの値、保存ファイル、再起動前後のスナップショットを照合した。ドラッグは実際のIdeaのdragstartからDataTransferを取り出し、Canvasへdragover・drop・dragendを送る方式。物理マウスでのドラッグではない。

### 確認した項目

| 確認したこと | 結果 |
|---|---|
| OSフォント一覧と設定画面 | get_system_fontsの449候補とUIの449候補が一致。UIフォントをConsolas、本文を38LS UDゴシックへ切り替え、CSSの指定と保存状態を確認 |
| 選択文字数 | 「あ 　𠮷」が空白を含めると4文字、除くと2文字。選択範囲そのものとステータス表示を照合 |
| ファイルタブの生成 | 二章.mdを開くと、本文.txt・二章.mdの2タブと二章の本文を表示 |
| タブの挿入 | 本文.txtを選んで新しいタブを作ると、本文.txt・新しいタブ・二章.mdの順。閉じると元の2タブに戻る |
| 閉じたタブの復帰 | 二章.mdを閉じ、Ctrl+Shift+Tで元の位置へ復帰し、アクティブになる |
| 文書を一つも開いていない状態 | すべて閉じるとタブ帯に空タブは出ず、エディタはなく開始ページを表示。ファイルツリーから本文を再オープンできる |
| 資料の作成・キー・履歴 | QA資料1.md・QA資料2.mdを作成。同じ資料を開き直してもカードは2枚のまま。保存した最近の資料はQA資料1.md・QA資料2.mdの順で重複なし |
| カードの前面化とピン留め | 通常の重なり順が増え、最初のピン留めは10,001。解除で通常側の3へ戻り、再ピン留め・前面化後は10,002。画面と保存レイアウトで一致 |
| 現在UIに接続されているIdea→Canvas | Ideaのドラッグを受け付け、基準のカードに加えて本文のカードを作成。保存済み表示とボードファイルの2ノードの内容・座標を照合 |
| 作品切り替えの分離 | Bでは空の開始ページとBの資料状態から始まり、本文を開ける。BだけにIdeaを追加した後、Aの本文・二章・資料・project.json・資料レイアウト・Canvasの6ファイルはSHA-256がすべて不変。追加したIdeaはBのproject.jsonにだけ保存された |
| Aへ戻る | 本文タブ、資料の内容・ピン・重なり順を復元。カードの座標については下記の既存の枠内調整を確認 |
| 再起動後 | 本文・タブ・資料カード・位置・ピン・重なり順・449候補・選択したフォント・空白設定・適用CSSのスナップショットが停止前と完全一致 |
| 再起動後のCanvas | 2ノードのID・本文・x/yが停止前と一致 |
| 画面の目視 | 本文画面と再起動後Canvasのスクリーンショットを確認。文字とカードが表示されている |

### 位置の調整と、確かめられなかったこと

- 作品Aを開き直した際、資料カードのxは436・468から12へ変わった。本文枠は296px、カード幅は272pxで、既存のclampReferenceCardToStageの上限296 - 272 - 12 = 12と一致する。ピン・重なり順・内容は保たれた。この調整関数と読み込み時の適用処理は今回変更していない。再起動の前後では、調整後のカード位置まで一致した。
- 最初の選択文字数の確認では、QAのDOM範囲が前の段落の改行も選び、5文字と表示された。選択範囲を正して対象の文字列だけを選び、4文字・2文字を照合した。原稿本文は書き換えていない。
- nextCanvasPlacementの2つの呼び出し元はUIへ接続されていない。そのため、この補助の座標計算そのものは変更前後の関数を使う自動テストで確認し、実機では現在のドラッグ経路を使うCanvasの周辺動作を確認した。UIに到達できたと誤って扱わない。
- OSフォント取得の空一覧・失敗、アンマウント直後の応答は、自動テストで確認した。実機のOSやIPCを意図的に壊しての確認はしていない。
- 物理マウスのドラッグとOSファイル選択ダイアログは今回の実機確認に含めていない。

### 記録と片付け

- 操作結果: tmp/app-model-fonts-20261102/qa/results.json
- 再起動の比較: 同じフォルダのbefore-restart.json・after-restart.json
- 画像: before-restart.png・canvas-after-restart.png
- 作品の分離: work-a-before-switch.json・work-isolation.json
- QAアプリを2回とも停止し、それぞれQA Then・QA WebView2・テストEdge・テストnodeが0であることを確認した。
- qa-cleanup.mjsでQAの設定と一時ライブラリを削除。最後のQA Then・QA WebView2・テストEdge・テストnode・一時ブラウザプロファイルはすべて0。
- Windowsのアプリデータ転送先も確認し、QA識別子の論理パスと実体パスがどちらも消えたことを確認した。
- 開始時のCanvas CSSはバイト単位で同じ。landing-page/には手を加えていない。Cargo.tomlはビルド時の改行のみの変化を戻している。
- src-tauri/target/release/Then.exeはQA識別子でビルドした実行ファイルになっている。今回インストーラーは作成していない。

## 工程10: 完了

Aの小さな計算・モデル補助と、Bのフォント一覧・state・Effectの分離を完了した。App.tsxは8,603 → 8,452行。確認1で選ばれたHookへの分離を実施し、他のEffectとの順序を保った。

| 変わったもの | 内容 |
|---|---|
| Appと6つのモデル／Hookファイル | 責務の移動。タブのモデルは既存ファイルへ追加し、他は新規 |
| 回帰テスト・package.json | 18項目を追加し、2種類の意図的な不具合を検知 |
| 既存テスト2本 | 移動先の参照と、依存を含めた読み込みへ対応。期待値は維持 |
| この手順書・責務マップ | 現在の配置、確認1の決定、検証、未確認の範囲を記録 |

| 残っている別の作業 | 扱い |
|---|---|
| バンドル容量・ShubokuのPlotの既存テスト失敗 | 今回の分離では修正していない |
| UIに接続されていないIdea→Canvasの2操作 | 残した。整理・削除や再接続をする場合は別の変更で判断する |
| 責務マップのC以降 | 今回の範囲外 |
| pushとPR作成 | then-safe-changeの確認2待ち |

新しく確定した製品の不具合はなく、KNOWN_ISSUES.mdは変更していない。
