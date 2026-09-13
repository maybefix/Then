import { normalizeText, parseInlines } from "../../editor/ast/documentAst";
import { serializeKakuyomuEmphasis, serializeKakuyomuRuby } from "./profiles/kakuyomu";
import { serializeNarouEmphasis, serializeNarouRuby } from "./profiles/narou";
import { serializePlainMarkup } from "./profiles/plain";
import type { SubmissionDocument, SubmissionExportOptions, SubmissionExportResult, SubmissionInline, SubmissionWarning, Warn } from "./types";

function serializeInline(inline: SubmissionInline, options: SubmissionExportOptions, warn: Warn): string {
  if (inline.kind === "text") {
    if (options.target !== "plain" && /[｜《》]/u.test(inline.text)) {
      warn("literal-notation-conflict", "本文の記号が投稿先でルビ・傍点として解釈される可能性があります");
    }
    return inline.text;
  }
  const markup = inline.markup;
  if (markup.type === "layoutAlign" || (markup.type === "aozoraAnnotation" && markup.contentText === "地付き")) return "";
  if (markup.type === "aozoraAnnotation") {
    warn("unsupported-markup", `未対応の青空文庫注記: ${markup.contentText}`);
    return options.target === "plain" ? "" : markup.fullText;
  }
  // The AST parser exposes an outer decoration only. Keep ambiguous contents
  // intact instead of guessing how competing decorations should be flattened.
  if (parseInlines(markup.contentText).length > 0) {
    warn("nested-decoration", "入れ子の装飾を完全には変換できません。内容を確認してください");
  }
  if (options.target === "plain") return serializePlainMarkup(markup);
  if (markup.type === "ruby") {
    const ruby = options.target === "kakuyomu" ? serializeKakuyomuRuby : serializeNarouRuby;
    const items = markup.rubyMode === "mono" && markup.rubyItems?.length
      ? markup.rubyItems : [{ text: markup.contentText, reading: markup.rubyText ?? "" }];
    return items.map((item) => ruby(item.text, item.reading, warn)).join("");
  }
  if (markup.type === "emphasis") {
    if (options.target === "kakuyomu") return serializeKakuyomuEmphasis(markup.contentText);
    if (options.narouEmphasisMode === "ruby-dots") return serializeNarouEmphasis(markup.contentText);
  }
  warn("decoration-removed", `${markup.type}の装飾を解除しました`);
  return markup.contentText;
}

export function serializeSubmission(document: Readonly<SubmissionDocument>, options: SubmissionExportOptions): SubmissionExportResult {
  if (!document.sections.length) throw new Error("出力対象の本文ファイルを1つ以上選択してください");
  const warnings: SubmissionWarning[] = [];
  const sections = document.sections.map(({ source, lines }) => {
    let firstHeading = true;
    const output: string[] = [];
    for (const line of lines) {
      if (line.kind === "heading") {
        const remove = options.headingMode === "remove-all" || (options.headingMode === "remove-first" && firstHeading);
        firstHeading = false;
        if (remove) continue;
      }
      const warn: Warn = (kind, message) => warnings.push({ sourceId: source.id, sourceName: source.displayName, line: line.sourceLine, kind, message });
      output.push(line.inlines.map((inline) => serializeInline(inline, options, warn)).join(""));
    }
    return output.join("\n").replace(/\n+$/u, "");
  });
  const lf = normalizeText(sections.join(normalizeText(options.sourceSeparator))).replace(/\n*$/u, "\n");
  return { target: options.target, text: options.lineEnding === "crlf" ? lf.replace(/\n/g, "\r\n") : lf,
    chars: Array.from(lf).length, sourceCount: document.sections.length, warnings };
}
