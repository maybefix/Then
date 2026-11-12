import type { ProjectEntry, ProjectFolder } from "../../types";

/**
 * 左のバインダーの段（BINDER 1-4）。作品直下を「原稿」と「素材」に分ける。
 * 素材かどうかはファイル一覧（Rust の list_project_folder）が付けた role だけで決め、パスや名前では決めない。
 */
export type BinderTiers = {
  /** 作品直下の、素材フォルダ以外の項目（一覧の順のまま）。 */
  manuscriptEntries: ProjectEntry[];
  /** 作品直下の素材フォルダ。なければ null。 */
  materialsFolder: ProjectEntry | null;
};

export function splitBinderTiers(folder: ProjectFolder): BinderTiers {
  const manuscriptEntries: ProjectEntry[] = [];
  let materialsFolder: ProjectEntry | null = null;
  for (const entry of folder.children) {
    if (!materialsFolder && entry.kind === "folder" && entry.role === "material") {
      materialsFolder = entry;
    } else {
      manuscriptEntries.push(entry);
    }
  }
  return { manuscriptEntries, materialsFolder };
}

/** 作品直下の項目を、画面の段の順（原稿→素材）に並べる。素材フォルダがなければ一覧の順のまま。 */
export function orderRootEntriesByTier(folder: ProjectFolder): ProjectEntry[] {
  const { manuscriptEntries, materialsFolder } = splitBinderTiers(folder);
  return materialsFolder ? [...manuscriptEntries, materialsFolder] : folder.children;
}
