import type {
  DocumentAst,
  ProjectAst,
  ProjectAstFile,
  ProjectAstStatus,
} from "./types";

function countOutlineItems(items: DocumentAst["outline"]): number {
  let count = 0;
  const visit = (current: DocumentAst["outline"]) => {
    for (const item of current) {
      count += 1;
      visit(item.children);
    }
  };
  visit(items);
  return count;
}

function statusContribution(status: ProjectAstFile["status"]): {
  indexed: number;
  pending: number;
  error: number;
} {
  return {
    indexed: status === "indexed" ? 1 : 0,
    pending: status === "pending" ? 1 : 0,
    error: status === "error" ? 1 : 0,
  };
}

function projectStatus(
  fileCount: number,
  pendingCount: number,
  errorCount: number,
): ProjectAstStatus {
  if (fileCount === 0) return "empty";
  if (pendingCount > 0) return "indexing";
  if (errorCount > 0) return "partial";
  return "ready";
}

export function createIndexedProjectAstFile(documentAst: DocumentAst): ProjectAstFile {
  if (!documentAst.path) {
    throw new Error("project document AST requires a file path");
  }
  return {
    path: documentAst.path,
    name: documentAst.name,
    status: "indexed",
    documentAst,
    textHash: documentAst.textHash,
    semanticHash: documentAst.semanticHash,
    lineCount: documentAst.lineCount,
    textLength: documentAst.textLength,
    visibleTextLength: documentAst.visibleTextLength,
    outlineCount: countOutlineItems(documentAst.outline),
    indexedAt: documentAst.indexedAt,
    error: null,
  };
}

/**
 * Replaces several files while updating project totals by delta. Unlike a full
 * recomputation, this walks the project file array once regardless of the
 * number of aggregate fields.
 */
export function replaceProjectAstFiles(
  projectAst: ProjectAst,
  replacements: readonly ProjectAstFile[],
): ProjectAst {
  if (replacements.length === 0) return projectAst;

  const files = projectAst.files.slice();
  const indexByPath = new Map(files.map((file, index) => [file.path, index] as const));
  let indexedCount = projectAst.indexedCount;
  let pendingCount = projectAst.pendingCount;
  let errorCount = projectAst.errorCount;
  let totalTextLength = projectAst.totalTextLength;
  let totalLineCount = projectAst.totalLineCount;
  let totalOutlineCount = projectAst.totalOutlineCount;

  for (const replacement of replacements) {
    const index = indexByPath.get(replacement.path);
    const previous = index === undefined ? null : files[index];
    if (previous === replacement) continue;

    if (previous) {
      const contribution = statusContribution(previous.status);
      indexedCount -= contribution.indexed;
      pendingCount -= contribution.pending;
      errorCount -= contribution.error;
      totalTextLength -= previous.textLength;
      totalLineCount -= previous.lineCount;
      totalOutlineCount -= previous.outlineCount;
    }

    const contribution = statusContribution(replacement.status);
    indexedCount += contribution.indexed;
    pendingCount += contribution.pending;
    errorCount += contribution.error;
    totalTextLength += replacement.textLength;
    totalLineCount += replacement.lineCount;
    totalOutlineCount += replacement.outlineCount;

    if (index === undefined) {
      indexByPath.set(replacement.path, files.length);
      files.push(replacement);
    } else {
      files[index] = replacement;
    }
  }

  return {
    ...projectAst,
    files,
    status: projectStatus(files.length, pendingCount, errorCount),
    indexedCount,
    pendingCount,
    errorCount,
    totalTextLength,
    totalLineCount,
    totalOutlineCount,
    updatedAt: Date.now(),
  };
}

export function replaceProjectAstFile(
  projectAst: ProjectAst,
  replacement: ProjectAstFile,
): ProjectAst {
  return replaceProjectAstFiles(projectAst, [replacement]);
}

export function rebuildProjectAstMetrics(projectAst: ProjectAst): ProjectAst {
  let indexedCount = 0;
  let pendingCount = 0;
  let errorCount = 0;
  let totalTextLength = 0;
  let totalLineCount = 0;
  let totalOutlineCount = 0;

  for (const file of projectAst.files) {
    const contribution = statusContribution(file.status);
    indexedCount += contribution.indexed;
    pendingCount += contribution.pending;
    errorCount += contribution.error;
    totalTextLength += file.textLength;
    totalLineCount += file.lineCount;
    totalOutlineCount += file.outlineCount;
  }

  return {
    ...projectAst,
    status: projectStatus(projectAst.files.length, pendingCount, errorCount),
    indexedCount,
    pendingCount,
    errorCount,
    totalTextLength,
    totalLineCount,
    totalOutlineCount,
    updatedAt: Date.now(),
  };
}
