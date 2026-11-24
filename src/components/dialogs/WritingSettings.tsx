import type { SettingsPanelProps } from "./SettingsPanelTypes";
import { SettingsGroup } from "./SettingsGroup";

export function WritingSettings({ settings, onUpdateSettings }: SettingsPanelProps) {
  return (
    <>
      <SettingsGroup title="タイプライター">
        <label className="checkSetting">
          <input
            checked={settings.typewriterScroll}
            type="checkbox"
            onChange={(event) =>
              onUpdateSettings("typewriterScroll", event.target.checked)
            }
          />
          <span>タイプライタースクロール</span>
        </label>
        <label className="rangeSetting">
          <span>固定位置 {settings.typewriterOffset}%</span>
          <input
            disabled={!settings.typewriterScroll}
            min="30"
            max="65"
            type="range"
            value={settings.typewriterOffset}
            onChange={(event) =>
              onUpdateSettings("typewriterOffset", Number(event.target.value))
            }
          />
        </label>
        <label className="checkSetting">
          <input
            checked={settings.showTypewriterGuide}
            disabled={!settings.typewriterScroll}
            type="checkbox"
            onChange={(event) =>
              onUpdateSettings("showTypewriterGuide", event.target.checked)
            }
          />
          <span>タイプライター中央線を表示</span>
        </label>
      </SettingsGroup>
      <SettingsGroup title="表示の補助">
        <label className="checkSetting">
          <input
            checked={settings.showLineBreakMarks}
            type="checkbox"
            onChange={(event) =>
              onUpdateSettings("showLineBreakMarks", event.target.checked)
            }
          />
          <span>改行記号を表示</span>
        </label>
        <label className="checkSetting">
          <input
            checked={settings.showLineNumbers}
            type="checkbox"
            onChange={(event) =>
              onUpdateSettings("showLineNumbers", event.target.checked)
            }
          />
          <span>行番号を表示</span>
        </label>
        <label className="checkSetting">
          <input
            checked={settings.highlightCurrentLine}
            type="checkbox"
            onChange={(event) =>
              onUpdateSettings("highlightCurrentLine", event.target.checked)
            }
          />
          <span>現在行をハイライト</span>
        </label>
        <label className="checkSetting descriptiveCheckSetting">
          <input
            checked={settings.colorizeJapaneseQuotes}
            type="checkbox"
            onChange={(event) =>
              onUpdateSettings("colorizeJapaneseQuotes", event.target.checked)
            }
          />
          <span className="checkSettingCopy">
            <span>「」内を色分け</span>
            <small>鉤括弧を含む会話文を落ち着いた色で表示します</small>
          </span>
        </label>
        <label className="checkSetting descriptiveCheckSetting">
          <input
            checked={settings.showComments}
            type="checkbox"
            onChange={(event) =>
              onUpdateSettings("showComments", event.target.checked)
            }
          />
          <span className="checkSettingCopy">
            <span>コメントを表示</span>
            <small>行頭が // の行と &lt;!-- --&gt; で囲んだ行。オフにすると畳みます（Ctrl+Shift+/）</small>
          </span>
        </label>
      </SettingsGroup>
      <SettingsGroup title="文字数の集計">
        <label className="checkSetting">
          <input
            checked={settings.countWhitespace}
            type="checkbox"
            onChange={(event) => onUpdateSettings("countWhitespace", event.target.checked)}
          />
          <span>文字数に空白を含める</span>
        </label>
        <label className="checkSetting descriptiveCheckSetting">
          <input
            checked={settings.countCode}
            type="checkbox"
            onChange={(event) => onUpdateSettings("countCode", event.target.checked)}
          />
          <span className="checkSettingCopy">
            <span>文字数にコードを含める</span>
            <small>``` で囲んだコードブロックと ` で囲んだ行内コード</small>
          </span>
        </label>
      </SettingsGroup>
    </>
  );
}
