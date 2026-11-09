# Thenのビルド資源消費・2026-11-04未明の起動不良調査

調査日: 2026-11-04（JST）。調査対象はユーザーが24時台に受け取った「メニュー」文字列削除版。以下の結論は、作業履歴の原ログ、当時のインストーラー、埋め込みデータの解析、当時と一致するフロントエンドによる再現に基づく。

## 結論

資源消費は、Codexアプリとツール群の常駐メモリに、Thenの重いRust配布用ビルドが加わる構成、および生成物の複製・保持が原因。Thenでは画面の変更でもRustライブラリ全体の再コンパイルが必要になり、Windowsの配布では消費されないライブラリ形式まで生成している。キャッシュを消すだけでは次のビルドで再生成される。

起動不良は、メインJavaScriptの圧縮キャッシュがメモリ割り当て失敗時に0バイトで残り、Tauriが再実行時に無検証で再利用し、その0バイトを実行ファイルへ埋め込んだことが原因。文字列削除によるReactの不具合ではない。実行時には解凍に失敗してHTMLへフォールバックし、WebViewがJavaScriptとしての読み込みを拒否していた。

Codexの作業手順には、失敗したビルドのキャッシュを検査せず再実行したこと、ファイル名の存在確認を画面データの正常性確認として扱ったこと、実アプリの起動確認を行わずインストーラーを渡したこと、正常版を同名出力へ上書きしたことが問題として残る。

## 1. メモリと中間ファイルが増える理由

### 1.1 UI変更がRust全体の再コンパイルになる

src-tauri/src/lib.rs:567 の tauri::generate_context!() がフロントエンドをコンパイル時に埋め込む。使用中の tauri-codegen 2.6.2 は元ファイルと圧縮ファイルを include_bytes! でRustの依存入力にする（embedded_assets.rs:399-403）。UI変更でViteのJavaScript内容・ファイル名が変わると、Rustライブラリの入力も変わる。

Thenには資源量を調整する [profile.dev] / [profile.release] がない。通常開発のdev設定はデバッグ情報と増分キャッシュを保存し、releaseは最適化レベル3・増分コンパイルなしを既定とする。したがって「1行だけ変更」でも配布用ビルドではRustライブラリ全体の最適化をやり直す。当時の原ログはRust側だけで10分03秒、次の修復ビルドも9分54秒を記録している。

公式仕様: [Cargo profiles](https://doc.rust-lang.org/cargo/reference/profiles.html)。ここでいう配布用ビルドは package.json:123 の tauri build。通常のフロントエンド確認に使う Vite のHMRとは実行工程が異なる。

### 1.2 Windows版に不要な形式まで生成している

src-tauri/Cargo.toml:10 は crate-type = ["staticlib", "cdylib", "rlib"]。Windowsのmain.rs:4はRustライブラリの brew_lib::run() を呼び、インストーラーの本体は Then.exe。staticlibとcdylibを呼ぶ別言語のアプリはこの構成にない。

staticlibは依存ライブラリを含む独立したアーカイブを作る。RustがRustライブラリをリンクするために使う形式はrlibであり、staticlibはその入力として使われない。この仕様は [Rust linkage](https://doc.rust-lang.org/reference/linkage.html) で確認した。

当時の実際の停止箇所も release/deps/brew_lib.lib の生成で、エラーは「ディスクに十分な空き領域がありません。 (os error 112)」。したがって追加形式の生成は今回のディスク不足に直接関与している。

調査開始時のRust生成物は約1,825MiB。形式別集計ではrelease/depsのrlibが約801MiB、rmetaが約375MiB、libが約129MiB、pdbが約77MiB。release/buildにも約303MiBあり、そのうちpdbが約158MiB。各値はファイルの論理サイズで、完成した約44MiBのThen.exeのサイズとは別物である。計測開始前と計測中のスナップショットを別ファイルに保存した。

### 1.3 作業フォルダーと検証出力の複製・保持

11月3日昼の整理ログは、メイン作業フォルダーのRustキャッシュ約4.7GB、別worktree2か所のRustキャッシュ各約2GB、比較用ビルド9個約481MB、検証ブラウザーの残存データ約648MBを削除し、合計約8.9GBを空けたと記録している。別worktreeは .claude/worktrees 配下であり、Codex管理worktreeであると読み替えてはいない。

キャッシュを削除したあと、依存ライブラリを含むビルドが再実行されていた。Rustのキャッシュはビルド速度のための保存物なので、生成方式を変えずに消せば再び作られる。

今回の調査開始時点にも、次のファイルが残っていた。

| 保存場所 | 論理サイズ | 内容 |
| --- | ---: | --- |
| src-tauri/target | 約1,825MiB | Rustの生成物・本体・インストーラー |
| artifacts | 約1,891MiB | 比較ビルド、実行ファイル、トレースなど |
| .tmp | 約372MiB | 検証出力、トレース、退避ファイルなど |
| tmp | 約211MiB | 検証出力と実行ファイルの退避など |
| target | 約185MiB | QA用本体、ヒープスナップショットなど |
| .claude/worktrees | 約1,000MiB | ソース、依存物、保持された本体など |

検証用フォルダーを横断すると NotoSerifCJKjp-Regular.otf / NotoSansCJKjp-Regular.otf の複製が58ファイル、合計約1,135MiBあった。この値は上表に含まれるため加算しない。Viteの出力先を検証ごとに変えるとpublic内のフォントなどもコピーされ、それぞれを残す運用が容量を増やしている。

ブラウザーについては scripts/lib/stop-browser.mjs:1-8 に、Windowsで親だけ終了して子のrenderer/GPUが残ること、Edgeの起動用プロセスが先に終了すると親PIDの終了だけでは止められないことが記録され、実際に昼の整理でも残存データが確認・削除されていた。現在のヘルパーにはプロファイル名で子を終了する処理があるが、過去に残った生成物を自動的に消す仕組みではない。

Codex自体の保存領域も測定した。sessions約590MiB、plugins約533MiB、visualizations約471MiB、thread_history_1.sqlite約436MiBなどがある。プロジェクトのRust中間ファイルとCodexの会話履歴は別の保存物である。

### 1.4 実メモリの内訳

PCは物理メモリ16,849,256,448バイト、論理CPU12個。調査開始時、空き物理メモリは約1.5GiBだった。1ジョブのRustビルドを追加して親子プロセスを追跡すると、次の使用量になった。

| 対象 | 実測したPrivate Bytes |
| --- | ---: |
| Codexの画面系 ChatGPT.exe 15プロセス | 約2,004MiB |
| Node.js 23プロセス | 約957MiB |
| Codex実行エンジン codex.exe 6プロセス | 約282MiB |
| 計測中のRustプロセス | 約1,199MiB（この時点） |
| Codexの親子プロセス全体 | 約4.73GiB（Rust・ツールを含む） |

Private Bytesは専有コミット量であり、現在すべてが物理RAM上にあるという意味ではない。共有ページを重ねて数えるWorking Setの単純加算は使っていない。表のプロセス群と全体も重複加算しない。

Cargoのjobs固定設定はない。このPCでは既定の並列数が論理CPU数に基づく。加えてrustc内部にもコード生成単位の並列処理があるため、jobs=1はrustc内部まで1スレッドにする指定ではない。[Cargo configuration](https://doc.rust-lang.org/cargo/reference/config.html)

実際の最初の失敗はRustの memory allocation of 8650761 bytes failed。8,650,761バイトは最後に拒否された1回の確保量であり、ビルド全体の使用メモリではない。現在のWindowsジョブを検査した結果、processMemoryLimit / jobMemoryLimit はどちらも0だった。当時のOS全体のピークコミット量は保存されていないため、当時の全使用量やCodexアプリ本体のメモリリークをこのエラーだけから断定していない。確認できた資源消費の原因は、上記の常駐プロセス群、Rustの最適化・複数形式生成、検証出力の蓄積である。

調査用に実行した1ジョブのreleaseライブラリビルドは10分36秒で完了した。rustc単体のピークは専有コミット量1,327MiB、Working Set 1,004MiB。集計は resource-build-summary.json に記録した。

## 2. 起動しないインストーラーが生成された経路

### 2.1 対象ファイルを特定

保存されていた .tmp/Then_0.7.0_x64-setup-before-startup-fix.exe は35,760,378バイト。

SHA-256: 77c7e0fc3bdb9cc9afda31dafcdb480a944682dfc8793acd6996d0c000270c3d

当時「verified: true」として渡したインストーラーのSHA-256と完全一致した。取り出したThen.exeのSHA-256は 6a379795912b35aef0fe12acf92e75d5fc303ac66ce1c6584605e8077a96735d。

現時点の同名リリース出力と混同せず、この保存済み不良ファイルを対象に調査した。

### 2.2 当時と同じJavaScriptとキャッシュ名を再構成

現在のソースを書き換えず、Viteの調査用transformで TopbarFileMenu.tsx の <span>メニュー</span> だけを除いた。その結果、当時と同じ assets/index-CaPg16qp.js が生成された。

その内容を使用中のtauri-codegen自身のBLAKE3実装でハッシュすると、以下の値になった。

2919fcdb6d655debc35623c9af402ccc013cf93a7468447ed3bd23fbd5da69b9

これは、当時0バイトと記録された圧縮キャッシュ名と一致する。文字列削除によって新しいJavaScriptと新しい圧縮キャッシュが必要になったことを確認できる。

### 2.3 原ログの時系列（JST）

1. 11月3日23:10:36 — 上記の圧縮キャッシュが作成された。後のファイル検査で長さ0、最終更新時刻23:10:36.434と記録。
2. 23:10:46 — 最初の配布用ビルドが memory allocation of 8650761 bytes failed で終了。
3. 23:22:43 — 1ジョブに変えた再実行が brew_lib.lib を生成中にディスク不足（os error 112）で終了。
4. 容量確保後 — 同じソースを再ビルド。空の圧縮キャッシュを再利用したまま、RustとNSISの処理は成功。
5. 11月4日00:08:28 — バージョン、ライセンス、埋め込みファイル名、NSIS本体の同一性を確認した結果を「verified: true」と記録し、インストーラーを渡した。実アプリの描画確認はしていなかった。

キャッシュ破損を発生させた最初の停止はメモリ割り当て失敗であり、その後のディスク不足とは順序を区別する必要がある。

### 2.4 Tauriで何が起きたか

使用中のtauri-codegen 2.6.2のembedded_assets.rs:354-383は、出力が存在しないときだけFile::createで最終ファイル名を作り、そのファイルへ直接Brotli圧縮データを書く。一時ファイルからのアトミックな置換ではない。ファイルが既に存在すると、長さも解凍可否も検査せずに処理を通す。

Brotliのリングバッファ確保では、入力用領域8,650,752バイトに前後の余白9バイトを足した8,650,761バイトを要求する（brotli 8.0.3、enc/encode.rs:709-724）。メモリ確保が失敗するとRustはabortし、先に作った0バイトファイルが残る。

次のビルドでは「ファイルが存在する」条件だけで圧縮をスキップし、include_bytes!で0バイトのまま埋め込む。Rustにとって空のbyte sliceは正当なデータなので、コンパイルやNSISパッケージングは成功する。

不良Then.exeのPEセクションとアセット表を解析した結果、/assets/index-CaPg16qp.js のキーは存在するが、データポインターは1、長さは0だった。ファイル名の文字列を検索するだけの検証は、この状態でも成功する。

実行時はtauri-utils 2.9.2のassets.rs:170-176でBrotli解凍が失敗しNoneになる。tauri 2.11.2のmanager/mod.rs:402-426はアセットを取得できないとindex.htmlへフォールバックする。WebViewにはJavaScriptの代わりにHTMLが返り、moduleのMIME検査で拒否される。Reactの起動処理まで到達しないため画面は空になる。

### 2.5 今回行った再現・照合

| 検証 | 結果 |
| --- | --- |
| 保存済みインストーラーのハッシュと当時の記録を比較 | 一致 |
| 文字列削除だけを適用してVite出力を再構成 | index-CaPg16qp.jsで一致 |
| Tauri自身のBLAKE3で内容をハッシュ | 0バイトキャッシュのファイル名と一致 |
| 使用中のTauriコードで8,650,761バイトの確保失敗を注入 | 当時と同じabort、0バイトキャッシュを生成 |
| そのキャッシュを残して失敗注入なしで再実行 | codegen_success=true、キャッシュは0バイトのまま |
| 空の新規キャッシュ先で同じ入力を処理 | 正常な圧縮データ187,023バイトを生成 |
| 不良インストーラー本体のアセット表を解析 | メインJSのデータ長0 |
| 不良本体を一時WebViewプロファイルで実際に起動 | rootChildren=0、JS要求へtext/html、本文はトップページと同一 |
| 既存repairスクリプトで同じ0バイトキャッシュを検査後に再生成 | 1件除去、187,023バイトへ回復、解凍内容が元JSと完全一致 |
| 既存のキャッシュ回復テスト | 成功 |

失敗注入は調査用の小さなRust実行ファイルのアロケーターだけに適用した。PC全体のメモリを意図的に使い切る実験は行っていない。

## 3. 既存の回復処理の検証

既存のキャッシュ回復処理で今回と同じ0バイトのデータを除去すると、Tauriが圧縮データを再生成し、展開結果が元のJavaScriptとバイト単位で一致した。回復処理はビルド前の検査であり、インストーラー内のアセット照合や実アプリの描画確認は別の検査である。

調査で作成した検証用ビルドと一時プロファイルを整理し、計測値・原ログ抜粋・再現結果を以下に保存した。

## 証拠ファイル

- historical-evidence.json / historical-timeline-extract.json — 原ログから抽出した失敗と検証履歴
- bad-exe-asset-table.json — 不良本体のアセット表
- original-entry-hash.json / original-entry-reproduction.json — 当時のJS名・BLAKE3・同一障害の再現
- bad-native-reproduction.json — 不良本体を実行した応答とWebViewエラー
- guard-recovery-result.json — 既存キャッシュ回復処理の検証
- disk-current.json / rust-artifact-breakdown.json / duplicate-font-assets.json — 容量の実測
- codex-process-tree-memory.json / resource-samples.jsonl / resource-build-summary.json — メモリ実測
- reproduce-tauri-cache.rs — 使用中のTauriコードをリンクして割り当て失敗を注入する再現プログラム
