export type ComparisonFile = { path: string; name: string; text: string };
export type ComparisonEntry = {
  key: string;
  path: string;
  name: string;
  left: ComparisonFile | null;
  right: ComparisonFile | null;
  match: "path" | "relocated" | "left-only" | "right-only";
};

const pathKey = (path: string) => path.replace(/[\\/]+/g, "\\").toLocaleLowerCase();
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const fileStem = (path: string) => fileName(path).replace(/\.[^.]+$/, "").toLocaleLowerCase();
const normalizedText = (text: string) => text.replace(/\r\n?/g, "\n").replace(/[\s　]+/g, " ").trim();

type Profile = { file: ComparisonFile; text: string; grams: Map<string, number>; stem: string };

function grams(text: string, size: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (let index = 0; index <= text.length - size; index += 1) {
    const gram = text.slice(index, index + size);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

function dice(left: Map<string, number>, right: Map<string, number>, leftLength: number, rightLength: number, size: number): number {
  if (leftLength < size || rightLength < size) return 0;
  let overlap = 0;
  for (const [gram, count] of left) overlap += Math.min(count, right.get(gram) ?? 0);
  return (2 * overlap) / (leftLength + rightLength - 2 * size + 2);
}

function profile(file: ComparisonFile): Profile {
  const text = normalizedText(file.text);
  return { file, text, grams: grams(text, 3), stem: fileStem(file.path) };
}

function isCandidateGram(gram: string): boolean {
  let hash = 0;
  for (let index = 0; index < gram.length; index += 1) hash = (hash * 31 + gram.charCodeAt(index)) | 0;
  return (hash & 7) === 0;
}

function candidateScore(left: Profile, right: Profile): number | null {
  const lengthRatio = Math.min(left.text.length, right.text.length) / Math.max(left.text.length, right.text.length);
  if (lengthRatio < 0.8) return null;
  const contentSimilarity = dice(left.grams, right.grams, left.text.length, right.text.length, 3);
  if (contentSimilarity < 0.9) return null;
  const nameSimilarity = left.stem === right.stem ? 1 : dice(grams(left.stem, 2), grams(right.stem, 2), left.stem.length, right.stem.length, 2);
  if (nameSimilarity < 0.55 && contentSimilarity < 0.97) return null;
  return contentSimilarity * 0.82 + nameSimilarity * 0.12 + lengthRatio * 0.06;
}

/** A relocation can delete its current path during restore, so uncertain pairs stay unmatched. */
export function buildComparisonEntries(leftFiles: ComparisonFile[], rightFiles: ComparisonFile[], detectRelocations = true): ComparisonEntry[] {
  const rightByPath = new Map(rightFiles.map((file) => [pathKey(file.path), file] as const));
  const exactRightPaths = new Set<string>();
  const unmatchedLeft: ComparisonFile[] = [];
  for (const left of leftFiles) {
    const key = pathKey(left.path);
    if (rightByPath.has(key)) exactRightPaths.add(key);
    else unmatchedLeft.push(left);
  }
  const unmatchedRight = rightFiles.filter((file) => !exactRightPaths.has(pathKey(file.path)));
  const relocationByLeft = new Map<string, ComparisonFile>();
  const relocatedRightPaths = new Set<string>();

  if (detectRelocations) {
    const leftProfiles = unmatchedLeft.map(profile);
    const rightProfiles = unmatchedRight.map(profile);
    const leftByText = new Map<string, Profile[]>();
    const rightByText = new Map<string, Profile[]>();
    for (const item of leftProfiles) {
      const matches = leftByText.get(item.text);
      if (matches) matches.push(item);
      else leftByText.set(item.text, [item]);
    }
    for (const item of rightProfiles) {
      const matches = rightByText.get(item.text);
      if (matches) matches.push(item);
      else rightByText.set(item.text, [item]);
    }
    for (const [text, leftMatches] of leftByText) {
      const rightMatches = rightByText.get(text) ?? [];
      if (text.length < 16 || leftMatches.length !== 1 || rightMatches.length !== 1) continue;
      const left = leftMatches[0].file;
      const right = rightMatches[0].file;
      relocationByLeft.set(pathKey(left.path), right);
      relocatedRightPaths.add(pathKey(right.path));
    }

    const remainingRight = rightProfiles.filter((item) => !relocatedRightPaths.has(pathKey(item.file.path)));
    const documentFrequency = new Map<string, number>();
    for (const item of remainingRight) for (const gram of item.grams.keys()) {
      if (!isCandidateGram(gram)) continue;
      documentFrequency.set(gram, (documentFrequency.get(gram) ?? 0) + 1);
    }
    const rareGramIndex = new Map<string, Profile[]>();
    for (const item of remainingRight) for (const gram of item.grams.keys()) {
      if (!isCandidateGram(gram)) continue;
      if ((documentFrequency.get(gram) ?? 0) > 8) continue;
      const matches = rareGramIndex.get(gram) ?? [];
      matches.push(item);
      rareGramIndex.set(gram, matches);
    }

    type Candidate = { left: Profile; right: Profile; score: number };
    const candidates: Candidate[] = [];
    for (const left of leftProfiles) {
      if (relocationByLeft.has(pathKey(left.file.path)) || left.text.length < 24) continue;
      const sharedRareGrams = new Map<Profile, number>();
      for (const gram of left.grams.keys()) for (const right of rareGramIndex.get(gram) ?? []) {
        sharedRareGrams.set(right, (sharedRareGrams.get(right) ?? 0) + 1);
      }
      const plausible = [...sharedRareGrams].filter(([, count]) => count >= 6);
      // A large group of similar files is ambiguous; do not guess a destructive relocation.
      if (plausible.length > 8) continue;
      for (const [right] of plausible) {
        if (right.text.length < 24 || left.text === right.text) continue;
        const score = candidateScore(left, right);
        if (score !== null) candidates.push({ left, right, score });
      }
    }
    const byLeft = new Map<Profile, Candidate[]>();
    const byRight = new Map<Profile, Candidate[]>();
    for (const candidate of candidates) {
      byLeft.set(candidate.left, [...(byLeft.get(candidate.left) ?? []), candidate]);
      byRight.set(candidate.right, [...(byRight.get(candidate.right) ?? []), candidate]);
    }
    for (const matches of byLeft.values()) matches.sort((a, b) => b.score - a.score);
    for (const matches of byRight.values()) matches.sort((a, b) => b.score - a.score);
    for (const [left, matches] of byLeft) {
      const best = matches[0];
      const rightMatches = byRight.get(best.right) ?? [];
      if (rightMatches[0] !== best) continue;
      if (matches[1] && best.score - matches[1].score < 0.04) continue;
      if (rightMatches[1] && best.score - rightMatches[1].score < 0.04) continue;
      relocationByLeft.set(pathKey(left.file.path), best.right.file);
      relocatedRightPaths.add(pathKey(best.right.file.path));
    }
  }

  const entries: ComparisonEntry[] = leftFiles.map((left) => {
    const leftKey = pathKey(left.path);
    const exact = rightByPath.get(leftKey) ?? null;
    if (exact) return { key: `path:${leftKey}`, path: left.path, name: left.name, left, right: exact, match: "path" };
    const relocated = relocationByLeft.get(leftKey) ?? null;
    if (relocated) return { key: `relocated:${leftKey}:${pathKey(relocated.path)}`, path: left.path, name: left.name, left, right: relocated, match: "relocated" };
    return { key: `left:${leftKey}`, path: left.path, name: left.name, left, right: null, match: "left-only" };
  });
  for (const right of unmatchedRight) {
    const rightKey = pathKey(right.path);
    if (!relocatedRightPaths.has(rightKey)) entries.push({ key: `right:${rightKey}`, path: right.path, name: right.name, left: null, right, match: "right-only" });
  }
  return entries;
}
