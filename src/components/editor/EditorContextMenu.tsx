import type { RefObject } from "react";
import { canWrapInlineSelection, type EditorSelectionSnapshot } from "../../editor/selectionEdits";
import { customNotationSpecs } from "../../editor/editorNotationActions";
import type { ThenPluginCommand } from "../../plugins/types";
import type { ThenPluginRuntimeHostHandle } from "../../plugins/PluginRuntimeHost";
import { getScaledFixedMenuPosition } from "../../utils/contextMenuPosition";

const EDITOR_CONTEXT_MENU_WIDTH = 236;
const EDITOR_CONTEXT_MENU_HEIGHT = 322;

export type EditorContextMenuState = EditorSelectionSnapshot & {
  x: number;
  y: number;
};

type EditorContextMenuProps = {
  editorContextMenu: EditorContextMenuState;
  editorContextMenuRef: RefObject<HTMLDivElement>;
  pluginSelectionCommands: ThenPluginCommand[];
  pluginRuntimeHostRef: RefObject<ThenPluginRuntimeHostHandle>;
  copyEditorSelection: (selection: EditorSelectionSnapshot | null) => Promise<void>;
  cutEditorSelection: (selection: EditorSelectionSnapshot | null) => Promise<void>;
  pasteIntoEditorSelection: (selection: EditorSelectionSnapshot | null) => Promise<void>;
  handTextToAi: (text: string) => void;
  closeEditorContextMenu: () => void;
  openRubyNotationModal: (selection: EditorSelectionSnapshot | null) => void;
  applyInlineNotation: (selection: EditorSelectionSnapshot, notation: "ruby" | "tcy" | "emphasis", argument?: string) => boolean;
  clearSelectionNotation: (selection: EditorSelectionSnapshot | null) => void;
  openDirectionNotationModal: (selection: EditorSelectionSnapshot | null) => void;
  openManuscriptTidy: (selection: EditorSelectionSnapshot | null) => void;
};

export function EditorContextMenu({
  editorContextMenu,
  editorContextMenuRef,
  pluginSelectionCommands,
  pluginRuntimeHostRef,
  copyEditorSelection,
  cutEditorSelection,
  pasteIntoEditorSelection,
  handTextToAi,
  closeEditorContextMenu,
  openRubyNotationModal,
  applyInlineNotation,
  clearSelectionNotation,
  openDirectionNotationModal,
  openManuscriptTidy,
}: EditorContextMenuProps) {
  return (
    <div
      ref={editorContextMenuRef}
      className="editorContextMenu"
      role="menu"
      style={getScaledFixedMenuPosition(editorContextMenu.x, editorContextMenu.y, {
        width: EDITOR_CONTEXT_MENU_WIDTH,
        height: EDITOR_CONTEXT_MENU_HEIGHT + (
          pluginSelectionCommands.length > 0
            ? 31 + pluginSelectionCommands.length * 30
            : 0
        ),
      })}
    >
      <div className="contextMenuSection">
        <button
          type="button"
          role="menuitem"
          disabled={editorContextMenu.from === editorContextMenu.to}
          onClick={() => void copyEditorSelection(editorContextMenu)}
        >
          コピー
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={editorContextMenu.from === editorContextMenu.to}
          onClick={() => void cutEditorSelection(editorContextMenu)}
        >
          切り取り
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => void pasteIntoEditorSelection(editorContextMenu)}
        >
          貼り付け
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={editorContextMenu.from === editorContextMenu.to}
          onClick={() => {
            handTextToAi(editorContextMenu.text);
            closeEditorContextMenu();
          }}
        >
          AIに渡す
        </button>
      </div>
      <div className="contextMenuDivider" role="separator" />
      {pluginSelectionCommands.length > 0 && editorContextMenu.from !== editorContextMenu.to && (
        <>
          <div className="contextMenuSection">
            <span className="contextMenuLabel">プラグイン</span>
            {pluginSelectionCommands.map((command) => (
              <button
                type="button"
                role="menuitem"
                key={`${command.pluginId}:${command.id}`}
                onClick={() => {
                  pluginRuntimeHostRef.current?.executeCommand(
                    command.pluginId,
                    command.id,
                  );
                  closeEditorContextMenu();
                }}
              >
                {command.title}
              </button>
            ))}
          </div>
          <div className="contextMenuDivider" role="separator" />
        </>
      )}
      <div className="contextMenuSection">
        <span className="contextMenuLabel">独自記法</span>
        <button
          type="button"
          role="menuitem"
          disabled={!canWrapInlineSelection(editorContextMenu)}
          title={customNotationSpecs[0].syntax}
          onClick={() => openRubyNotationModal(editorContextMenu)}
        >
          ルビ...
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={!canWrapInlineSelection(editorContextMenu)}
          title={customNotationSpecs[1].syntax}
          onClick={() => {
            if (applyInlineNotation(editorContextMenu, "tcy")) {
              closeEditorContextMenu();
            }
          }}
        >
          縦中横
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={!canWrapInlineSelection(editorContextMenu)}
          title={customNotationSpecs[2].syntax}
          onClick={() => {
            if (applyInlineNotation(editorContextMenu, "emphasis")) {
              closeEditorContextMenu();
            }
          }}
        >
          圏点
        </button>
        <button
          type="button"
          role="menuitem"
          title="選択範囲または行の独自記法を外します"
          onClick={() => clearSelectionNotation(editorContextMenu)}
        >
          記法をクリア
        </button>
      </div>
      <div className="contextMenuDivider" role="separator" />
      <div className="contextMenuSection">
        <span className="contextMenuLabel">行指示</span>
        <button
          type="button"
          role="menuitem"
          title={customNotationSpecs[3].syntax}
          onClick={() => openDirectionNotationModal(editorContextMenu)}
        >
          文章方向...
        </button>
      </div>
      <div className="contextMenuDivider" role="separator" />
      <div className="contextMenuSection">
        <span className="contextMenuLabel">整形</span>
        <button
          type="button"
          role="menuitem"
          title="段落頭の字下げと「！」「？」のあとの空きを入れます"
          onClick={() => openManuscriptTidy(editorContextMenu)}
        >
          原稿を整える...
        </button>
      </div>
    </div>
  );
}
