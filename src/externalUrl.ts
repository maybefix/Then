import { invoke } from "@tauri-apps/api/core";

/**
 * The link a reference or an AI answer may open, or null when it should stay
 * plain text: only web pages and mail. javascript:, file:, relative paths and
 * the like are not links here. Rust checks again before handing it to Windows.
 */
export function openableUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed || /[\s\u0000-\u001f\u007f]/.test(trimmed)) return null;
  const match = trimmed.match(/^(?:https?:\/\/|mailto:)(.)/i);
  if (!match || match[1] === "/" || match[1] === "\\") return null;
  return trimmed;
}

/** Opens the link in the user's browser or mail program, outside Then. */
export function openExternalUrl(url: string): Promise<void> {
  return invoke("open_external_url", { url });
}
