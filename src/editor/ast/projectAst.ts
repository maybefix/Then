import type {
  ProjectEntry,
  ProjectFolder,
  TextDocument,
} from "../../types";
import { isPathSameOrInside } from "../../utils/projectTree";
import {
  createDocumentAst,
  findActiveOutlineChain,
  hash16,
  normalizeText,
} from "./documentAst";
import {
  createIndexedProjectAstFile,
  rebuildProjectAstMetrics,
  replaceProjectAstFile,
  replaceProjectAstFiles,
} from "./projectAstMetrics";
import type {
  DocumentAst,
  ProjectAst,
  ProjectAstFile,
  ProjectSearchMode,
  ProjectSearchOutcome,
  ProjectSearchResult,
} from "./types";
import {
  findTextSearchMatches,
  type TextSearchOptions,
} from "../../search/textSearch";

type ProjectAstDocumentInput = Pick<TextDocument, "path" | "name"> & {
  text: string;
  indexedAt?: number;
};

type ProjectAstFileRef = {
  path: string;
  name: string;
};

const DEFAULT_MAX_PROJECT_SEARCH_RESULTS = 80;

const EMPTY_SEARCH_OUTCOME: ProjectSearchOutcome = {
  results: [],
  total: 0,
  matchedFileCount: 0,
  truncated: false,
  error: null,
};

export function collectProjectTextFiles(folder: ProjectFolder | null): ProjectAstFileRef[] {
  if (!folder) return [];

  const files: ProjectAstFileRef[] = [];

  const walk = (entries: ProjectEntry[]) => {
    for (const entry of entries) {
      if (entry.kind === "file") {
        files.push({ path: entry.path, name: entry.name });
      } else {
        walk(entry.children);
      }
    }
  };

  walk(folder.children);
  return files;
}

function createPendingProjectAstFile(file: ProjectAstFileRef): ProjectAstFile {
  return {
    path: file.path,
    name: file.name,
    status: "pending",
    documentAst: null,
    textHash: null,
    semanticHash: null,
    lineCount: 0,
    textLength: 0,
    visibleTextLength: 0,
    outlineCount: 0,
    indexedAt: null,
    error: null,
  };
}

function createProjectAstFileFromDocument(input: ProjectAstDocumentInput): ProjectAstFile {
  const documentAst = createDocumentAst({
    path: input.path,
    name: input.name,
    text: input.text,
    indexedAt: input.indexedAt,
  });
  return createIndexedProjectAstFile(documentAst);
}

function flattenDocumentOutline(documentAst: DocumentAst): DocumentAst["outline"] {
  const out: DocumentAst["outline"] = [];

  const visit = (items: DocumentAst["outline"]) => {
    for (const item of items) {
      out.push(item);
      visit(item.children);
    }
  };

  visit(documentAst.outline);
  return out;
}

export function createProjectAstSkeleton(
  folder: ProjectFolder,
  previous: ProjectAst | null = null,
): ProjectAst {
  const previousByPath = new Map(
    previous?.rootPath === folder.path
      ? previous.files.map((file) => [file.path, file] as const)
      : [],
  );
  const files = collectProjectTextFiles(folder).map((file) => {
    const previousFile = previousByPath.get(file.path);
    if (!previousFile) return createPendingProjectAstFile(file);
    return {
      ...previousFile,
      name: file.name,
    };
  });

  return rebuildProjectAstMetrics({
    kind: "project",
    rootPath: folder.path,
    name: folder.name,
    status: "idle",
    files,
    indexedCount: 0,
    pendingCount: 0,
    errorCount: 0,
    totalTextLength: 0,
    totalLineCount: 0,
    totalOutlineCount: 0,
    updatedAt: Date.now(),
  });
}

export function upsertProjectAstDocument(
  projectAst: ProjectAst,
  input: ProjectAstDocumentInput,
): ProjectAst {
  const nextFile = createProjectAstFileFromDocument(input);
  return replaceProjectAstFile(projectAst, nextFile);
}

/** Reuses an AST already built for the active editor instead of parsing its text again. */
export function upsertProjectAstDocumentAst(
  projectAst: ProjectAst,
  documentAst: DocumentAst,
): ProjectAst {
  if (!documentAst.path) return projectAst;
  return replaceProjectAstFile(projectAst, createIndexedProjectAstFile(documentAst));
}

/** Applies an indexing batch with one project-array copy and one React state update. */
export function upsertProjectAstDocumentAsts(
  projectAst: ProjectAst,
  documentAsts: readonly DocumentAst[],
): ProjectAst {
  const files = documentAsts
    .filter((documentAst): documentAst is DocumentAst & { path: string } => Boolean(documentAst.path))
    .map(createIndexedProjectAstFile);
  // File reads finish asynchronously. Do not let an AST captured earlier in
  // the initial-index batch overwrite a document updated by the editor while
  // those reads were in flight.
  return replaceProjectAstFiles(projectAst, files, { preserveNewerIndexed: true });
}

export function markProjectAstFileError(
  projectAst: ProjectAst,
  path: string,
  error: unknown,
): ProjectAst {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const current = projectAst.files.find((file) => file.path === path);
  if (!current) return projectAst;
  return replaceProjectAstFile(projectAst, {
    ...current,
    status: "error",
    error: errorMessage,
    indexedAt: Date.now(),
  });
}

export function removeProjectAstPaths(
  projectAst: ProjectAst,
  deletedPaths: string[],
): ProjectAst {
  if (deletedPaths.length === 0) return projectAst;
  const files = projectAst.files.filter(
    (file) => !deletedPaths.some((deletedPath) => isPathSameOrInside(file.path, deletedPath)),
  );

  return rebuildProjectAstMetrics({
    ...projectAst,
    files,
  });
}

export function getProjectAstFile(projectAst: ProjectAst | null, path: string | null): ProjectAstFile | null {
  if (!projectAst || !path) return null;
  return projectAst.files.find((file) => file.path === path) ?? null;
}

function normalizeSearchText(text: string): string {
  return normalizeText(text).toLocaleLowerCase();
}

function createExcerpt(text: string, index: number, length: number): string {
  const maxLength = 84;
  const prefix = Math.max(0, index - 28);
  const suffix = Math.min(text.length, index + length + 44);
  const head = prefix > 0 ? "..." : "";
  const tail = suffix < text.length ? "..." : "";
  const excerpt = `${head}${text.slice(prefix, suffix).trim()}${tail}`;
  return excerpt.length > maxLength ? `${excerpt.slice(0, maxLength - 3)}...` : excerpt;
}

function createExcerptParts(text: string, index: number, length: number) {
  const prefix = Math.max(0, index - 36);
  const suffix = Math.min(text.length, index + length + 54);
  const normalizeLineBreaks = (value: string) => value.replace(/\n/g, " ↵ ");
  return {
    before: `${prefix > 0 ? "…" : ""}${normalizeLineBreaks(text.slice(prefix, index))}`,
    match: normalizeLineBreaks(text.slice(index, index + length)),
    after: `${normalizeLineBreaks(text.slice(index + length, suffix))}${suffix < text.length ? "…" : ""}`,
  };
}

function documentAstText(documentAst: DocumentAst): string {
  return documentAst.blocks.map((block) => block.source).join("\n");
}

function findBlockAtOffset(documentAst: DocumentAst, offset: number) {
  let active = documentAst.blocks[0] ?? null;
  for (const block of documentAst.blocks) {
    if (block.from > offset) break;
    active = block;
  }
  return active;
}

export function searchDocumentAstFullText(
  documentAst: DocumentAst,
  path: string,
  name: string,
  rawQuery: string,
  options: TextSearchOptions,
  maxResults = DEFAULT_MAX_PROJECT_SEARCH_RESULTS,
): ProjectSearchOutcome {
  if (rawQuery.length === 0) return EMPTY_SEARCH_OUTCOME;

  const text = documentAstText(documentAst);
  const found = findTextSearchMatches(text, rawQuery, options, maxResults);
  if (found.error) return { ...EMPTY_SEARCH_OUTCOME, error: found.error };

  const results = found.matches.map((match, matchIndex) => {
    const block = findBlockAtOffset(documentAst, match.index);
    const line = (block?.lineIndex ?? 0) + 1;
    const column = match.index - (block?.from ?? 0) + 1;
    const headingChain = findActiveOutlineChain(documentAst.outline, line);
    const excerpt = createExcerptParts(text, match.index, match.length);
    return {
      id: resultId(path, "fullText", line, column, rawQuery, matchIndex),
      kind: "fullText" as const,
      path,
      name,
      line,
      column,
      title: headingChain[headingChain.length - 1]?.title ?? null,
      excerpt: `${excerpt.before}${excerpt.match}${excerpt.after}`,
      excerptBefore: excerpt.before,
      excerptMatch: excerpt.match,
      excerptAfter: excerpt.after,
      headingChain,
      matchStart: match.index - (block?.from ?? 0),
      matchLength: match.length,
      absoluteFrom: match.index,
      absoluteTo: match.index + match.length,
      fileMatchCount: found.total,
      score: column === 1 ? 70 : 50,
    };
  });

  return {
    results,
    total: found.total,
    matchedFileCount: found.total > 0 ? 1 : 0,
    truncated: found.truncated,
    error: null,
  };
}

export function searchProjectAstFullTextWithOptions(
  projectAst: ProjectAst | null,
  rawQuery: string,
  options: TextSearchOptions,
  maxResults = DEFAULT_MAX_PROJECT_SEARCH_RESULTS,
): ProjectSearchOutcome {
  if (!projectAst || rawQuery.length === 0) return EMPTY_SEARCH_OUTCOME;

  const results: ProjectSearchResult[] = [];
  let total = 0;
  let matchedFileCount = 0;

  for (const file of projectAst.files) {
    if (!file.documentAst) continue;
    const outcome = searchDocumentAstFullText(
      file.documentAst,
      file.path,
      file.name,
      rawQuery,
      options,
      Math.max(0, maxResults - results.length),
    );
    if (outcome.error) return { ...EMPTY_SEARCH_OUTCOME, error: outcome.error };
    total += outcome.total;
    matchedFileCount += outcome.matchedFileCount;
    results.push(...outcome.results);
  }

  results.sort((left, right) => {
    const nameCompare = left.name.localeCompare(right.name, "ja");
    if (nameCompare !== 0) return nameCompare;
    if (left.line !== right.line) return left.line - right.line;
    return left.column - right.column;
  });

  return {
    results: results.slice(0, maxResults),
    total,
    matchedFileCount,
    truncated: total > maxResults,
    error: null,
  };
}

function resultId(
  path: string,
  kind: ProjectSearchResult["kind"],
  line: number,
  column: number,
  query: string,
  matchIndex = 0,
): string {
  return hash16(`${path}|${kind}|${line}|${column}|${query}|${matchIndex}`);
}

function collectLineMatches(text: string, query: string): number[] {
  const matches: number[] = [];
  if (!query) return matches;

  const normalized = normalizeSearchText(text);
  let from = 0;
  while (from <= normalized.length) {
    const index = normalized.indexOf(query, from);
    if (index < 0) break;
    matches.push(index);
    from = index + Math.max(1, query.length);
  }
  return matches;
}

function searchProjectAstFullText(
  projectAst: ProjectAst,
  rawQuery: string,
  query: string,
  maxResults: number,
): ProjectSearchResult[] {
  const results: ProjectSearchResult[] = [];
  const rawQueryLength = rawQuery.trim().length;

  for (const file of projectAst.files) {
    const documentAst = file.documentAst;
    if (!documentAst) continue;

    for (const block of documentAst.blocks) {
      const matches = collectLineMatches(block.source, query);
      if (!matches.length) continue;

      const line = block.lineIndex + 1;
      const headingChain = findActiveOutlineChain(documentAst.outline, line);
      matches.forEach((index, matchIndex) => {
        results.push({
          id: resultId(file.path, "fullText", line, index + 1, query, matchIndex),
          kind: "fullText",
          path: file.path,
          name: file.name,
          line,
          column: index + 1,
          title: headingChain[headingChain.length - 1]?.title ?? null,
          excerpt: createExcerpt(block.source, index, rawQueryLength),
          headingChain,
          matchStart: index,
          matchLength: rawQueryLength,
          score: index === 0 ? 70 : 50,
        });
      });
    }
  }

  return results
    .sort((left, right) => {
      const nameCompare = left.name.localeCompare(right.name, "ja");
      if (nameCompare !== 0) return nameCompare;
      if (left.line !== right.line) return left.line - right.line;
      return left.column - right.column;
    })
    .slice(0, maxResults);
}

export function searchProjectAst(
  projectAst: ProjectAst | null,
  rawQuery: string,
  mode: ProjectSearchMode = "structured",
  maxResults = DEFAULT_MAX_PROJECT_SEARCH_RESULTS,
): ProjectSearchResult[] {
  const query = normalizeSearchText(rawQuery.trim());
  if (!projectAst || !query) return [];
  if (mode === "fullText") {
    return searchProjectAstFullText(projectAst, rawQuery, query, maxResults);
  }

  const results: ProjectSearchResult[] = [];

  for (const file of projectAst.files) {
    const documentAst = file.documentAst;
    if (!documentAst) continue;

    const flatOutline = flattenDocumentOutline(documentAst);
    for (const outlineItem of flatOutline) {
      const title = normalizeSearchText(outlineItem.title);
      const index = title.indexOf(query);
      if (index < 0) continue;

      results.push({
        id: resultId(file.path, "heading", outlineItem.line, index + 1, query),
        kind: "heading",
        path: file.path,
        name: file.name,
        line: outlineItem.line,
        column: index + 1,
        title: outlineItem.title,
        excerpt: outlineItem.title,
        headingChain: findActiveOutlineChain(documentAst.outline, outlineItem.line),
        matchStart: index,
        matchLength: rawQuery.trim().length,
        score: index === 0 ? 120 - outlineItem.level : 100 - outlineItem.level,
      });
    }

    for (const block of documentAst.blocks) {
      if (block.kind === "heading") continue;
      const searchable = block.text.trim() ? block.text : block.source;
      const normalized = normalizeSearchText(searchable);
      const index = normalized.indexOf(query);
      if (index < 0) continue;

      const line = block.lineIndex + 1;
      const headingChain = findActiveOutlineChain(documentAst.outline, line);
      results.push({
        id: resultId(file.path, "body", line, index + 1, query),
        kind: "body",
        path: file.path,
        name: file.name,
        line,
        column: index + 1,
        title: headingChain[headingChain.length - 1]?.title ?? null,
        excerpt: createExcerpt(searchable, index, rawQuery.trim().length),
        headingChain,
        matchStart: index,
        matchLength: rawQuery.trim().length,
        score: index === 0 ? 60 : 40,
      });
    }
  }

  return results
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const nameCompare = left.name.localeCompare(right.name, "ja");
      if (nameCompare !== 0) return nameCompare;
      return left.line - right.line;
    })
    .slice(0, maxResults);
}
