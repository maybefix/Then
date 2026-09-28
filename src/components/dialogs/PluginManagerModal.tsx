import { useLayoutEffect, useRef, useState } from "react";
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

type BusyAction = "install" | "reload" | `uninstall:${string}`;

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const lastActionButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  const busyActionRef = useRef(busyAction);
  onCloseRef.current = onClose;
  busyActionRef.current = busyAction;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusableElements = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.getClientRects().length > 0,
      );
    const isTopmostDialog = () => {
      const dialogs = document.querySelectorAll('[aria-modal="true"]');
      return dialogs[dialogs.length - 1] === dialog;
    };

    (dialog.querySelector<HTMLElement>(".modalClose") ?? dialog).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopmostDialog()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (busyActionRef.current === null) onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active) || active === dialog) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (isTopmostDialog() && !dialog.contains(event.target as Node)) {
        (focusableElements()[0] ?? dialog).focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", handleFocusIn);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", handleFocusIn);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const actionButton = lastActionButtonRef.current;
    if (!dialog || !actionButton) return;
    const dialogs = document.querySelectorAll('[aria-modal="true"]');
    if (dialogs[dialogs.length - 1] !== dialog) return;
    if (busyAction !== null) {
      dialog.focus();
      return;
    }
    const focusTarget = actionButton.isConnected && !actionButton.disabled
      ? actionButton
      : dialog.querySelector<HTMLElement>(".modalClose") ?? dialog;
    focusTarget.focus();
  }, [busyAction]);

  const runAction = async (
    action: BusyAction,
    run: () => void | Promise<void>,
    button: HTMLButtonElement,
  ) => {
    lastActionButtonRef.current = button;
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
        ref={dialogRef}
        className="modal pluginManagerModal"
        aria-labelledby="plugin-manager-title"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <header className="modalHeader">
          <div className="pluginManagerHeading">
            <h2 id="plugin-manager-title">プラグイン</h2>
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
              onClick={(event) => void runAction("reload", onReload, event.currentTarget)}
              disabled={busyAction !== null}
            >
              {busyAction === "reload" ? "再読み込み中…" : "再読み込み"}
            </button>
            <button
              className="pluginManagerPrimaryButton"
              type="button"
              onClick={(event) => void runAction("install", onInstall, event.currentTarget)}
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
                const actionId: BusyAction = `uninstall:${plugin.manifest.id}`;
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
                        onClick={(event) =>
                          void runAction(actionId, () => onUninstall(plugin), event.currentTarget)
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
