import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { canWrapInlineSelection, type EditorSelectionSnapshot } from "../../editor/selectionEdits";
import { customNotationSpecs } from "../../editor/editorNotationActions";
import type { ThenPluginCommand } from "../../plugins/types";
import type { ThenPluginRuntimeHostHandle } from "../../plugins/PluginRuntimeHost";
import { AppIcon } from "../layout/AppIcon";
import { useEditorContextMenuLayout } from "./useEditorContextMenuLayout";
import "./EditorContextMenu.css";

export type EditorContextMenuState = EditorSelectionSnapshot & { x: number; y: number };

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

type Group = "notation" | "line" | "plugin";
type Item = { id: string; label: string; disabled?: boolean; title?: string; run: () => void };

export function EditorContextMenu({
  editorContextMenu, editorContextMenuRef, pluginSelectionCommands, pluginRuntimeHostRef,
  copyEditorSelection, cutEditorSelection, pasteIntoEditorSelection, handTextToAi,
  closeEditorContextMenu, openRubyNotationModal, applyInlineNotation, clearSelectionNotation,
  openDirectionNotationModal, openManuscriptTidy,
}: EditorContextMenuProps) {
  const [openGroup, setOpenGroup] = useState<Group | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const focusChild = useRef(false);
  const menuId = useId();
  const layout = useEditorContextMenuLayout(editorContextMenuRef, editorContextMenu.x, editorContextMenu.y, openGroup);
  const hasSelection = editorContextMenu.from !== editorContextMenu.to;
  const canWrap = canWrapInlineSelection(editorContextMenu);
  const items = {
    cut: { id: "cut", label: "切り取り", disabled: !hasSelection, run: () => void cutEditorSelection(editorContextMenu) },
    copy: { id: "copy", label: "コピー", disabled: !hasSelection, run: () => void copyEditorSelection(editorContextMenu) },
    paste: { id: "paste", label: "貼り付け", run: () => void pasteIntoEditorSelection(editorContextMenu) },
    ruby: { id: "ruby", label: "ルビ...", disabled: !canWrap, title: customNotationSpecs[0].syntax, run: () => openRubyNotationModal(editorContextMenu) },
    tcy: { id: "tcy", label: "縦中横", disabled: !canWrap, title: customNotationSpecs[1].syntax, run: () => { if (applyInlineNotation(editorContextMenu, "tcy")) closeEditorContextMenu(); } },
    emphasis: { id: "emphasis", label: "圏点", disabled: !canWrap, title: customNotationSpecs[2].syntax, run: () => { if (applyInlineNotation(editorContextMenu, "emphasis")) closeEditorContextMenu(); } },
    clear: { id: "clear", label: "記法をクリア", title: "選択範囲または行の独自記法を外します", run: () => clearSelectionNotation(editorContextMenu) },
    direction: { id: "direction", label: "文章方向...", title: customNotationSpecs[3].syntax, run: () => openDirectionNotationModal(editorContextMenu) },
    tidy: { id: "tidy", label: "原稿を整える...", run: () => openManuscriptTidy(editorContextMenu) },
    ai: { id: "ai", label: "AIに渡す", disabled: !hasSelection, run: () => { handTextToAi(editorContextMenu.text); closeEditorContextMenu(); } },
  } satisfies Record<string, Item>;
  const groups: Record<Group, { label: string; items: Item[] }> = {
    notation: { label: "独自記法", items: [items.ruby, items.tcy, items.emphasis, items.clear] },
    line: { label: "行の操作", items: [items.direction, items.tidy] },
    plugin: { label: "プラグイン", items: pluginSelectionCommands.map(command => ({
      id: `${command.pluginId}:${command.id}`, label: command.title,
      run: () => { pluginRuntimeHostRef.current?.executeCommand(command.pluginId, command.id); closeEditorContextMenu(); },
    })) },
  };
  const groupKeys: Group[] = hasSelection && pluginSelectionCommands.length ? ["notation", "line", "plugin"] : ["notation", "line"];
  const cancelClose = () => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); closeTimer.current = null; };
  const deferPointerChange = (change: () => void) => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => { closeTimer.current = null; change(); }, 180);
  };
  const open = (group: Group, keyboard = false) => {
    cancelClose();
    if (keyboard && group === openGroup && layout.subReady) {
      layout.submenuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
      focusChild.current = false;
    } else {
      focusChild.current = keyboard;
      setOpenGroup(group);
    }
  };
  const closeChild = (restoreFocus = false) => {
    cancelClose();
    if (restoreFocus && openGroup) layout.triggerRefs.current[openGroup]?.focus();
    focusChild.current = false;
    setOpenGroup(null);
  };
  const hoverGroup = (group: Group) => {
    if (openGroup && openGroup !== group) deferPointerChange(() => { focusChild.current = false; setOpenGroup(group); });
    else open(group);
  };

  useEffect(() => () => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); }, []);
  useLayoutEffect(() => { cancelClose(); setOpenGroup(null); focusChild.current = false; }, [editorContextMenu]);
  useLayoutEffect(() => {
    if (layout.ready) mainRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [editorContextMenu, layout.ready]);
  useLayoutEffect(() => {
    if (openGroup && layout.subReady && focusChild.current) {
      layout.submenuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
      focusChild.current = false;
    }
  }, [openGroup, layout.subReady, layout.submenuRef]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      if (openGroup) closeChild(true); else closeEditorContextMenu();
      return;
    }
    if (event.key === "Tab") { closeEditorContextMenu(); return; }
    if (!target) return;
    const toolbar = target.closest('[role="toolbar"]');
    const panel = toolbar ?? target.closest('[role="menu"]');
    const buttons = [...(panel?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const index = buttons.indexOf(target);
    let next: number | null = null;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else if ((toolbar && event.key === "ArrowRight") || (!toolbar && event.key === "ArrowDown")) next = (index + 1) % buttons.length;
    else if ((toolbar && event.key === "ArrowLeft") || (!toolbar && event.key === "ArrowUp")) next = (index - 1 + buttons.length) % buttons.length;
    else if (toolbar && event.key === "ArrowDown") {
      event.preventDefault(); mainRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); return;
    } else if (event.key === "ArrowRight" && target.dataset.group) {
      event.preventDefault(); event.stopPropagation(); open(target.dataset.group as Group, true); return;
    } else if (event.key === "ArrowLeft" && panel === layout.submenuRef.current) {
      event.preventDefault(); event.stopPropagation(); closeChild(true); return;
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); event.stopPropagation(); target.click(); return;
    }
    if (next !== null && buttons.length) { event.preventDefault(); event.stopPropagation(); buttons[next]?.focus(); }
  };

  const renderItem = (item: Item) => <button key={item.id} type="button" role="menuitem" className="editorMenuItem"
    disabled={item.disabled} title={item.title} onClick={item.run}><span>{item.label}</span></button>;
  const active = openGroup && groupKeys.includes(openGroup) ? groups[openGroup] : null;
  return (
    <div ref={editorContextMenuRef} className="editorContextMenu editorContextMenuComposite" style={layout.rootStyle}
      onKeyDown={handleKeyDown} onPointerEnter={cancelClose}
      onPointerLeave={() => deferPointerChange(() => setOpenGroup(null))}>
      <div className="editorMenuPanel editorMenuToolbar" role="toolbar" aria-label="選択範囲の操作" onPointerEnter={() => deferPointerChange(() => setOpenGroup(null))}>
        {([items.cut, items.copy, items.paste] as Item[]).map(item => <button key={item.id} type="button"
          aria-label={item.label} title={item.label} disabled={item.disabled} onClick={item.run}>
          <AppIcon name={item.id as "cut" | "copy" | "paste"} />
        </button>)}
        <button type="button" aria-label="ルビ" title="ルビ" disabled={items.ruby.disabled} onClick={items.ruby.run}>ルビ</button>
        <button type="button" aria-label="縦中横" title="縦中横" disabled={items.tcy.disabled} onClick={items.tcy.run}><span className="editorMenuTcy">12</span></button>
        <button type="button" aria-label="圏点" title="圏点" disabled={items.emphasis.disabled} onClick={items.emphasis.run}><span className="editorMenuEmphasis">圏点</span></button>
      </div>
      <div ref={mainRef} className="editorMenuPanel editorMenuList" role="menu" aria-label="本文メニュー" onScroll={layout.updateLayout}>
        <button type="button" role="menuitem" className="editorMenuItem" disabled={items.ai.disabled} onClick={items.ai.run} onPointerEnter={() => deferPointerChange(() => setOpenGroup(null))}><span>{items.ai.label}</span></button>
        {groupKeys.map(group => <button key={group} ref={element => { layout.triggerRefs.current[group] = element; }}
          type="button" role="menuitem" className="editorMenuItem" data-group={group}
          aria-label={groups[group].label} aria-haspopup="menu" aria-expanded={openGroup === group}
          aria-controls={openGroup === group ? `${menuId}-submenu` : undefined}
          onPointerEnter={() => hoverGroup(group)} onClick={() => open(group, true)}>
          <span>{groups[group].label}</span><span className="editorMenuArrow" aria-hidden="true">›</span>
        </button>)}
      </div>
      {active && <div ref={layout.submenuRef} id={`${menuId}-submenu`} className="editorMenuPanel editorMenuList editorMenuSubmenu"
        role="menu" aria-label={active.label} style={layout.submenuStyle} data-side={layout.side} onPointerEnter={cancelClose}>
        {active.items.map(renderItem)}
      </div>}
    </div>
  );
}
