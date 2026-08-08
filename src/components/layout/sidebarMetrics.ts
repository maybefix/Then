import type {
  DocumentOutlineItem,
  ProjectAst,
  ProjectAstFile,
} from "../../editor/ast/types";
import type { OutlineItem, ProjectEntry, ProjectFolder } from "../../types";

export type SidebarMetrics = {
  projectAstFiles: ReadonlyMap<string, ProjectAstFile>;
  folderCharCounts: ReadonlyMap<string, number | null>;
  headingCharCounts: ReadonlyMap<string, ReadonlyMap<string, number>>;
  projectTotalCharCount: number | null;
};

type HeadingCountCacheEntry = {
  withWhitespace?: ReadonlyMap<string, number>;
  withoutWhitespace?: ReadonlyMap<string, number>;
};

const headingCountCache = new WeakMap<object, HeadingCountCacheEntry>();

function countCharacters(value: string, includeWhitespace: boolean): number {
  const target = includeWhitespace ? value : value.replace(/[\s　]/g, "");
  return Array.from(target).length;
}

function flattenOutline(items: DocumentOutlineItem[]): DocumentOutlineItem[] {
  const result: DocumentOutlineItem[] = [];
  const visit = (current: DocumentOutlineItem[]) => {
    for (const item of current) {
      result.push(item);
      visit(item.children);
    }
  };
  visit(items);
  return result;
}

function buildHeadingCounts(
  documentAst: NonNullable<ProjectAstFile["documentAst"]>,
  includeWhitespace: boolean,
): ReadonlyMap<string, number> {
  const blocks = documentAst.blocks;
  const headings = flattenOutline(documentAst.outline);
  const prefix = new Array<number>(blocks.length + 1).fill(0);

  for (let index = 0; index < blocks.length; index += 1) {
    const newlineCount = includeWhitespace && index < blocks.length - 1 ? 1 : 0;
    prefix[index + 1] =
      prefix[index] + countCharacters(blocks[index].source, includeWhitespace) + newlineCount;
  }

  const counts = new Map<string, number>();
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const start = Math.max(0, Math.min(blocks.length, heading.line - 1));
    const nextHeading = headings[index + 1];
    const end = nextHeading
      ? Math.max(start, Math.min(blocks.length, nextHeading.line - 1))
      : blocks.length;
    const count = prefix[end] - prefix[start];
    counts.set(heading.blockId, count);
    counts.set(heading.id, count);
  }
  return counts;
}

function getCachedHeadingCounts(
  documentAst: NonNullable<ProjectAstFile["documentAst"]>,
  includeWhitespace: boolean,
): ReadonlyMap<string, number> {
  const cacheKey = includeWhitespace ? "withWhitespace" : "withoutWhitespace";
  const cached = headingCountCache.get(documentAst);
  const counts = cached?.[cacheKey];
  if (counts) return counts;

  const nextCounts = buildHeadingCounts(documentAst, includeWhitespace);
  headingCountCache.set(documentAst, { ...cached, [cacheKey]: nextCounts });
  return nextCounts;
}

type FolderCount = {
  descendantFileCount: number;
  indexedFileCount: number;
  total: number;
};

export function buildSidebarMetrics(
  projectFolder: ProjectFolder | null,
  projectAst: ProjectAst | null,
  includeWhitespace: boolean,
): SidebarMetrics {
  const projectAstFiles = new Map(
    projectAst?.files.map((file) => [file.path, file] as const) ?? [],
  );
  const headingCharCounts = new Map<string, ReadonlyMap<string, number>>();
  for (const file of projectAst?.files ?? []) {
    if (file.status === "indexed" && file.documentAst) {
      headingCharCounts.set(
        file.path,
        getCachedHeadingCounts(file.documentAst, includeWhitespace),
      );
    }
  }

  const folderCharCounts = new Map<string, number | null>();
  const visitFolder = (path: string, children: ProjectEntry[]): FolderCount => {
    const result: FolderCount = { descendantFileCount: 0, indexedFileCount: 0, total: 0 };
    for (const entry of children) {
      if (entry.kind === "folder") {
        const nested = visitFolder(entry.path, entry.children);
        result.descendantFileCount += nested.descendantFileCount;
        result.indexedFileCount += nested.indexedFileCount;
        result.total += nested.total;
        continue;
      }
      result.descendantFileCount += 1;
      const astFile = projectAstFiles.get(entry.path);
      if (astFile?.status !== "indexed") continue;
      result.indexedFileCount += 1;
      result.total += includeWhitespace ? astFile.textLength : astFile.visibleTextLength;
    }
    folderCharCounts.set(
      path,
      result.descendantFileCount > 0 && result.indexedFileCount === 0 ? null : result.total,
    );
    return result;
  };

  if (projectFolder) visitFolder(projectFolder.path, projectFolder.children);

  return {
    projectAstFiles,
    folderCharCounts,
    headingCharCounts,
    projectTotalCharCount: projectAst
      ? projectAst.files.reduce(
          (sum, file) =>
            sum + (includeWhitespace ? file.textLength : file.visibleTextLength),
          0,
        )
      : null,
  };
}

export function getSidebarFolderCharCount(
  metrics: SidebarMetrics,
  path: string,
): number | null {
  return metrics.folderCharCounts.get(path) ?? null;
}

export function getSidebarHeadingCharCount(
  metrics: SidebarMetrics,
  filePath: string,
  item: DocumentOutlineItem | OutlineItem,
): number | null {
  const counts = metrics.headingCharCounts.get(filePath);
  if (!counts) return null;
  return counts.get(item.blockId) ?? counts.get(item.id) ?? null;
}
