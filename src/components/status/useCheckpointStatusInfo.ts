import { useMemo } from "react";
import type { ProjectAst } from "../../editor/ast/types";
import type { EditorSettings, ManuscriptSnapshot, ProjectFolder } from "../../types";
import type { CheckpointStatusInfo } from "./CheckpointStatus";

type CheckpointStatusDeps = {
  settings: Pick<EditorSettings, "showCheckpointStatus">;
  /** 今のプロジェクトの保存点。新しい順。 */
  currentWorkspaceSnapshots: ManuscriptSnapshot[];
  projectAst: ProjectAst | null;
  projectFolder: ProjectFolder | null;
  openCheckpointStudio: (snapshotId?: string) => void;
  handleQuickCreateManuscriptSnapshot: () => Promise<void>;
};

/** ステータスバーの保存点の表示に渡す値。設定で切っているか、プロジェクトがなければ null。 */
export function useCheckpointStatusInfo(deps: CheckpointStatusDeps): CheckpointStatusInfo | null {
  const { settings, currentWorkspaceSnapshots, projectAst, projectFolder, openCheckpointStudio, handleQuickCreateManuscriptSnapshot } = deps;
  // ステータスバーの「保存点 2時間前 · +1,240字」。合計の引き算だけで、差分計算はしない。
  const latestManualSnapshot = useMemo(
    () => currentWorkspaceSnapshots.find((snapshot) => snapshot.reason === "manual") ?? null,
    [currentWorkspaceSnapshots],
  );
  const statusProjectVisibleTextLength = useMemo(() => {
    if (!settings.showCheckpointStatus || !projectAst || !projectFolder || projectAst.rootPath !== projectFolder.path) return null;
    if (projectAst.files.some((file) => file.status !== "indexed")) return null;
    return projectAst.files.reduce((sum, file) => sum + file.visibleTextLength, 0);
  }, [projectAst, projectFolder, settings.showCheckpointStatus]);
  return settings.showCheckpointStatus && projectFolder ? {
    latest: latestManualSnapshot && {
      label: latestManualSnapshot.label,
      createdAt: latestManualSnapshot.createdAt,
      visibleTextLength: latestManualSnapshot.totalVisibleTextLength,
    },
    currentVisibleTextLength: statusProjectVisibleTextLength,
    onOpen: () => openCheckpointStudio(latestManualSnapshot?.id),
    onCreate: () => void handleQuickCreateManuscriptSnapshot(),
  } : null;
}
