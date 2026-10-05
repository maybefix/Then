import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { ExportCoverImage, ExportFrontMatterLayout } from "./types";

// 前付けの作品ごとの値（タイトル上書き・副題・著者名・表紙画像）を
// 作品の .then/project.json と .then/export/ に読み書きする。

export type StoredFrontMatter = {
  title: string;
  subtitle: string;
  author: string;
  coverImage: ExportCoverImage | null;
  /** 表紙・目次の有無と体裁。未保存なら null（形の補完は呼び出し側）。 */
  layout: Partial<ExportFrontMatterLayout> | null;
};

type CoverImagePayload = {
  path: string;
  mime: ExportCoverImage["mime"];
  dataBase64: string;
};

function imageSize(mime: string, dataBase64: string): Promise<{ widthPx: number; heightPx: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ widthPx: image.naturalWidth, heightPx: image.naturalHeight });
    image.onerror = () => reject(new Error("表紙画像を読み込めませんでした"));
    image.src = `data:${mime};base64,${dataBase64}`;
  });
}

async function toCoverImage(payload: CoverImagePayload): Promise<ExportCoverImage> {
  const size = await imageSize(payload.mime, payload.dataBase64);
  // The query busts the viewer's cache when the cover is replaced in place.
  const url = `${convertFileSrc(payload.path, "then-cover")}?v=${Date.now()}`;
  return { url, mime: payload.mime, dataBase64: payload.dataBase64, ...size };
}

export async function loadFrontMatter(projectPath: string): Promise<StoredFrontMatter> {
  const stored = await invoke<Omit<StoredFrontMatter, "coverImage"> & { coverImage: CoverImagePayload | null }>(
    "load_export_front_matter",
    { projectPath },
  );
  return {
    ...stored,
    coverImage: stored.coverImage ? await toCoverImage(stored.coverImage).catch(() => null) : null,
  };
}

export function saveFrontMatterLayout(projectPath: string, layout: ExportFrontMatterLayout): Promise<void> {
  return invoke("save_export_front_matter_layout", { projectPath, layout });
}

export function saveFrontMatterText(
  projectPath: string,
  value: Pick<StoredFrontMatter, "title" | "subtitle" | "author">,
): Promise<void> {
  return invoke("save_export_front_matter", { projectPath, ...value });
}

export async function pickCoverImage(projectPath: string): Promise<ExportCoverImage | null> {
  const payload = await invoke<CoverImagePayload | null>("pick_export_cover_image", { projectPath });
  return payload ? toCoverImage(payload) : null;
}

export function clearCoverImage(projectPath: string): Promise<void> {
  return invoke("clear_export_cover_image", { projectPath });
}
