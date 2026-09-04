/**
 * 校正辞書。原稿に出てくる固有名詞・キャラクター名・作中の用語を書き手が
 * 自分で登録し、校正の対象から外したり、表記のゆれを見つけたりするための語彙。
 *
 * 主な入り口は一括入力で、指摘カードからの追加は補助。「これを誤検出して
 * ほしくない」という宣言を先に書けることを優先している。
 */

export type ProofreadTermKind = "person" | "place" | "org" | "term" | "other";

/**
 * 語の扱い。
 * - protect: どのルールもこの語に触れない。
 * - unify: 別表記や読みの食い違いを指摘する（表記の統一）。
 * - both: 両方。
 */
export type ProofreadTermPolicy = "protect" | "unify" | "both";

/** project はワークスペースの .then/project.json、global は全ワークスペース共通。 */
export type ProofreadTermScope = "project" | "global";

export type ProofreadTerm = {
  id: string;
  /** 正しい表記。 */
  surface: string;
  /** 読み。ルビの統一照合に使う。 */
  reading: string;
  kind: ProofreadTermKind;
  /** 誤りやすい表記。 */
  variants: string[];
  note: string;
  policy: ProofreadTermPolicy;
  scope: ProofreadTermScope;
  createdAt: number;
  updatedAt: number;
};

export const proofreadTermKindLabels: Record<ProofreadTermKind, string> = {
  person: "人物",
  place: "地名",
  org: "組織",
  term: "用語",
  other: "その他",
};

export const proofreadTermPolicyLabels: Record<ProofreadTermPolicy, string> = {
  protect: "守る",
  unify: "揃える",
  both: "守る＋揃える",
};

/** 一括入力で受け付ける種別の書き方。 */
const KIND_ALIASES: Record<string, ProofreadTermKind> = {
  person: "person",
  人物: "person",
  人名: "person",
  キャラクター: "person",
  キャラ: "person",
  place: "place",
  地名: "place",
  場所: "place",
  org: "org",
  組織: "org",
  団体: "org",
  会社: "org",
  term: "term",
  用語: "term",
  語: "term",
  other: "other",
  その他: "other",
};

/** 一括入力で受け付ける扱いの書き方。 */
const POLICY_ALIASES: Record<string, ProofreadTermPolicy> = {
  protect: "protect",
  守る: "protect",
  除外: "protect",
  unify: "unify",
  揃える: "unify",
  統一: "unify",
  both: "both",
  両方: "both",
  // 書き出した辞書をそのまま読み戻せるよう、表示に使う名前も受ける。
  "守る＋揃える": "both",
};

/** 登録できる表記の上限。長すぎるものは行の取り違えなので弾く。 */
const MAX_SURFACE_LENGTH = 40;

/**
 * 表記に使えない文字。鉤括弧を含む語を伏せると会話文の対応が崩れ、
 * 括弧の閉じ忘れを誤検出してしまう。
 */
const FORBIDDEN_SURFACE = /[「」『』\n\r\t]/;

/** 別表記の列の中で、複数の表記を分ける記号。 */
const VARIANT_SEPARATOR = /[/／|｜]/;

/** 列の区切り。タブ、カンマ、2つ以上の空白を認める。 */
const COLUMN_SEPARATOR = /\t|[,，]|[ 　]{2,}/;

const normalizeKind = (value: string | undefined): ProofreadTermKind =>
  KIND_ALIASES[(value ?? "").trim()] ?? "other";

const normalizePolicy = (value: string | undefined): ProofreadTermPolicy =>
  POLICY_ALIASES[(value ?? "").trim()] ?? "protect";

export const isUsableTermSurface = (surface: string) =>
  surface.length > 0 &&
  surface.length <= MAX_SURFACE_LENGTH &&
  !FORBIDDEN_SURFACE.test(surface);

let termSequence = 0;
const createTermId = () => {
  termSequence += 1;
  return `term-${Date.now().toString(36)}-${termSequence.toString(36)}`;
};

/** 別表記の列を読む。決めた表記そのものと、使えない表記は落とす。 */
function parseVariantColumn(column: string | undefined, surface: string): string[] {
  if (!column) return [];
  const seen = new Set<string>();
  const variants: string[] = [];
  for (const raw of column.split(VARIANT_SEPARATOR)) {
    const variant = raw.trim();
    if (!variant || variant === surface || seen.has(variant)) continue;
    if (!isUsableTermSurface(variant)) continue;
    seen.add(variant);
    variants.push(variant);
  }
  return variants;
}

export type ParsedTermInput = {
  terms: ProofreadTerm[];
  /** 取り込めなかった行。理由を添えて画面に出す。 */
  rejected: { line: string; reason: string }[];
};

/**
 * 一括入力を解析する。1行1語で、タブ・カンマ・連続空白で
 * 「表記／読み／種別／扱い」の順に指定できる。`#` で始まる行は覚書として飛ばす。
 */
export function parseProofreadTermInput(
  input: string,
  scope: ProofreadTermScope,
): ParsedTermInput {
  const terms: ProofreadTerm[] = [];
  const rejected: { line: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const columns = line.split(COLUMN_SEPARATOR).map((column) => column.trim());
    const surface = columns[0] ?? "";

    if (!isUsableTermSurface(surface)) {
      rejected.push({
        line,
        reason: FORBIDDEN_SURFACE.test(surface)
          ? "鉤括弧や制御文字は表記に使えません"
          : `表記が空か、${MAX_SURFACE_LENGTH}文字を超えています`,
      });
      continue;
    }
    if (seen.has(surface)) {
      rejected.push({ line, reason: "同じ表記が入力の中で重複しています" });
      continue;
    }

    seen.add(surface);
    const now = Date.now();
    terms.push({
      id: createTermId(),
      surface,
      reading: columns[1] ?? "",
      kind: normalizeKind(columns[2]),
      variants: parseVariantColumn(columns[4], surface),
      note: "",
      policy: normalizePolicy(columns[3]),
      scope,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { terms, rejected };
}

/** 保存済みの辞書を読み戻す。壊れた項目は落とし、足りない欄は既定で埋める。 */
export function normalizeProofreadTerms(
  value: unknown,
  scope: ProofreadTermScope,
): ProofreadTerm[] {
  if (!Array.isArray(value)) return [];

  const terms: ProofreadTerm[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Partial<ProofreadTerm>;
    const surface = typeof record.surface === "string" ? record.surface.trim() : "";
    if (!isUsableTermSurface(surface) || seen.has(surface)) continue;

    seen.add(surface);
    const now = Date.now();
    terms.push({
      id: typeof record.id === "string" && record.id ? record.id : createTermId(),
      surface,
      reading: typeof record.reading === "string" ? record.reading : "",
      kind: normalizeKind(record.kind),
      variants: Array.isArray(record.variants)
        ? record.variants.filter(
            (variant): variant is string =>
              typeof variant === "string" && isUsableTermSurface(variant.trim()),
          )
        : [],
      note: typeof record.note === "string" ? record.note : "",
      policy: normalizePolicy(record.policy),
      scope,
      createdAt: typeof record.createdAt === "number" ? record.createdAt : now,
      updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : now,
    });
  }

  return terms;
}

export type TermMergeResult = {
  terms: ProofreadTerm[];
  added: number;
  updated: number;
};

/**
 * 取り込んだ語を既存の辞書に足す。同じ表記があれば、入力側で埋まっている欄だけ
 * 上書きする。読みや覚書を消してしまわないようにするため。
 */
export function mergeProofreadTerms(
  existing: ProofreadTerm[],
  incoming: ProofreadTerm[],
): TermMergeResult {
  const bySurface = new Map(existing.map((term) => [term.surface, term]));
  let added = 0;
  let updated = 0;

  for (const term of incoming) {
    const current = bySurface.get(term.surface);
    if (!current) {
      bySurface.set(term.surface, term);
      added += 1;
      continue;
    }
    const merged: ProofreadTerm = {
      ...current,
      reading: term.reading || current.reading,
      kind: term.kind === "other" ? current.kind : term.kind,
      variants: term.variants.length ? term.variants : current.variants,
      policy: term.policy,
      updatedAt: Date.now(),
    };
    bySurface.set(term.surface, merged);
    if (
      merged.reading !== current.reading ||
      merged.kind !== current.kind ||
      merged.policy !== current.policy ||
      merged.variants.join("/") !== current.variants.join("/")
    ) {
      updated += 1;
    }
  }

  return { terms: [...bySurface.values()], added, updated };
}

export const proofreadTermKinds: ProofreadTermKind[] = [
  "person",
  "place",
  "org",
  "term",
  "other",
];

export const proofreadTermPolicies: ProofreadTermPolicy[] = ["protect", "unify", "both"];

/** 一覧の入力欄に書かれた別表記を配列に直す。 */
export function parseVariantInput(input: string, surface: string): string[] {
  return parseVariantColumn(input, surface);
}

/** 一覧の入力欄へ戻すための表示。 */
export const formatVariants = (variants: string[]) => variants.join(" / ");

/** 一覧の並び順。 */
export type ProofreadTermOrder = "surface" | "recent";

export function sortProofreadTerms(
  terms: ProofreadTerm[],
  order: ProofreadTermOrder,
): ProofreadTerm[] {
  const sorted = [...terms];
  if (order === "recent") {
    sorted.sort((left, right) => right.updatedAt - left.updatedAt);
  } else {
    sorted.sort((left, right) => left.surface.localeCompare(right.surface, "ja"));
  }
  return sorted;
}

/**
 * 表記として使えるかを確かめ、使えない理由を返す。同じ辞書の中で
 * 表記が重複すると、どちらが効いているのか分からなくなるので弾く。
 */
export function validateTermSurface(
  surface: string,
  terms: ProofreadTerm[],
  exceptId?: string,
): string | null {
  const trimmed = surface.trim();
  if (!trimmed) return "表記を入力してください";
  if (FORBIDDEN_SURFACE.test(trimmed)) return "鉤括弧や制御文字は表記に使えません";
  if (trimmed.length > MAX_SURFACE_LENGTH) return `表記は${MAX_SURFACE_LENGTH}文字までです`;
  if (terms.some((term) => term.id !== exceptId && term.surface === trimmed)) {
    return "同じ表記がこの辞書にすでにあります";
  }
  return null;
}

/** 1語だけ書き換える。更新時刻は自動で進める。 */
export function updateProofreadTerm(
  terms: ProofreadTerm[],
  id: string,
  patch: Partial<Omit<ProofreadTerm, "id" | "scope">>,
): ProofreadTerm[] {
  return terms.map((term) =>
    term.id === id
      ? {
          ...term,
          ...patch,
          surface: (patch.surface ?? term.surface).trim(),
          updatedAt: Date.now(),
        }
      : term,
  );
}

/** 保存範囲を移すときに、記録側の scope も合わせる。 */
export function retargetProofreadTerm(
  term: ProofreadTerm,
  scope: ProofreadTermScope,
): ProofreadTerm {
  return { ...term, scope, updatedAt: Date.now() };
}

/**
 * 校正の対象から外す表記を集める。長い順に返し、
 * 「見積システム」を「見積」より先に伏せられるようにする。
 */
export function collectProtectedSurfaces(terms: ProofreadTerm[]): string[] {
  return terms
    .filter((term) => term.policy === "protect" || term.policy === "both")
    .map((term) => term.surface)
    .sort((left, right) => right.length - left.length);
}

/** 一括入力欄に貼り戻せる形へ書き出す。 */
export function formatProofreadTermsForExport(terms: ProofreadTerm[]): string {
  return sortProofreadTerms(terms, "surface")
    .map((term) => {
      const columns = [
        term.surface,
        term.reading,
        proofreadTermKindLabels[term.kind],
        proofreadTermPolicyLabels[term.policy],
        term.variants.join("/"),
      ].join("\t");
      // 覚書は列に出すと読み込み時に扱いの列とずれるので、行末の注記として付ける。
      return term.note ? `${columns}\t# ${term.note.replace(/\s+/g, " ")}` : columns;
    })
    .join("\n");
}
