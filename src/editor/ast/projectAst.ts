import type {
  ProjectEntry,
  ProjectFolder,
  TextDocument,
} from "../../types";
import {
  createDocumentAst,
  findActiveOutlineChain,
  hash16,
  normalizeText,
} from "./documentAst";
import type {
  DocumentAst,
  ProjectAst,
  ProjectAstFile,
  ProjectAstStatus,
  ProjectSearchMode,
  ProjectSearchResult,
} from "./types";

type ProjectAstDocumentInput = Pick<TextDocument, "path" | "name"> & {
  text: string;
  indexedAt?: number;
};

type ProjectAstFileRef = {
  path: string;
  name: string;
};

const DEFAULT_MAX_PROJECT_SEARCH_RESULTS = 80;

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

  return {
    path: input.path,
    name: input.name,
    status: "indexed",
    documentAst,
    textHash: documentAst.textHash,
    semanticHash: documentAst.semanticHash,
    lineCount: documentAst.lineCount,
    textLength: documentAst.textLength,
    outlineCount: flattenDocumentOutline(documentAst).length,
    indexedAt: documentAst.indexedAt,
    error: null,
  };
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

function getProjectAstStatus(files: ProjectAstFile[]): ProjectAstStatus {
  if (files.length === 0) return "empty";
  if (files.some((file) => file.status === "pending")) return "indexing";
  if (files.some((file) => file.status === "error")) return "partial";
  return "ready";
}

function recomputeProjectAst(projectAst: ProjectAst): ProjectAst {
  const files = projectAst.files;
  return {
    ...projectAst,
    status: getProjectAstStatus(files),
    indexedCount: files.filter((file) => file.status === "indexed").length,
    pendingCount: files.filter((file) => file.status === "pending").length,
    errorCount: files.filter((file) => file.status === "error").length,
    totalTextLength: files.reduce((sum, file) => sum + file.textLength, 0),
    totalLineCount: files.reduce((sum, file) => sum + file.lineCount, 0),
    totalOutlineCount: files.reduce((sum, file) => sum + file.outlineCount, 0),
    updatedAt: Date.now(),
  };
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

  return recomputeProjectAst({
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
  const index = projectAst.files.findIndex((file) => file.path === input.path);
  const files =
    index >= 0
      ? projectAst.files.map((file, fileIndex) => (fileIndex === index ? nextFile : file))
      : [...projectAst.files, nextFile];

  return recomputeProjectAst({
    ...projectAst,
    files,
  });
}

export function markProjectAstFileError(
  projectAst: ProjectAst,
  path: string,
  error: unknown,
): ProjectAst {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const files = projectAst.files.map((file) =>
    file.path === path
      ? {
          ...file,
          status: "error" as const,
          error: errorMessage,
          indexedAt: Date.now(),
        }
      : file,
  );

  return recomputeProjectAst({
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
