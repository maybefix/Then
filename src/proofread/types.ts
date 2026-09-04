/**
 * 日本語原稿の校正ルールと検出結果の型。
 *
 * ルールは「何を根拠に指摘するのか」を必ず {@link ProofreadSource} として持つ。
 * 検出条件そのものはThenの実装だが、判断のよりどころにした資料を画面に出せる
 * ようにしておき、指摘を受け入れるかどうかを書き手が自分で決められるようにする。
 */

/** 指摘の強さ。表記基準に反するものほど強い。 */
export type ProofreadSeverity = "must" | "should" | "hint";

/** どの種類の原稿で有効にしたいか。 */
export type ProofreadTarget = "common" | "article" | "novel";

/** ルールの根拠にした資料。 */
export type ProofreadSource = {
  /** 資料名。 */
  title: string;
  /** 発行者・編者。 */
  publisher: string;
  /** 告示番号や版など、資料を特定するための補足。 */
  edition?: string;
  /** 発行年（西暦）。確認できるものだけ入れる。 */
  year?: number;
  /** どこで全文を参照できるか。 */
  locator: string;
  /** その資料が述べている内容の要約。指摘の根拠として表示する。 */
  basis: string;
};

/** ルールの調整値。ペインから変更できる。 */
export type ProofreadOptions = {
  /** 一文の上限文字数。超えた文を指摘する。 */
  maxSentenceLength: number;
  /** 一文に許す読点の数。 */
  maxCommasPerSentence: number;
  /** 「」で囲まれた会話文を検査から外すか。 */
  skipDialogue: boolean;
};

export const DEFAULT_PROOFREAD_OPTIONS: ProofreadOptions = {
  maxSentenceLength: 80,
  maxCommasPerSentence: 4,
  skipDialogue: true,
};

/** 本文を文単位に区切ったもの。オフセットは本文先頭からのUTF-16位置。 */
export type ProofreadSentence = {
  from: number;
  to: number;
  text: string;
  /** 1始まりの行番号。 */
  line: number;
};

/** ルールに渡す解析済みの本文。 */
export type ProofreadContext = {
  /** 元の本文。オフセットの基準。 */
  text: string;
  /**
   * 検査用の本文。コードブロック・ルビの読み・URLなど、校正対象にすべきでない
   * 範囲を同じ長さの NUL で潰してある。長さは {@link text} と一致するので、
   * 正規表現の index をそのまま本文オフセットとして使える。
   */
  scanText: string;
  /** {@link scanText} からさらに会話文（「」の内側）を潰した本文。 */
  narrationText: string;
  /** 文の一覧。見出し行やコードブロックは含まない。 */
  sentences: ProofreadSentence[];
  options: ProofreadOptions;
  /** オフセットの行番号（1始まり）。 */
  lineAt: (offset: number) => number;
  /** その行の先頭オフセット。 */
  lineStart: (line: number) => number;
};

/** ルールが返す生の検出結果。 */
export type ProofreadHit = {
  from: number;
  to: number;
  /** 何が問題かを一文で。 */
  message: string;
  /** 機械的に置き換えられる場合の候補。曖昧なものは付けない。 */
  replacement?: string;
  /** この指摘だけの補足（該当語の言い換え例など）。 */
  detail?: string;
};

export type ProofreadRule = {
  id: string;
  /** ペインに出す短い名前。 */
  name: string;
  /** 何を見るルールかの説明。 */
  summary: string;
  severity: ProofreadSeverity;
  target: ProofreadTarget;
  /** 会話文を除外する設定の影響を受けるか。 */
  respectsDialogue: boolean;
  sources: ProofreadSource[];
  scan: (context: ProofreadContext) => ProofreadHit[];
};

/** 画面に出す確定した指摘。 */
export type ProofreadIssue = ProofreadHit & {
  /** 本文が変わらない限り安定するキー。無視リストにも使う。 */
  key: string;
  ruleId: string;
  ruleName: string;
  severity: ProofreadSeverity;
  line: number;
  column: number;
  /** 前後の文脈つきの抜粋。 */
  excerpt: {
    before: string;
    match: string;
    after: string;
  };
};

export const proofreadSeverityLabels: Record<ProofreadSeverity, string> = {
  must: "基準",
  should: "推奨",
  hint: "参考",
};

export const proofreadTargetLabels: Record<ProofreadTarget, string> = {
  common: "共通",
  article: "記事",
  novel: "小説",
};
