import { normalizePathForCompare } from "../storedStateModel";
import type { ThenPluginIcon, ThenPluginManifest } from "./types";

// プラグインの受け口で使う、React に依存しない処理。

export function pluginDocumentPath(rootPath: string, absolutePath: string): string | null {
  const root = normalizePathForCompare(rootPath);
  const target = normalizePathForCompare(absolutePath);
  if (target === root || !target.startsWith(`${root}\\`)) return null;
  return absolutePath
    .replace(/[\\/]+/g, "/")
    .slice(rootPath.replace(/[\\/]+/g, "/").replace(/\/+$/, "").length + 1);
}

export function pluginPermissionForMethod(method: string): ThenPluginManifest["permissions"][number] | null {
  if (method === "editor.getSelection") return "document:selection";
  if (method === "editor.moveCursor") return "document:navigate";
  if (method.startsWith("anchors.")) return "document:anchors";
  if (method.startsWith("views.")) return "views";
  if (method.startsWith("statusbar.")) return "statusbar";
  if (method.startsWith("storage.")) return "storage";
  if (method.startsWith("commands.")) return "commands";
  return null;
}

export function objectArgs(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function pluginViewIcon(value: unknown): ThenPluginIcon | undefined {
  if (value === undefined) return undefined;
  const icon = objectArgs(value);
  const paths = icon.paths;
  const isValid = Array.isArray(paths)
    && paths.length >= 1
    && paths.length <= 8
    && paths.every((path) =>
      typeof path === "string"
      && path.trim().length >= 1
      && path.length <= 1024
      && /^[A-Za-z0-9\s.,+-]+$/.test(path),
    );
  if (!isValid) {
    throw new Error("view iconは1〜8本のSVG path dataで指定してください");
  }
  return { paths: paths as string[] };
}
