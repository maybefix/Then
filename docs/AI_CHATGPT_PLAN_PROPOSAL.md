# ChatGPTプランでOpenAIを使う案（Sign in with ChatGPT）

作成日: 2026-10-22  
状態: **不採用（2026-10-23）**。配布する機能にするにはオープンソースのライセンスを付けるのが確実だが、同梱しているVivliostyle（AGPL-3.0）が絡むため見送った。OpenAIはAPIの残高を入れ、APIキーの方式で使う。Thenのライセンスの扱いが変わったら見直す。以下は調べた時点の記録として残す  
課題管理: [AI調査課題表](https://claude.ai/artifact/23k1n9c8PYxRt63r9SiEDG) AI-33  
関係する文書: [AI会話 実装範囲と手順書](AI_CONVERSATION_IMPLEMENTATION_PLAN.md)・[AI接続先の確認表](AI_PROVIDER_CHECKS.md)

## 1. なぜこの案か

OpenAIのAPIは、ChatGPTのプランとは別に前払いの残高が要る。残高がないと「残高または利用上限」で断られ、料金も利用履歴も残らない（2026-10-22、利用者の環境で確認）。

2026-09-29から、OpenAIの「Sign in with ChatGPT」（以下SIWC）で、利用者のChatGPTプラン（Plus/Pro）の利用枠をほかのアプリから使えるようになった。利用者はThenからChatGPTにサインインするだけで、APIの残高もキーも要らない。プランの枠の中なので、追加の料金もかからない。

## 2. Thenは対象になるか

### 2.1 規約（2026-09-29、本文を確認）

規約に「オープンソースであること」という条件はない。Thenに関係する条件と、今のThenの状態は次のとおり。

| 規約の条件 | 今のThen | 判定 |
| --- | --- | --- |
| 要求は利用者のPCの中から出す（またはその人だけが管理するリモート） | PCの中で動くデスクトップアプリ | 満たす |
| 本人のための要求だけ。別の人の操作で本人の枠を使わない。バックグラウンドで使うなら事前に明示の同意 | 利用者が送信を押したときだけ送る。バックグラウンドの送信はない | 満たす |
| プランは、つないだアプリの中だけで使う。汎用のAPIの代わりとして他のツールに提供しない | 会話画面と接続テストだけで使う | 満たす |
| SIWCでプランを使うのに、利用者からお金を取らない・有料版を求めない | 無料で配布している | 満たす（有料化するなら別途） |
| トークンは利用者の管理下のローカルに保存する。パスワードやセッションクッキーを求めない | 資格情報マネージャーに保存する設計 | 満たす（4.3参照） |
| サインイン時にアプリの名前を使い、OpenAIや他のアプリになりすまさない | 「Then」と名乗る | 満たす |
| OpenAIの名称・ロゴ・ボタンは許された形でだけ使う。後援や推奨をほのめかさない | 未実装 | 実装で守る（4.5） |
| 個人データは、処理の前に示すプライバシー通知に従って扱う。必要な開示・管理手段・同意を用意する | プライバシー通知がない | **足りない**（4.6） |
| 脆弱性や侵害に気づいたら、速やかにOpenAIへ連絡する | ― | 運用で守る |
| 複数アカウントで制限を回避しない、枠やトークンを他人と共有・転売しない | 該当する機能はない | 満たす |

規約に違反したり、安全上の危険があったりすると、OpenAIはそのアプリのSIWCを止められる。

### 2.2 公式の手引きが挙げる対象

開発者向けの資料では、最初の対象を次のとおり挙げている。

- オープンソースのプロジェクト
- ローカルで動く個人のプロジェクト
- 選ばれた非公開アプリ（選び方は書かれていない）

お金を取るアプリや、サーバー上で動くアプリは、申し込み（順番待ち）をしてから提供する。オープンソースの定義（どのライセンスか、など）は、資料のどこにも書かれていない。

### 2.3 Thenの位置づけ

ThenはGitHub Releasesで無料配布し、ソースも公開している。ただし**ライセンスがない**。ライセンスがないと、ソースが見えていても、他の人には使う・改変する・再配布する権利がない。一般には「オープンソース」に当たらない。

そのため、今のThenは次のように判断される。

- 開発者本人が自分で使うだけなら、「ローカルで動く個人のプロジェクト」に当たる。
- 他の人に配布する機能としては、「オープンソースのプロジェクト」とは言い切れず、「非公開アプリ」として選ばれる必要がある可能性が高い。

配布する機能として使うには、次のどちらかが要る。

1. **オープンソースのライセンスを付ける。** 対象であることがはっきりする。ただし作品の扱いに関わる判断で、同梱しているVivliostyle（AGPL-3.0）との兼ね合いも確かめる必要がある。この文書はライセンスの法的な判断をしない。
2. **ライセンスを付けずに、OpenAIの申し込み窓口で対象か確かめる。** 返事を待つことになる。

## 3. 何ができて、何が分からないか

| 項目 | 資料で分かること | 分からないこと |
| --- | --- | --- |
| 使える人 | ChatGPTのPlus・Proの利用者 | 地域の制限 |
| 送り先 | 今のOpenAIの接続と同じ `POST https://api.openai.com/v1/responses` | ― |
| 送り方 | サインインで得たトークンを `Authorization: Bearer` で付ける。`store: false` と `stream: true` が必須。過去の往復は毎回 `input` に入れる | ― |
| モデル | そのアカウントで使えるもの。`GET /v1/models` で一覧を取れる | 具体的な一覧 |
| Web検索 | 「モデルとアカウントの方針しだい」 | Thenで使えるかは試すまで分からない |
| 利用枠 | プランの枠に数えられ、追加の枠は付かない。利用者はChatGPTの設定でアプリごとに週の上限を決められる | 具体的な量 |
| 上限に達したとき | 回答の途中で `response.failed`（`subscription_sharing_usage_limit_exceeded` など）が来る | ― |
| サインイン | ブラウザでOpenAIにサインインし、PKCEつきの認可コードを `http://127.0.0.1:<ポート>/auth/callback` で受け取る。初回は登録用の `client_id=dynamic_agent_client` を使い、返ってきた `client_id` を保存する。クライアントシークレットもAPIキーも要らない | ― |
| 権限 | `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`。`chatgpt.tokens.use.direct` が許可されていなければ使えない | ― |
| トークンの寿命 | アプリが更新する必要がある | 寿命の公式の値（第三者の解説では1時間と30日） |
| つなぎを外す | ChatGPTの設定 → セキュリティとログイン → Sign in with ChatGPT → Disconnect。アプリからのサインアウトだけでは、つながりは残る | ― |

## 4. 計画の変更案

### 4.1 接続先の扱い

OpenAIを、二通りの使い方に分ける。

| 接続先 | 認証 | 料金 | 状態 |
| --- | --- | --- | --- |
| OpenAI（APIキー） | APIキー | APIの残高から | 実装済み（e2f2fd7）。残高がある人向けに残す |
| ChatGPTプラン（新設） | Sign in with ChatGPT | プランの枠の中 | この案で足す |

送り先と応答の形は同じなので、`ai::openai` の要求の組み立て・応答の読み取り・出典の変換は共通で使う。違うのは、認証とストリーミング受信だけ。

実API未確認だったOpenAIの「回答の読み取り・往復の送り返し・検索と出典の位置」は、ChatGPTプランで同じ形の応答を受けるので、ここで確かめられる。APIキーの経路は、キーの送り方と送り先が正しいところまで確認済みとして記録する。

### 4.2 手順書から外していた項目を戻す

手順書2.1「今回の対象外」の「アカウント発行、Then側の中継サーバー、代理課金、OAuth、Vertex AI等の追加認証方式」から、**OAuth（SIWCに限る）** を外す。中継サーバー・代理課金は引き続き作らない。SIWCは、利用者のPCとOpenAIの間だけで完結する。

### 4.3 新しく作るもの

| 作るもの | 中身 |
| --- | --- |
| サインイン | Rustで、ブラウザを開き（既存の `open_external_url`）、`127.0.0.1` で結果を受け取る。state・nonce・PKCEを毎回作り、stateを照合してからコードを交換する。待つのは数分までで、取り消せる |
| IDトークンの確認 | 署名と発行元・宛先・期限を確かめる。署名の確認に暗号ライブラリが要る（追加の依存） |
| 端末の識別子 | 資料の求めどおり、`did:key` 形式の識別子を初回に作って保存し、使い回す（個人を特定する値は使わない） |
| トークンの保管 | 更新用トークンと発行された `client_id` は資格情報マネージャーへ。資格情報マネージャーは1件2,560バイトまでなので、収まらない場合の扱い（分割、またはWindowsの暗号化APIで保護したファイル）を決める。アクセストークンはメモリだけに置く |
| トークンの更新 | 期限が近いか、401が返ったら更新する。更新に失敗したら、もう一度サインインを求める |
| ストリーミング受信 | Responses APIのSSEを受け、`response.completed` が来たときだけ成功とする。途中の `response.failed` を分類する。AI-20の「受信はストリーミングで」もこれで満たす |
| エラーの分類 | 「ChatGPTプランの利用上限に達しました」を新設する（`subscription_sharing_usage_limit_exceeded`、`subscription_sharing_usage_unavailable`） |
| モデルの一覧 | サインイン後に `GET /v1/models` で取り、設定のモデル欄の候補にする |
| サインアウト | Then側のトークンを消す。ChatGPT側のつながりを外す手順へのリンクも出す |

### 4.4 Web検索

ChatGPTプランでWeb検索付き調査を試す。断られたら、その接続先では「Web検索付き調査」を選べないようにし、黙って通常の回答に切り替えない（手順書の方針どおり）。

### 4.5 画面（OpenAIの表示の決まり）

OpenAIのUI/UXの指針で、次の表示が求められている。Thenの「画面に説明文を置かない」方針の例外になるが、規約の条件なので従う。

- サインインのボタンは「Continue with ChatGPT」とChatGPTのロゴ（OpenAIが用意した形だけを使う）
- 初めてプランで送るときに一度だけ、「You're using your ChatGPT plan」と「Got it」のお知らせ
- プランで送るときは、入力欄の近くに「Using ChatGPT plan」と、`https://chatgpt.com/settings/usage` への「Manage usage」
- 上限に達したときは「Manage usage」を一番目の操作にする
- つないだアカウントを表示する

日本語に訳してよいかは、指針に書かれていない。実装の前に確かめる（分からなければ英語の決まり文句のまま使う）。

### 4.6 プライバシー通知

規約は、個人データを扱う前にプライバシー通知を示すことを求めている。SIWCで受け取るのは、アカウントの名前・メールアドレス・画像（`openid profile email`）とトークン。Thenはこれまで個人データを扱っていないので、通知（何を受け取り、どこに保存し、どこへ送るか、どう消すか）を用意する必要がある。置き場所（README、ランディングページ、サインインの前の画面）は決める必要がある。

### 4.7 工程の組み直し

| 工程 | 内容 |
| --- | --- |
| 5a（新設） | ChatGPTプラン：サインイン、トークンの保管と更新、ストリーミング受信、モデルの一覧、エラーの分類、設定の画面と表示の決まり、プライバシー通知 |
| 5a の確認 | 利用者にサインインしていただき、相談の往復・Web検索付き調査・出典の位置を実際の応答で確かめる |
| 5b | ローカルLLM（Ollama）。順番はこれまでどおり、急がない |
| 5c | Claude |

5aは、対象かどうか（2.3）が決まってから始める。

### 4.8 増える依存とリスク

- 暗号ライブラリ（IDトークンの署名確認、`did:key` の生成）が増える。
- SIWCは公開から1か月ほどで、資料も「プレビュー」としている。仕様が変わる前提で、確認表に確認日を残す。
- OpenAIの判断でアプリのSIWCが止められることがある。止められても、APIキーの経路とGeminiは残る。

## 5. 決めていただくこと

1. **Thenを対象にする道**（2.3）
   - A：オープンソースのライセンスを付ける（ライセンスの種類と、Vivliostyleとの兼ね合いの確認を含む）
   - B：ライセンスを付けず、OpenAIの申し込み窓口で対象か確かめる
   - C：まず開発者本人の個人利用として作り、配布の機能にするかは後で決める
2. **プライバシー通知の置き場所**（4.6）
3. **計画の変更**（4.1〜4.7）をこの形で進めるか

## 6. 参照した資料（2026-10-22に確認）

- [ChatGPT でサインイン利用規約](https://openai.com/ja-JP/policies/sign-in-with-chatgpt-terms/)（2026-09-29）
- [In your open-source app（概要）](https://developers.openai.com/siwc/token-sharing-open-source)
- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [UI/UX guidelines](https://developers.openai.com/siwc/ui-ux-guidelines)
- [Quickstart](https://developers.openai.com/siwc/quickstart)
- [Request a client ID](https://developers.openai.com/siwc/request-client-id)
- [Integrating Sign in with ChatGPT in your Opensource App](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)
- [Sign in with ChatGPT（利用者向け）](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)
