import { invoke } from "@tauri-apps/api/core";
import { displayedCharacterCount, type CharacterCountOptions } from "../editor/ast/characterCount";
import { createDocumentAst } from "../editor/ast/documentAst";
import {
  collectProjectTextFiles,
  createProjectAstSkeleton,
  markProjectAstFileError,
  searchProjectAstFullTextWithOptions,
  upsertProjectAstDocumentAsts,
} from "../editor/ast/projectAst";
import type { DocumentAst, ProjectAst, ProjectSearchResult } from "../editor/ast/types";
import type { TextSearchOptions } from "../search/textSearch";
import type {
  FileProgressStatus,
  ProjectEntry,
  ProjectFolder,
  TextDocument,
  WorkMeta,
  WorkStats,
} from "../types";
import { parseFrontMatter } from "../utils/frontmatter";

/** The working folder of a scope other than the open one, indexed from disk. */
export type ScopeIndex = {
  folder: ProjectFolder;
  ast: ProjectAst;
};

export async function loadScopeIndex(path: string): Promise<ScopeIndex> {
  const folder = await invoke<ProjectFolder>("list_project_text_files", { folderPath: path });
  return indexFolder(folder);
}

export async function indexFolder(folder: ProjectFolder): Promise<ScopeIndex> {
  let ast = createProjectAstSkeleton(folder, null);
  const documents: DocumentAst[] = [];
  for (const file of collectProjectTextFiles(folder)) {
    try {
      const document = await invoke<TextDocument>("read_text_file", { path: file.path });
      documents.push(
        createDocumentAst({
          path: document.path,
          name: document.name,
          text: parseFrontMatter(document.content).body,
        }),
      );
    } catch (error) {
      ast = markProjectAstFileError(ast, file.path, error);
    }
  }
  return { folder, ast: upsertProjectAstDocumentAsts(ast, documents) };
}

export type LibraryProjectOverview = {
  path: string;
  name: string;
  work: WorkMeta | null;
  /** Project-relative path -> status; files not listed are todo. */
  fileProgress: Record<string, string>;
};

export function normalizeLibraryWorkStats(value: unknown): Record<string, WorkStats> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, WorkStats> = {};
  for (const [path, raw] of Object.entries(value as Record<string, Partial<WorkStats>>)) {
    if (!raw || typeof raw.signature !== "string" || typeof raw.charCount !== "number") continue;
    const progress = (raw.progress ?? {}) as Partial<Record<FileProgressStatus, number>>;
    result[path] = {
      signature: raw.signature,
      charCount: raw.charCount,
      fileCount: typeof raw.fileCount === "number" ? raw.fileCount : 0,
      progress: {
        todo: progress.todo ?? 0,
        writing: progress.writing ?? 0,
        revising: progress.revising ?? 0,
        done: progress.done ?? 0,
        archived: progress.archived ?? 0,
      },
      lastModified: typeof raw.lastModified === "number" ? raw.lastModified : null,
    };
  }
  return result;
}

function collectFiles(entries: ProjectEntry[], out: ProjectEntry[] = []): ProjectEntry[] {
  for (const entry of entries) {
    if (entry.kind === "file") out.push(entry);
    else collectFiles(entry.children, out);
  }
  return out;
}

const relativePath = (root: string, path: string) =>
  path.slice(root.replace(/[\\/]+$/, "").length).replace(/^[\\/]+/, "").replace(/\\/g, "/");

/** Cheap fingerprint of a scope's files from its listing (paths and content hashes). */
export function folderSignature(folder: ProjectFolder): string {
  return collectFiles(folder.children)
    .map((file) => `${relativePath(folder.path, file.path)}:${file.contentHash ?? file.modifiedAt ?? ""}`)
    .sort()
    .join("|");
}

export function computeWorkStats(
  index: ScopeIndex,
  fileProgress: Record<string, string>,
  countOptions: CharacterCountOptions,
): WorkStats {
  const files = collectFiles(index.folder.children);
  const progress: Record<FileProgressStatus, number> = {
    todo: 0,
    writing: 0,
    revising: 0,
    done: 0,
    archived: 0,
  };
  const progressByPath = new Map(
    Object.entries(fileProgress).map(([path, status]) => [path.toLocaleLowerCase(), status]),
  );
  for (const file of files) {
    const status = progressByPath.get(relativePath(index.folder.path, file.path).toLocaleLowerCase());
    const key =
      status === "writing" || status === "revising" || status === "done" || status === "archived"
        ? status
        : "todo";
    progress[key] += 1;
  }
  const modified = files.flatMap((file) => (typeof file.modifiedAt === "number" ? [file.modifiedAt] : []));
  return {
    signature: folderSignature(index.folder),
    charCount: index.ast.files.reduce(
      (sum, file) => sum + displayedCharacterCount(file, countOptions),
      0,
    ),
    fileCount: files.length,
    progress,
    lastModified: modified.length ? Math.max(...modified) : null,
  };
}

export type LibrarySearchOutcome = {
  results: ProjectSearchResult[];
  total: number;
  matchedFileCount: number;
  truncated: boolean;
  error: string | null;
};

/**
 * Searches every scope of a library. Each result's display name is prefixed
 * with its scope so that grouped results show where they come from.
 */
export function searchLibraryScopes(
  scopes: { label: string; ast: ProjectAst | null }[],
  query: string,
  options: TextSearchOptions,
): LibrarySearchOutcome {
  const outcome: LibrarySearchOutcome = {
    results: [],
    total: 0,
    matchedFileCount: 0,
    truncated: false,
    error: null,
  };
  for (const scope of scopes) {
    const scoped = searchProjectAstFullTextWithOptions(scope.ast, query, options);
    if (scoped.error) return { ...outcome, error: scoped.error };
    outcome.results.push(
      ...scoped.results.map((result) => ({ ...result, name: `${scope.label} › ${result.name}` })),
    );
    outcome.total += scoped.total;
    outcome.matchedFileCount += scoped.matchedFileCount;
    outcome.truncated ||= scoped.truncated;
  }
  return outcome;
}
