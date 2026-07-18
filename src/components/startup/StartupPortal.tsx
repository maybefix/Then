import packageMetadata from "../../../package.json";
import type { WorkspaceAlert, WorkspaceRecord } from "../../types";

type StartupPortalProps = {
  recentWorkspaces: WorkspaceRecord[];
  lastWorkspacePath: string | null;
  skipStartupPortal: boolean;
  workspaceAlert: WorkspaceAlert;
  onContinue: () => void;
  onNewDocument: () => void;
  onOpenFolder: () => void;
  onOpenWorkspace: (path: string) => void;
  onClearHistory: () => void;
  onSkipStartupPortalChange: (value: boolean) => void;
  onOpenSettings: () => void;
};

type PortalIconName =
  | "arrow"
  | "filePlus"
  | "folder"
  | "menu"
  | "pen"
  | "settings";

function PortalIcon({ name }: { name: PortalIconName }) {
  const common = {
    viewBox: "0 0 24 24",
    "aria-hidden": true,
    focusable: false,
  };

  switch (name) {
    case "arrow":
      return (
        <svg {...common}>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      );
    case "filePlus":
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
          <path d="M14 2v6h6M12 12v6M9 15h6" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
        </svg>
      );
    case "menu":
      return (
        <svg {...common}>
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      );
    case "pen":
      return (
        <svg {...common}>
          <path d="m15 5 4 4M4 20l4.5-1 10-10a2.8 2.8 0 0 0-4-4l-10 10z" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3.25" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.87l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.16.37.4.71.72.97.3.25.68.4 1.08.43H21v4h-.09A1.7 1.7 0 0 0 19.4 15z" />
        </svg>
      );
  }
}

function formatLastOpened(timestamp: number): string {
  const elapsed = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (elapsed < minute) return "たった今";
  if (elapsed < hour) return `${Math.max(1, Math.floor(elapsed / minute))}分前`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)}時間前`;
  if (elapsed < day * 2) return "昨日";
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(
    timestamp,
  );
}

export function StartupPortal({
  recentWorkspaces,
  lastWorkspacePath,
  skipStartupPortal,
  workspaceAlert,
  onContinue,
  onNewDocument,
  onOpenFolder,
  onOpenWorkspace,
  onClearHistory,
  onSkipStartupPortalChange,
  onOpenSettings,
}: StartupPortalProps) {
  const sortedWorkspaces = [...recentWorkspaces].sort(
    (left, right) => right.lastOpenedAt - left.lastOpenedAt,
  );
  const lastWorkspace = sortedWorkspaces.find(
    (workspace) => workspace.path === lastWorkspacePath,
  );

  return (
    <section className="startupPortal" aria-label="Then 起動ポータル">
      <header className="startupPortalHeader">
        <span className="startupPortalMenuIcon" aria-hidden="true">
          <PortalIcon name="menu" />
        </span>
        <span className="startupPortalWordmark">Then</span>
      </header>

      <div className="startupPortalMain">
        <section className="startupPortalIntro">
          <div className="startupPortalMark" aria-hidden="true">
            T
          </div>
          <h1>執筆するワークスペースを選んでください。</h1>
          {workspaceAlert && (
            <div className="startupPortalAlert" role="alert">
              <strong>{workspaceAlert.message}</strong>
              <span>{workspaceAlert.path}</span>
            </div>
          )}
          <div className="startupPortalActions">
            <button
              className="startupPortalPrimaryButton"
              type="button"
              disabled={!lastWorkspacePath}
              onClick={onContinue}
            >
              <PortalIcon name="pen" />
              <span>
                <strong>前回の執筆を続ける</strong>
                {lastWorkspace && <small>{lastWorkspace.name}</small>}
              </span>
            </button>
            <button type="button" onClick={onNewDocument}>
              <PortalIcon name="filePlus" />
              新しい原稿を始める
            </button>
            <button type="button" onClick={onOpenFolder}>
              <PortalIcon name="folder" />
              フォルダを開く
            </button>
          </div>
        </section>

        <section className="startupPortalRecent" aria-label="最近のワークスペース">
          <div className="startupPortalRecentHeader">
            <div>
              <h2>最近のワークスペース</h2>
              <p>選択すると、そのまま執筆画面へ移動します</p>
            </div>
            {sortedWorkspaces.length > 0 && (
              <button className="startupPortalTextButton" type="button" onClick={onClearHistory}>
                履歴を消去
              </button>
            )}
          </div>
          <div className="startupPortalWorkspaceList">
            {sortedWorkspaces.length > 0 ? (
              sortedWorkspaces.map((workspace) => (
                <button
                  className="startupPortalWorkspace"
                  key={workspace.path}
                  type="button"
                  onClick={() => onOpenWorkspace(workspace.path)}
                >
                  <span className="startupPortalWorkspaceBody">
                    <span className="startupPortalWorkspaceTitle">
                      <strong>{workspace.name}</strong>
                      {workspace.path === lastWorkspacePath && <em>前回</em>}
                    </span>
                    <span className="startupPortalWorkspaceMeta">
                      <span title={workspace.path}>{workspace.path}</span>
                      <time dateTime={new Date(workspace.lastOpenedAt).toISOString()}>
                        {formatLastOpened(workspace.lastOpenedAt)}
                      </time>
                    </span>
                  </span>
                  <PortalIcon name="arrow" />
                </button>
              ))
            ) : (
              <p className="startupPortalEmpty">最近開いたワークスペースはありません。</p>
            )}
          </div>
        </section>
      </div>

      <footer className="startupPortalFooter">
        <button className="startupPortalSettingsButton" type="button" onClick={onOpenSettings}>
          <PortalIcon name="settings" />
          設定
        </button>
        <label className="startupPortalSkipSetting">
          <input
            checked={skipStartupPortal}
            type="checkbox"
            onChange={(event) => onSkipStartupPortalChange(event.target.checked)}
          />
          <span>次回から前回のワークスペースを直接開く</span>
        </label>
        <span className="startupPortalVersion">Then {packageMetadata.version}</span>
      </footer>
    </section>
  );
}
