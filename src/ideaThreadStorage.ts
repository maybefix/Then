import { invoke } from "@tauri-apps/api/core";
import { defaultIdeaThreads, normalizeIdeaThreads } from "./ideaThreadModel";
import type { IdeaThread } from "./types";

const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

export async function loadWorkspaceSnippets(folderPath: string): Promise<IdeaThread[]> {
  if (!isTauriRuntime()) return defaultIdeaThreads();
  const loaded = await invoke<IdeaThread[]>("load_project_snippets", { rootPath: folderPath });
  return loaded.length ? normalizeIdeaThreads(loaded) : defaultIdeaThreads();
}

