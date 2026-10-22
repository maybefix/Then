# AI接続先の確認表

確認日: 2026-10-22  
用途: [AI会話 実装範囲と手順書](AI_CONVERSATION_IMPLEMENTATION_PLAN.md)の工程0（AI-03）。各接続先の実装で使う値と、確認できなかった点を残す。モデル名・料金・条件は変わるため、各接続先を実装する工程で確かめ直し、この表を更新する。

## 1. 一覧

| 項目 | Gemini | OpenAI | Claude | ローカルLLM（Ollama） |
| --- | --- | --- | --- | --- |
| 使うAPI | `generateContent`（v1beta） | Responses API | Messages API | OpenAI互換 Chat Completions |
| エンドポイント | `https://generativelanguage.googleapis.com/v1beta/models/<モデル>:generateContent` | `https://api.openai.com/v1/responses` | `https://api.anthropic.com/v1/messages` | `http://localhost:11434/v1/chat/completions`（loopbackのみ） |
| キーの送り方 | `x-goog-api-key` ヘッダー（URLの `key=` には載せない） | `Authorization: Bearer` | `x-api-key` と `anthropic-version: 2023-06-01` | 不要（Ollamaは無視する） |
| 推奨モデル（初期値） | `gemini-3.5-flash-lite`（安価）、`gemini-3.8-flash` | `gpt-6-luna`（安価）、`gpt-6.1-sol` | `claude-sonnet-5-5`、`claude-haiku-5-5`（安価）、`claude-opus-5-5` | 利用者が入力 |
| Web検索 | 初期版は出さない（手順書5.3） | ツール `web_search` | ツール `web_search_20250305`、`max_uses: 5` | 非対応 |
| 検索回数の上限 | ― | 指定する項目がない。`search_context_size: "low"` で量を抑える | `max_uses` で指定できる | ― |
| 出典の返り方 | （検索なし） | `message` の `annotations` に `url_citation`（`url`、`title`、`start_index`、`end_index`） | `text` ブロックの `citations` に `web_search_result_location`（`url`、`title`、`cited_text`、`encrypted_index`） | なし |
| 出典の表示条件 | ― | 本文中の出典を「見えて、クリックできる」ように出す | 利用者に見せるときは出典を含める。加工して見せる場合は法務と相談のうえ適切に出す | ― |
| 往復を続けるとき送り返すもの | 思考やツールを使ったときは、モデルが返した部分を手を加えずに返す | 推論モデルの出力項目（`store: false` で使う場合） | 検索結果の `encrypted_content`、出典の `encrypted_index`、思考ブロックを手を加えずに返す。欠けたり変わったりすると400 | 文章だけ |
| 長い応答 | `:streamGenerateContent?alt=sse` | `stream: true` | 出力の多い依頼はストリーミングを推奨。検索中に `stop_reason: "pause_turn"` で一時停止することがあり、そのまま送り返して続ける | `stream: true` |
| 途中で切れた印 | `finishReason: "MAX_TOKENS"`（資料による。実APIでは未観測） | `status: "incomplete"` | `stop_reason: "max_tokens"` | `finish_reason: "length"` |
| 拒否の印 | `promptFeedback.blockReason` ほか（工程4で確かめる） | 工程5で確かめる | `stop_reason: "refusal"` と `stop_details` | ― |
| 検索の失敗 | ― | `web_search_call` の `status` | HTTP 200 のまま、`web_search_tool_result` の `content` がエラー（`max_uses_exceeded`、`too_many_requests`、`unavailable` など） | ― |
| 利用量 | `usageMetadata`（`promptTokenCount`、`candidatesTokenCount`、`thoughtsTokenCount`） | `usage` | `usage`（`input_tokens`、`output_tokens`、`server_tool_use.web_search_requests`） | `usage`（`stream_options.include_usage` で受け取る） |
| 料金 | 3.5 Flash-Lite: 入力$0.30／出力$2.50（100万トークンあたり）。3.8 Flash: $0.75／$3.75（2026-12-31まで） | 料金ページで確かめる | Sonnet 5.5: $2／$10、Haiku 5.5: $0.10／$0.50、Opus 5.5: $4／$20。検索は1,000回$10 | 無料 |
| 無料枠 | あり。無料枠では入力と回答がGoogleの改善に使われる（AI-23。区別はしない） | なし | なし | ― |
| 公式資料 | [モデル](https://ai.google.dev/gemini-api/docs/models)・[API](https://ai.google.dev/api/generate-content)・[料金](https://ai.google.dev/gemini-api/docs/pricing)・[規約](https://ai.google.dev/gemini-api/terms) | [Web search](https://developers.openai.com/api/docs/guides/tools-web-search)・[モデル](https://developers.openai.com/api/docs/models) | [Web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)・[料金](https://platform.claude.com/docs/en/about-claude/pricing) | [OpenAI互換](https://docs.ollama.com/api/openai-compatibility) |

## 2. 実装と手順書に効くこと

### 2.1 接続先の生の応答を往復ごとに残す（AI-30）

Claude・OpenAI・Geminiは、検索や思考を使った往復を続けるとき、前の応答の一部を手を加えずに送り返す必要がある。Claudeでは、検索結果の `encrypted_content` などが欠けたり変わったりすると、要求が400で失敗する。

手順書4.2の往復の記録に、接続先の生の応答のうち送り返しが要る部分（`native`）を足す。会話は送信のたびにThenの記録から組み立て直すので、この欄から往復を復元する。表示用に整えた回答本文からは組み立てない。

### 2.2 出力上限は16,000トークンにする

手順書6.1の出力上限は8,192トークンとしていた。思考を使うモデルでは思考も出力上限に数えるため、回答が途中で切れやすい。初期値を16,000トークンに上げ、受信はストリーミングで受けてまとめる（AI-20）。

### 2.3 出典は本文中の番号もクリックできるようにする

OpenAIは本文中の出典を「見えて、クリックできる」ように出すことを求めている。手順書3.5の「出典を末尾に番号付きで並べ、本文から番号で参照する」に加えて、本文中の番号自体を出典へのリンクにする。

### 2.4 Claudeの拒否時の別モデル再実行は使わない

Claudeには、拒否したときに別のモデルで自動的にやり直す仕組み（`fallbacks`）がある。手順書は「モデルを黙って切り替えない」方針なので、初期版では使わない。拒否は往復の状態として表示し、別のモデルで聞くかどうかは利用者が決める。

### 2.5 GeminiのAPIは `generateContent` を使う

Geminiの文章生成の案内ページは、新しいInteractions APIを中心に書かれている。`generateContent` も現役のAPIとして資料にあり、廃止の告知はない。会話を毎回Then側から組み立てる設計には、往復を `contents` に並べるだけの `generateContent` のほうが合う。Interactions APIは、サーバー側に状態を持たない `store: false` でも使えるので、工程4で問題が出たら切り替えを考える。

## 3. 実APIで確かめたこと

| 日付 | 接続先 | 確かめたこと |
| --- | --- | --- |
| 2026-10-22 | Gemini（`gemini-3.5-flash-lite`） | `x-goog-api-key` ヘッダーで認証できる。2往復目が1往復目を踏まえて答える（Geminiが返した `content` を送り返す形で）。`finishReason: "STOP"` で通常の回答になる。`usageMetadata` から入力・出力トークンを記録できる |

## 4. 確かめきれなかった点

| 点 | いつ確かめるか |
| --- | --- |
| Geminiの `MAX_TOKENS` と拒否（`SAFETY` など、`promptFeedback.blockReason`）の実際の応答 | 2026-10-22の実API確認では通常の終了（`STOP`）だけを観測した。資料の値で実装済み。実際に起きたら確認表を直す |
| Geminiの思考の設定項目 | 初期版は指定しない（モデルの既定のまま）。思考のトークンは出力上限に数える |
| OpenAIの料金、拒否の印、`store: false` で送り返す項目 | 工程5 |
| Claudeの検索を、`max_uses` が効く基本版（`web_search_20250305`）にするか、結果を絞り込む新版（`web_search_20260209` 以降）にするか | 工程5。新版は内部でコード実行を使い、応答の形が増える |
| Ollamaの `usage` の中身 | 工程5 |
