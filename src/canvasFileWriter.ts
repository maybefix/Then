// メイン画面がキャンバスの頼みを受けて、ノート・原稿へ書き戻す処理（BINDER 4-2）。
// ファイルへ書くのはメイン画面だけにする。タブを持っているのはメイン画面だけなので、「タブで開いているか」を
// 確かめてから書くまでのあいだに、別ウィンドウの古い情報で書く事故が起きない。
// 概要はコルクボードと同じ synopsisWriter.ts を使う。React には依存しない（App.tsx は host を渡して呼ぶ）。
import type { CanvasFileWriteRequest, CanvasFileWriteResult } from "./canvasTypes";
import type { SynopsisWriterHost } from "./corkboard/synopsisWriter";
import type { TextDocument } from "./types";
import { updateMarkdownBody } from "./utils/frontmatter";

export type CanvasFileWriterHost = SynopsisWriterHost & {
  /** 作品からの相対パスを、ファイルの絶対パスにする。 */
  absolutePath: (rootPath: string, path: string) => string;
  /** ノートの本文を書けたら、リンク索引へ知らせる（タブの保存と同じ）。 */
  noteSaved: (path: string, content: string) => void;
  /** 書けたら、すべてのキャンバスへ新しい中身を知らせる。 */
  fileSaved: (rootPath: string, path: string, document: TextDocument) => void;
};

export async function writeCanvasFile(
  host: CanvasFileWriterHost,
  request: CanvasFileWriteRequest,
): Promise<CanvasFileWriteResult> {
  const path = host.absolutePath(request.rootPath, request.path);
  if (request.kind === "synopsis") {
    const { saveSynopsis } = await import("./corkboard/synopsisWriter");
    const result = await saveSynopsis(host, path, request.text, request.base);
    if (result.status === "saved") {
      host.fileSaved(request.rootPath, request.path, result.document);
      return { status: "saved", content: result.document.content, contentHash: result.document.contentHash ?? null };
    }
    if (result.status === "conflict") {
      return { status: "conflict", content: result.current.content, contentHash: result.current.contentHash ?? null };
    }
    return result;
  }

  // ノートの本文。タブで開いているあいだは、タブが書く人なのでここでは書かない。
  if (host.openTabMarkdown(path) !== null) return { status: "open-in-tab" };
  const next = updateMarkdownBody(request.base.content, request.text);
  if (next === request.base.content) return { status: "unchanged" };
  try {
    const document = await host.saveFile(path, next, request.base.contentHash);
    host.noteSaved(path, document.content);
    host.fileSaved(request.rootPath, request.path, document);
    return { status: "saved", content: document.content, contentHash: document.contentHash ?? null };
  } catch (error) {
    if (!host.isConflict(error)) throw error;
    const current = await host.readFile(path);
    return { status: "conflict", content: current.content, contentHash: current.contentHash ?? null };
  }
}
