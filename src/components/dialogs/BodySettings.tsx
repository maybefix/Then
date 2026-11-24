import type { EditorSettings } from "../../types";
import {
  EDITOR_MEASURE_PERCENT_MAX,
  EDITOR_MEASURE_PERCENT_MIN,
} from "../../types";
import { BoundedNumberInput } from "./BoundedNumberInput";
import { SettingsGroup } from "./SettingsGroup";
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
  const manuscript = settings.manuscript;
  const manuscriptOn = manuscript.layoutMode === "manuscript";
  return (
    <>
      <SettingsGroup title="フォント">
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
      </SettingsGroup>
      <SettingsGroup title="文字組みとページ">
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
            {manuscriptOn && <small className="dialogFieldHint">原稿用紙では「原稿用紙の文字サイズ」を使用します</small>}
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
            disabled={manuscriptOn}
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
      </SettingsGroup>
    </>
  );
}
