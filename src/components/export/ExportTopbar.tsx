import { useEffect, useRef, useState, type ReactNode } from "react";

export type ExportPurpose = "print" | "submission";
export type ExportMobileTab = "files" | "settings" | "preview";

export type ExportMenuItem = { label: string; onSelect: () => void; disabled?: boolean } | "separator";

const BackIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>;
const MoreIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>;

// 書き出し画面の上部バー。チェックポイント画面と同じ並び（戻る・題・切り替え／
// 状態・⋯・主ボタン）で、印刷用と投稿用の両方がこれを使う。
export function ExportTopbar({ embedded, purpose, onPurpose, purposeLocked, status, statusTone, menu, primary, onClose, activeTab, onTab }: {
  embedded: boolean;
  purpose: ExportPurpose;
  onPurpose: (purpose: ExportPurpose) => void;
  purposeLocked: boolean;
  status: ReactNode;
  statusTone?: "ok" | "error";
  menu: ExportMenuItem[];
  primary: ReactNode;
  onClose: () => void;
  activeTab: ExportMobileTab;
  onTab: (tab: ExportMobileTab) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [menuOpen]);

  return <>
    <header className="stTopbar exTopbar">
      <button type="button" className="stBack" onClick={onClose}><BackIcon/>{embedded ? "本文へ戻る" : "閉じる"}</button>
      <h1>書き出し</h1>
      <div className="stSeg" role="group" aria-label="出力用途">
        <button type="button" aria-pressed={purpose === "print"} disabled={purposeLocked} onClick={() => onPurpose("print")}>印刷・文書</button>
        <button type="button" aria-pressed={purpose === "submission"} disabled={purposeLocked} onClick={() => onPurpose("submission")}>投稿用テキスト</button>
      </div>
      <span className="exSpacer"/>
      <span className={`exStatus${statusTone ? ` ${statusTone}` : ""}`} role={statusTone === "error" ? "alert" : "status"}>{status}</span>
      <div className="exActions" ref={menuRef}>
        {menu.length > 0 && <button type="button" className="stBtnIcon" aria-label="その他の操作" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreIcon/></button>}
        {primary}
        {menuOpen && <div className="stMenu" role="menu">
          {menu.map((item, index) => item === "separator"
            ? <div key={index} className="stMenuSep" role="separator"/>
            : <button key={item.label} type="button" role="menuitem" disabled={item.disabled} onClick={() => { setMenuOpen(false); item.onSelect(); }}>{item.label}</button>)}
        </div>}
      </div>
    </header>
    <nav className="exTabs stSeg" aria-label="書き出し画面">
      {(["files", "preview", "settings"] as const).map((tab) => (
        <button key={tab} type="button" aria-pressed={activeTab === tab} onClick={() => onTab(tab)}>
          {tab === "files" ? "ファイル" : tab === "settings" ? "設定" : "プレビュー"}
        </button>
      ))}
    </nav>
  </>;
}
