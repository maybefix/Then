// BINDER 3-1・3-2: リンクを書き換えるときに、タブで開いていないファイルを読み書きする口。
// 書くときは読んだときのハッシュを付け、そのあいだにほかのアプリが書いていれば
// Rust が書かずに返す（プロジェクト全体の置換と同じ作法）。
import { invoke } from "@tauri-apps/api/core";
import type { TextDocument } from "../types";

export async function readLinkFile(path: string): Promise<{ content: string; contentHash: string | null }> {
  const document = await invoke<TextDocument>("read_text_file", { path });
  return { content: document.content, contentHash: document.contentHash ?? null };
}

export async function writeLinkFile(path: string, content: string, expectedHash: string | null): Promise<string> {
  return (await invoke<TextDocument>("save_text_file", { path, content, expectedHash })).content;
}
