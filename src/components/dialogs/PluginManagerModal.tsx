import { useState } from "react";
import type {
  LoadedThenPlugin,
  ThenPluginPermission,
} from "../../plugins/types";
import { PluginIcon } from "../plugins/PluginIcon";

type PluginManagerModalProps = {
  plugins: LoadedThenPlugin[];
  onClose: () => void;
  onInstall: () => void | Promise<void>;
  onReload: () => void | Promise<void>;
  onUninstall: (plugin: LoadedThenPlugin) => void | Promise<void>;
};

const permissionLabels: Record<ThenPluginPermission, string> = {
  "document:read": "文書の読み取り",
  "document:selection": "選択範囲",
  "document:navigate": "カーソル移動",
  "document:anchors": "永続アンカー",
  views: "ツールビュー",
  statusbar: "ステータスバー",
  storage: "プロジェクト保存",
  commands: "コマンド",
};

export function PluginManagerModal({
  plugins,
  onClose,
  onInstall,
  onReload,
  onUninstall,
}: PluginManagerModalProps) {
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const runAction = async (action: string, run: () => void | Promise<void>) => {
    setBusyAction(action);
    try {
      await run();
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="modalBackdrop" role="presentation">
      <section
        className="modal pluginManagerModal"
        aria-label="プラグイン管理"
        role="dialog"
        aria-modal="true"
      >
        <header className="modalHeader">
          <div className="pluginManagerHeading">
            <h2>プラグイン</h2>
            <span>{plugins.length}個を導入済み</span>
          </div>
          <button
            className="modalClose"
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            disabled={busyAction !== null}
          >
            ×
          </button>
        </header>

        <div className="pluginManagerToolbar">
          <p>Then全体に導入したプラグインを管理します。</p>
          <div>
            <button
              type="button"
              onClick={() => void runAction("reload", onReload)}
              disabled={busyAction !== null}
            >
              {busyAction === "reload" ? "再読み込み中…" : "再読み込み"}
            </button>
            <button
              className="pluginManagerPrimaryButton"
              type="button"
              onClick={() => void runAction("install", onInstall)}
              disabled={busyAction !== null}
            >
              {busyAction === "install" ? "導入中…" : "プラグインを追加…"}
            </button>
          </div>
        </div>

        <div className="pluginManagerBody">
          {plugins.length === 0 ? (
            <div className="pluginManagerEmpty">
              <strong>導入済みのプラグインはありません</strong>
              <span>「プラグインを追加…」からmanifest.jsonを含むフォルダを選べます。</span>
            </div>
          ) : (
            <ul className="pluginManagerList">
              {plugins.map((plugin) => {
                const actionId = `uninstall:${plugin.manifest.id}`;
                return (
                  <li className="pluginManagerItem" key={plugin.manifest.id}>
                    <div className="pluginManagerItemHeader">
                      <div className="pluginManagerIdentity">
                        {plugin.manifest.icon && (
                          <PluginIcon
                            icon={plugin.manifest.icon}
                            className="pluginManagerIcon"
                          />
                        )}
                        <div>
                        <strong>{plugin.manifest.name}</strong>
                        <span>v{plugin.manifest.version}</span>
                        </div>
                      </div>
                      <button
                        className="pluginManagerDeleteButton"
                        type="button"
                        onClick={() =>
                          void runAction(actionId, () => onUninstall(plugin))
                        }
                        disabled={busyAction !== null}
                        aria-label={`${plugin.manifest.name}を削除`}
                      >
                        {busyAction === actionId ? "削除中…" : "削除"}
                      </button>
                    </div>
                    <p>
                      {plugin.manifest.description?.trim() || "説明はありません。"}
                    </p>
                    <code>{plugin.manifest.id}</code>
                    <div className="pluginPermissionList" aria-label="要求する権限">
                      {plugin.manifest.permissions.length > 0 ? (
                        plugin.manifest.permissions.map((permission) => (
                          <span key={permission}>{permissionLabels[permission]}</span>
                        ))
                      ) : (
                        <span>追加権限なし</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="pluginManagerFooter">
          削除しても、プロジェクトに保存したプラグインデータと永続アンカーは残ります。
        </footer>
      </section>
    </div>
  );
}
