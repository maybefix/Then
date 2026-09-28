import type { EditorSettings } from "../../types";
import { EDITOR_MEASURE_PERCENT_MAX, EDITOR_MEASURE_PERCENT_MIN } from "../../types";
import { BoundedNumberInput } from "./BoundedNumberInput";
import { SettingsFontSelect } from "./SettingsFontSelect";
import type { FontSettingsPanelProps } from "./SettingsPanelTypes";

export function BodySettings({ settings, systemFonts, editorMeasureLimit, onUpdateSettings }: FontSettingsPanelProps & { editorMeasureLimit: number | null }) {
  const isHorizontalWriting = settings.writingMode === "horizontal-tb";
  const editorMeasureKey = isHorizontalWriting
    ? "editorMeasureHorizontal"
    : "editorMeasureVertical";
  const editorMeasureValue = isHorizontalWriting
    ? settings.editorMeasureHorizontal
    : settings.editorMeasureVertical;
  const editorMeasurePx = editorMeasureLimit === null
    ? null
    : Math.round((editorMeasureLimit * editorMeasureValue) / 100);
  return (
    <>
      <label>
        <span>本文フォント</span>
        <SettingsFontSelect
          value={settings.editorFontFamily}
          systemFonts={systemFonts}
          onChange={(value) => onUpdateSettings("editorFontFamily", value)}
        />
      </label>
      <label>
        <span>見出し・太字フォント</span>
        <select
          value={settings.headingFontSource}
          onChange={(event) =>
            onUpdateSettings(
              "headingFontSource",
              event.target.value as EditorSettings["headingFontSource"],
            )
          }
        >
          <option value="body">本文フォントを使う</option>
          <option value="custom">別フォントを指定</option>
        </select>
      </label>
      {settings.headingFontSource === "custom" && (
        <label>
          <span>見出し・太字の指定フォント</span>
          <SettingsFontSelect
            value={settings.headingFontFamily}
            systemFonts={systemFonts}
            onChange={(value) => onUpdateSettings("headingFontFamily", value)}
          />
        </label>
      )}
      <label>
        <span>プロット表示フォント</span>
        <select
          value={settings.plotFontSource}
          onChange={(event) =>
            onUpdateSettings(
              "plotFontSource",
              event.target.value as EditorSettings["plotFontSource"],
            )
          }
        >
          <option value="editor">本文フォント</option>
          <option value="ui">UIフォント</option>
        </select>
      </label>
      <label>
        <span>本文方向</span>
        <select
          value={settings.writingMode}
          onChange={(event) =>
            onUpdateSettings(
              "writingMode",
              event.target.value as EditorSettings["writingMode"],
            )
          }
        >
          <option value="vertical-rl">縦書き</option>
          <option value="horizontal-tb">横書き</option>
        </select>
      </label>
      <label>
        <span>編集表示</span>
        <select
          value={settings.editorDisplayMode}
          onChange={(event) =>
            onUpdateSettings(
              "editorDisplayMode",
              event.target.value as EditorSettings["editorDisplayMode"],
            )
          }
        >
          <option value="continuous">連続表示</option>
          <option value="paged">ページ表示</option>
        </select>
      </label>
      {settings.editorDisplayMode === "paged" && (
        <label>
          <span>ページ送り</span>
          <select
            value={settings.pageFlowDirection}
            onChange={(event) =>
              onUpdateSettings(
                "pageFlowDirection",
                event.target.value as EditorSettings["pageFlowDirection"],
              )
            }
          >
            <option value="horizontal-rtl">横（右から左）</option>
            <option value="vertical">縦（上から下）</option>
          </select>
        </label>
      )}
      <div className="modalFormGrid">
        <label>
          <span>文字サイズ</span>
          <BoundedNumberInput
            min={12}
            max={24}
            step={1}
            value={settings.fontSize}
            onChange={(value) => onUpdateSettings("fontSize", value)}
          />
        </label>
        <label>
          <span>行間</span>
          <BoundedNumberInput
            min={1.4}
            max={2.4}
            step={0.05}
            value={settings.lineHeight}
            onChange={(value) => onUpdateSettings("lineHeight", value)}
          />
        </label>
      </div>
      <label className="rangeSetting">
        <span>
          文字表示幅（{isHorizontalWriting ? "横幅" : "縦幅"}）{" "}
          {editorMeasureValue}%
          {editorMeasurePx !== null && `（${editorMeasurePx}px）`}
        </span>
        <input
          min={EDITOR_MEASURE_PERCENT_MIN}
          max={EDITOR_MEASURE_PERCENT_MAX}
          step="1"
          type="range"
          value={editorMeasureValue}
          onChange={(event) =>
            onUpdateSettings(editorMeasureKey, Number(event.target.value))
          }
        />
      </label>
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
      <label className="checkSetting">
        <input
          checked={settings.countWhitespace}
          type="checkbox"
          onChange={(event) => onUpdateSettings("countWhitespace", event.target.checked)}
        />
        <span>文字数に空白を含める</span>
      </label>
    </>
  );
}
