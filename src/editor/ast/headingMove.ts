import { parseFrontMatter, updateMarkdownBody } from "../../utils/frontmatter";

export type HeadingDropPosition = "before" | "after" | "append";

export type HeadingMoveResult = {
  changed: boolean;
  movedTitle: string;
  sourceMarkdown: string;
  targetMarkdown: string;
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
  const sourceBody = splitLines(parseFrontMatter(sourceMarkdown).body);
  const sourceSection = getHeadingSection(sourceBody.lines, sourceLine, "移動元");

  if (sameDocument) {
    const insertion = getInsertionIndex(sourceBody.lines, targetLine, position);
    if (
      insertion.targetStart !== null &&
      insertion.targetStart >= sourceSection.start &&
      insertion.targetStart < sourceSection.end
    ) {
      return {
        changed: false,
        movedTitle: sourceSection.title,
        sourceMarkdown,
        targetMarkdown: sourceMarkdown,
      };
    }

    const nextLines = [...sourceBody.lines];
    nextLines.splice(sourceSection.start, sourceSection.end - sourceSection.start);
    const removedLength = sourceSection.end - sourceSection.start;
    const adjustedInsertion =
      insertion.index >= sourceSection.end
        ? insertion.index - removedLength
        : insertion.index;
    nextLines.splice(adjustedInsertion, 0, ...sourceSection.lines);
    const nextMarkdown = updateMarkdownBody(
      sourceMarkdown,
      joinLines({ ...sourceBody, lines: nextLines }),
    );

    return {
      changed: nextMarkdown !== sourceMarkdown,
      movedTitle: sourceSection.title,
      sourceMarkdown: nextMarkdown,
      targetMarkdown: nextMarkdown,
    };
  }

  const targetBody = splitLines(parseFrontMatter(targetMarkdown).body);
  const insertion = getInsertionIndex(targetBody.lines, targetLine, position);
  const nextSourceLines = [...sourceBody.lines];
  nextSourceLines.splice(sourceSection.start, sourceSection.end - sourceSection.start);
  const nextTargetLines = [...targetBody.lines];
  nextTargetLines.splice(insertion.index, 0, ...sourceSection.lines);
  const targetTrailingNewline =
    targetBody.trailingNewline ||
    (insertion.index === targetBody.lines.length &&
      sourceSection.end === sourceBody.lines.length &&
      sourceBody.trailingNewline);

  return {
    changed: true,
    movedTitle: sourceSection.title,
    sourceMarkdown: updateMarkdownBody(
      sourceMarkdown,
      joinLines({ ...sourceBody, lines: nextSourceLines }),
    ),
    targetMarkdown: updateMarkdownBody(
      targetMarkdown,
      joinLines({
        ...targetBody,
        lines: nextTargetLines,
        trailingNewline: targetTrailingNewline,
      }),
    ),
  };
}
