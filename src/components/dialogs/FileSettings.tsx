import type { EditorSettings } from "../../types";
import type { SettingsPanelProps } from "./SettingsPanelTypes";

export function FileSettings({ settings, onSnippetStorageModeChange, onUpdateSettings }: SettingsPanelProps & { onSnippetStorageModeChange: (mode: EditorSettings["snippetStorageMode"]) => void }) {
  return (
    <>
      <label className="checkSetting">
        <input
          checked={settings.showOutlineGuides}
          type="checkbox"
          onChange={(event) =>
            onUpdateSettings("showOutlineGuides", event.target.checked)
          }
        />
        <span>見出しのガイド線を表示</span>
      </label>
      <label className="checkSetting">
        <input
          checked={settings.showWorkspacePaths}
          type="checkbox"
          onChange={(event) =>
            onUpdateSettings("showWorkspacePaths", event.target.checked)
          }
        />
        <span>プロジェクト切替にパスを表示</span>
      </label>
      <label className="checkSetting">
        <input
          checked={settings.showStatusFilePath}
          type="checkbox"
          onChange={(event) =>
            onUpdateSettings("showStatusFilePath", event.target.checked)
          }
        />
        <span>画面下部にファイルパスを表示</span>
      </label>
      <label className="checkSetting descriptiveCheckSetting">
        <input
          checked={settings.showCheckpointStatus}
          type="checkbox"
          onChange={(event) =>
            onUpdateSettings("showCheckpointStatus", event.target.checked)
          }
        />
        <span className="checkSettingCopy">
          <span>画面下部に最後の保存点を表示</span>
          <small>保存点を作ってからの時間と、増減した字数を出します</small>
        </span>
      </label>
      <label className="checkSetting">
        <input
          checked={settings.showCheckpointSection}
          type="checkbox"
          onChange={(event) =>
            onUpdateSettings("showCheckpointSection", event.target.checked)
          }
        />
        <span>サイドバーにチェックポイントを表示</span>
      </label>
      <label className="checkSetting descriptiveCheckSetting">
        <input
          checked={settings.showDocumentTabs}
          type="checkbox"
          onChange={(event) =>
            onUpdateSettings("showDocumentTabs", event.target.checked)
          }
        />
        <span className="checkSettingCopy">
          <span>タブを表示</span>
          <small>開いている文書をパンくずの下に表示します</small>
        </span>
      </label>
      <label>
        <span>タブバーの表示方法</span>
        <select
          value={settings.documentTabsDisplayMode}
          disabled={!settings.showDocumentTabs}
          onChange={(event) =>
            onUpdateSettings(
              "documentTabsDisplayMode",
              event.target.value as EditorSettings["documentTabsDisplayMode"],
            )
          }
        >
          <option value="always">常に表示</option>
          <option value="hover">上端にカーソルを寄せたときだけ表示</option>
        </select>
      </label>
      <label className="checkSetting">
        <input
          checked={settings.skipStartupPortal}
          type="checkbox"
          onChange={(event) =>
            onUpdateSettings("skipStartupPortal", event.target.checked)
          }
        />
        <span>起動時に前回のワークスペースを直接開く</span>
      </label>
      <label>
        <span>Ideaの管理単位</span>
        <select
          value={settings.snippetStorageMode}
          onChange={(event) =>
            onSnippetStorageModeChange(
              event.target.value as EditorSettings["snippetStorageMode"],
            )
          }
        >
          <option value="workspace">作品ごとに分ける</option>
          <option value="profile">全作品で共有する</option>
        </select>
      </label>
    </>
  );
}
