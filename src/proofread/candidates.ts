import { collectRubyAnnotations } from "./ruby";
import { isUsableTermSurface, type ProofreadTerm, type ProofreadTermKind } from "./terms";

/**
 * 原稿から辞書の候補を拾う。
 *
 * 辞書は書き手が自分で並べるものなので、これはあくまで登録の補助。既定では
 * 走らせず、押されたときだけ動く。手がかりが確かなものだけを出し、原稿の
 * 頻出語をやみくもに並べることはしない。拾いすぎると選ぶ手間の方が増える。
 */

export type TermCandidateSource = "ruby" | "honorific" | "katakana";

export const termCandidateSourceLabels: Record<TermCandidateSource, string> = {
  ruby: "ルビあり",
  honorific: "敬称つき",
  katakana: "片仮名語",
};

export type TermCandidate = {
  surface: string;
  reading: string;
  kind: ProofreadTermKind;
  /** 本文に出てくる回数。 */
  count: number;
  source: TermCandidateSource;
};

/** 手がかりの確かさ。同じ語が複数の手がかりで拾えたら、強い方を採る。 */
const SOURCE_RANK: Record<TermCandidateSource, number> = {
  ruby: 0,
  honorific: 1,
  katakana: 2,
};

/** 敬称の直前は人物名である可能性が高い。 */
const HONORIFIC_PATTERN = /([一-龥々ァ-ヴー]{2,8})(さん|様|君|ちゃん|氏|先生)/g;
/** 片仮名の連なり。作品固有の名前や用語が多い。 */
const KATAKANA_PATTERN = /[ァ-ヴ][ァ-ヴー]{2,}/g;
/** 片仮名語は繰り返し出てくるものだけを候補にする。 */
const KATAKANA_MIN_COUNT = 2;

const FENCE_LINE = /^\s{0,3}(?:```|~~~)/;

/** ルビの読みとコードブロックを外した本文。候補を数える対象。 */
function stripNonBody(text: string): string {
  const lines = text.split("\n");
  let insideFence = false;
  const kept = lines.map((line) => {
    if (FENCE_LINE.test(line)) {
      insideFence = !insideFence;
      return "";
    }
    return insideFence ? "" : line;
  });
  // 読みそのものは本文ではないので、片仮名語として数えない。
  return kept.join("\n").replace(/《[^》\n]*》/g, "");
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * 候補を集める。すでに辞書にある語（別表記として登録したものを含む）は出さない。
 */
export function collectTermCandidates(
  text: string,
  existing: ProofreadTerm[],
  limit = 60,
): TermCandidate[] {
  if (!text.trim()) return [];

  const body = stripNonBody(text);
  const known = new Set<string>();
  for (const term of existing) {
    known.add(term.surface);
    for (const variant of term.variants) known.add(variant);
  }

  const found = new Map<string, TermCandidate>();
  const remember = (candidate: TermCandidate) => {
    if (!isUsableTermSurface(candidate.surface) || known.has(candidate.surface)) return;
    const current = found.get(candidate.surface);
    if (current && SOURCE_RANK[current.source] <= SOURCE_RANK[candidate.source]) {
      // 強い手がかりを残しつつ、読みが後から分かればそれは受け取る。
      if (!current.reading && candidate.reading) current.reading = candidate.reading;
      return;
    }
    found.set(candidate.surface, candidate);
  };

  for (const ruby of collectRubyAnnotations(text)) {
    remember({
      surface: ruby.base,
      reading: ruby.reading,
      kind: "other",
      count: countOccurrences(body, ruby.base),
      source: "ruby",
    });
  }

  for (const match of body.matchAll(HONORIFIC_PATTERN)) {
    remember({
      surface: match[1],
      reading: "",
      kind: "person",
      count: countOccurrences(body, match[1]),
      source: "honorific",
    });
  }

  for (const match of body.matchAll(KATAKANA_PATTERN)) {
    const surface = match[0];
    const count = countOccurrences(body, surface);
    if (count < KATAKANA_MIN_COUNT) continue;
    remember({ surface, reading: "", kind: "other", count, source: "katakana" });
  }

  return [...found.values()]
    .sort(
      (left, right) =>
        SOURCE_RANK[left.source] - SOURCE_RANK[right.source] ||
        right.count - left.count ||
        left.surface.localeCompare(right.surface, "ja"),
    )
    .slice(0, limit);
}
