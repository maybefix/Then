import type { Dispatch, SetStateAction } from "react";
import type { AppState, ProjectFolder } from "./types";

export type WorkspaceTreeActionDeps = {
  projectFolder: ProjectFolder | null;
  setAppState: Dispatch<SetStateAction<AppState>>;
};

/**
 * ファイルツリーで、フォルダ・ファイルのアウトライン・見出しを開け閉めした記録を、作品ごとに残す操作。
 * 値は App が持ち、描画のたびにその時点の値と書き換え用の関数を受け取る。
 */
export function createWorkspaceTreeActions(deps: WorkspaceTreeActionDeps) {
  const { projectFolder, setAppState } = deps;

  const handleFolderCollapsedChange = (path: string, collapsed: boolean) => {
    if (!projectFolder) return;
    const workspacePath = projectFolder.path;
    setAppState((current) => {
      const currentPaths = new Set(
        current.collapsedFolderPathsByWorkspace[workspacePath] ?? [],
      );
      if (collapsed) {
        currentPaths.add(path);
      } else {
        currentPaths.delete(path);
      }
      return {
        ...current,
        collapsedFolderPathsByWorkspace: {
          ...current.collapsedFolderPathsByWorkspace,
          [workspacePath]: Array.from(currentPaths),
        },
      };
    });
  };

  const handleOutlineCollapsedChange = (path: string, collapsed: boolean) => {
    if (!projectFolder) return;
    const workspacePath = projectFolder.path;
    setAppState((current) => {
      const currentPaths = new Set(
        current.collapsedOutlinePathsByWorkspace[workspacePath] ?? [],
      );
      if (collapsed) {
        currentPaths.add(path);
      } else {
        currentPaths.delete(path);
      }
      return {
        ...current,
        collapsedOutlinePathsByWorkspace: {
          ...current.collapsedOutlinePathsByWorkspace,
          [workspacePath]: Array.from(currentPaths),
        },
      };
    });
  };

  const handleOutlineHeadingCollapsedChange = (key: string, collapsed: boolean) => {
    if (!projectFolder) return;
    const workspacePath = projectFolder.path;
    setAppState((current) => {
      const currentKeys = new Set(
        current.collapsedOutlineHeadingKeysByWorkspace[workspacePath] ?? [],
      );
      if (collapsed) {
        currentKeys.add(key);
      } else {
        currentKeys.delete(key);
      }
      return {
        ...current,
        collapsedOutlineHeadingKeysByWorkspace: {
          ...current.collapsedOutlineHeadingKeysByWorkspace,
          [workspacePath]: Array.from(currentKeys),
        },
      };
    });
  };

  return {
    handleFolderCollapsedChange,
    handleOutlineCollapsedChange,
    handleOutlineHeadingCollapsedChange,
  };
}
