import { parseFrontMatter, updateMarkdownBody } from "../../utils/frontmatter";

export type HeadingDropPosition = "before" | "after" | "append";

export type HeadingMoveResult = {
  changed: boolean;
  movedTitle: string;
  sourceMarkdown: string;
  targetMarkdown: string;
};

export type HeadingMoveSource = {
  path: string;
  line: number;
};

export type HeadingMoveDocument = {
  path: string;
  markdown: string;
};

export type HeadingMoveManyResult = {
  changed: boolean;
  movedTitles: string[];
  documents: HeadingMoveDocument[];
};

export type HeadingExtractResult = {
  changed: boolean;
  extractedTitle: string;
  sourceMarkdown: string;
  extractedMarkdown: string;
  sourceCursorOffset: number;
};

type TextLines = {
  lines: string[];
  trailingNewline: boolean;
};

type HeadingSection = {
  start: number;
  end: number;
  level: number;
  title: string;
  lines: string[];
};

function splitLines(text: string): TextLines {
  const normalized = text.replace(/\r\n?/g, "\n");
  const trailingNewline = normalized.endsWith("\n");
  const content = trailingNewline ? normalized.slice(0, -1) : normalized;
  return {
    lines: content ? content.split("\n") : [],
    trailingNewline,
  };
}

function joinLines(value: TextLines): string {
  if (!value.lines.length) return "";
  return `${value.lines.join("\n")}${value.trailingNewline ? "\n" : ""}`;
}

function parseHeading(line: string): { level: number; title: string } | null {
  const match = line.match(/^(#{1,6})(?:\s+|$)/);
  if (!match) return null;
  return {
    level: match[1].length,
    title: line.slice(match[0].length).replace(/\s+#*\s*$/, "").trim(),
  };
}

function getHeadingSection(lines: string[], line: number, label: string): HeadingSection {
  const start = line - 1;
  const heading = Number.isInteger(line) && line > 0 ? parseHeading(lines[start] ?? "") : null;
  if (!heading) {
    throw new Error(`${label}の見出し位置が更新されています。アウトラインを確認して再操作してください。`);
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const nextHeading = parseHeading(lines[index]);
    if (nextHeading && nextHeading.level <= heading.level) {
      end = index;
      break;
    }
  }

  return {
    start,
    end,
    level: heading.level,
    title: heading.title || `H${heading.level}`,
    lines: lines.slice(start, end),
  };
}

function getInsertionIndex(
  lines: string[],
  targetLine: number | null,
  position: HeadingDropPosition,
): { index: number; targetStart: number | null } {
  if (position === "append" || targetLine === null) {
    return { index: lines.length, targetStart: null };
  }

  const target = getHeadingSection(lines, targetLine, "移動先");
  return {
    index: position === "before" ? target.start : target.end,
    targetStart: target.start,
  };
}

export function moveHeadingSections({
  documents,
  sources,
  targetPath,
  targetLine,
  position,
}: {
  documents: HeadingMoveDocument[];
  sources: HeadingMoveSource[];
  targetPath: string;
  targetLine: number | null;
  position: HeadingDropPosition;
}): HeadingMoveManyResult {
  const originalByPath = new Map(documents.map((document) => [document.path, document.markdown]));
  const bodyByPath = new Map(
    documents.map((document) => [
      document.path,
      splitLines(parseFrontMatter(document.markdown).body),
    ]),
  );
  const targetBody = bodyByPath.get(targetPath);
  if (!targetBody) {
    throw new Error("移動先のファイルを読み込めませんでした。");
  }

  const candidates = sources.map((source, order) => {
    const body = bodyByPath.get(source.path);
    if (!body) {
      throw new Error("移動元のファイルを読み込めませんでした。");
    }
    return {
      ...getHeadingSection(body.lines, source.line, "移動元"),
      path: source.path,
      order,
      sourceTrailingNewline: body.trailingNewline,
      sourceLineCount: body.lines.length,
    };
  });

  const acceptedByPath = new Map<string, typeof candidates>();
  for (const candidate of [...candidates].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.start - right.start ||
      right.end - left.end,
  )) {
    const accepted = acceptedByPath.get(candidate.path) ?? [];
    if (
      accepted.some(
        (section) =>
          candidate.start >= section.start && candidate.start < section.end,
      )
    ) {
      continue;
    }
    accepted.push(candidate);
    acceptedByPath.set(candidate.path, accepted);
  }
  const accepted = [...acceptedByPath.values()]
    .flat()
    .sort((left, right) => left.order - right.order);
  if (accepted.length === 0) {
    return { changed: false, movedTitles: [], documents };
  }

  const insertion = getInsertionIndex(targetBody.lines, targetLine, position);
  const targetSections = acceptedByPath.get(targetPath) ?? [];
  if (
    insertion.targetStart !== null &&
    targetSections.some(
      (section) =>
        insertion.targetStart! >= section.start &&
        insertion.targetStart! < section.end,
    )
  ) {
    return {
      changed: false,
      movedTitles: accepted.map((section) => section.title),
      documents,
    };
  }

  const nextBodies = new Map(
    [...bodyByPath.entries()].map(([path, body]) => [
      path,
      { ...body, lines: [...body.lines] },
    ]),
  );
  for (const [path, sections] of acceptedByPath) {
    const nextBody = nextBodies.get(path)!;
    for (const section of [...sections].sort((left, right) => right.start - left.start)) {
      nextBody.lines.splice(section.start, section.end - section.start);
    }
  }

  const removedBeforeInsertion = targetSections.reduce(
    (total, section) =>
      section.end <= insertion.index ? total + section.end - section.start : total,
    0,
  );
  const adjustedInsertion = insertion.index - removedBeforeInsertion;
  const movedLines = accepted.flatMap((section) => section.lines);
  const nextTargetBody = nextBodies.get(targetPath)!;
  nextTargetBody.lines.splice(adjustedInsertion, 0, ...movedLines);
  const lastMovedSection = accepted[accepted.length - 1];
  if (
    insertion.index === targetBody.lines.length &&
    lastMovedSection.sourceTrailingNewline &&
    lastMovedSection.end === lastMovedSection.sourceLineCount
  ) {
    nextTargetBody.trailingNewline = true;
  }

  const nextDocuments = documents.map((document) => {
    const body = nextBodies.get(document.path);
    if (!body) return document;
    return {
      ...document,
      markdown: updateMarkdownBody(document.markdown, joinLines(body)),
    };
  });

  return {
    changed: nextDocuments.some(
      (document) => document.markdown !== originalByPath.get(document.path),
    ),
    movedTitles: accepted.map((section) => section.title),
    documents: nextDocuments,
  };
}

export function moveHeadingSection({
  sourceMarkdown,
  targetMarkdown,
  sourceLine,
  targetLine,
  position,
  sameDocument,
}: {
  sourceMarkdown: string;
  targetMarkdown: string;
  sourceLine: number;
  targetLine: number | null;
  position: HeadingDropPosition;
  sameDocument: boolean;
}): HeadingMoveResult {
  const sourcePath = sameDocument ? "document" : "source";
  const targetPath = sameDocument ? sourcePath : "target";
  const result = moveHeadingSections({
    documents: sameDocument
      ? [{ path: sourcePath, markdown: sourceMarkdown }]
      : [
          { path: sourcePath, markdown: sourceMarkdown },
          { path: targetPath, markdown: targetMarkdown },
        ],
    sources: [{ path: sourcePath, line: sourceLine }],
    targetPath,
    targetLine,
    position,
  });
  const nextSource =
    result.documents.find((document) => document.path === sourcePath)?.markdown ??
    sourceMarkdown;
  const nextTarget =
    result.documents.find((document) => document.path === targetPath)?.markdown ??
    targetMarkdown;
  return {
    changed: result.changed,
    movedTitle: result.movedTitles[0] ?? "",
    sourceMarkdown: nextSource,
    targetMarkdown: sameDocument ? nextSource : nextTarget,
  };
}

export function extractHeadingSection({
  sourceMarkdown,
  sourceLine,
  includeChildren,
}: {
  sourceMarkdown: string;
  sourceLine: number;
  includeChildren: boolean;
}): HeadingExtractResult {
  const sourceBody = splitLines(parseFrontMatter(sourceMarkdown).body);
  const fullSection = getHeadingSection(sourceBody.lines, sourceLine, "切り出し元");
  let end = fullSection.end;
  if (!includeChildren) {
    for (let index = fullSection.start + 1; index < fullSection.end; index += 1) {
      if (parseHeading(sourceBody.lines[index])) {
        end = index;
        break;
      }
    }
  }

  const extractedLines = sourceBody.lines.slice(fullSection.start, end);
  const nextSourceLines = [...sourceBody.lines];
  nextSourceLines.splice(fullSection.start, end - fullSection.start);
  const extractedTrailingNewline =
    end < sourceBody.lines.length || sourceBody.trailingNewline;
  const nextSourceBody = joinLines({ ...sourceBody, lines: nextSourceLines });
  const sourceCursorOffset = Math.min(
    nextSourceBody.length,
    sourceBody.lines
      .slice(0, fullSection.start)
      .reduce((offset, line) => offset + line.length + 1, 0),
  );
  const nextSourceMarkdown = updateMarkdownBody(
    sourceMarkdown,
    nextSourceBody,
  );

  return {
    changed: nextSourceMarkdown !== sourceMarkdown,
    extractedTitle: fullSection.title,
    sourceMarkdown: nextSourceMarkdown,
    extractedMarkdown: joinLines({
      lines: extractedLines,
      trailingNewline: extractedTrailingNewline,
    }),
    sourceCursorOffset,
  };
}
