// Mirrors src-tauri/src/ai (conversation.rs, store.rs, commands.rs).

export type AiProvider = "gemini" | "openAi" | "claude" | "local" | "fixture";
export type AiMode = "consult" | "webResearch";
export type AiTurnStatus = "sending" | "complete" | "failed" | "stopped" | "interrupted";
export type AiEnding = "complete" | "truncated" | "refused";

export type AiSendError =
  | { code: "emptyInput" }
  | { code: "badModel" }
  | { code: "inputTooLong"; chars: number; limit: number }
  | { code: "searchUnsupported" }
  | { code: "keyMissing" }
  | { code: "auth" }
  | { code: "rateLimited" }
  | { code: "quotaExceeded" }
  | { code: "network" }
  | { code: "timeout" }
  | { code: "modelUnsupported" }
  | { code: "searchFailed" }
  | { code: "rejected"; status: number }
  | { code: "serverError"; status: number }
  | { code: "responseTooLarge" }
  | { code: "badResponse" };

export type AiCitation = { title: string; url: string; start?: number; end?: number };

export type AiTurn = {
  id: string;
  input: string;
  answer?: string;
  citations?: AiCitation[];
  provider: AiProvider;
  model: string;
  mode: AiMode;
  promptVersion: number;
  status: AiTurnStatus;
  createdAt: number;
  updatedAt: number;
  searched?: boolean;
  ending?: AiEnding;
  error?: AiSendError;
  savedReferencePath?: string;
};

export type AiConversation = {
  id: string;
  title: string;
  provider: AiProvider;
  model: string;
  createdAt: number;
  updatedAt: number;
  turns: AiTurn[];
};

export type AiConversationSummary = {
  id: string;
  title: string;
  provider: AiProvider;
  model: string;
  updatedAt: number;
};

export type AiProviderInfo = {
  id: AiProvider;
  label: string;
  /** Recommended models; another id can be typed in the settings. */
  models: string[];
  webResearch: boolean;
  needsKey: boolean;
  keySaved: boolean;
  /** Wired in and ready to send. */
  available: boolean;
};

export function sendErrorMessage(error: AiSendError): string {
  switch (error.code) {
    case "emptyInput":
      return "質問を入力してください";
    case "badModel":
      return "モデル名に使えない文字が含まれています";
    case "inputTooLong":
      return `会話が長すぎます（${error.chars.toLocaleString()}字／上限${error.limit.toLocaleString()}字）`;
    case "searchUnsupported":
      return "この接続先ではWeb検索を使えません";
    case "keyMissing":
      return "接続先が設定されていません";
    case "auth":
      return "APIキーが認証されませんでした";
    case "rateLimited":
      return "利用の上限に達しました。時間をおいてください";
    case "quotaExceeded":
      return "残高または利用上限に達しました。接続先の管理画面で確かめてください";
    case "network":
      return "接続できませんでした";
    case "timeout":
      return "時間内に応答がありませんでした";
    case "modelUnsupported":
      return "このモデルは使えません";
    case "searchFailed":
      return "Web検索に失敗しました";
    case "rejected":
      return `要求を受け付けてもらえませんでした（${error.status}）`;
    case "serverError":
      return `接続先で障害が起きています（${error.status}）`;
    case "responseTooLarge":
      return "応答が大きすぎるため受け取れませんでした";
    case "badResponse":
      return "応答を読み取れませんでした";
  }
}
