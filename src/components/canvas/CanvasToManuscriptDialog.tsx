import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CanvasManuscriptFolders, CanvasTextNode } from "../../canvasTypes";
import { cardManuscriptName, type CardOrder } from "../../canvasToManuscript";
import ManuscriptOrderList from "./ManuscriptOrderList";

/**
 * 「この順で原稿を作る」の並べ替えの画面（BINDER 4-4）。一覧は ManuscriptOrderList。
 * 作る先のフォルダを選び、「カードごとに原稿を作る」か「1本の原稿につなげる」（名前を聞いてから作る）。
 */
type Props = {
  capture: CardOrder;
  cards: CanvasTextNode[];
  folders: CanvasManuscriptFolders | undefined;
  boardName: string;
  busy: boolean;
  onChange: (next: CardOrder) => void;
  onCancel: () => void;
  onCreateCards: (folder: string) => void;
  onCreateJoined: (folder: string, name: string) => void;
};

/** ファイル名に使えない文字を除く（Rust の create_text_file が断る文字）。 */
export const manuscriptFileName = (name: string) => name.replace(/[\\/:*?"<>|]/g, "").replace(/^\.+/, "").trim();

export default function CanvasToManuscriptDialog({
  capture, cards, folders, boardName, busy, onChange, onCancel, onCreateCards, onCreateJoined,
}: Props) {
  const [folder, setFolder] = useState(folders?.current ?? "");
  const [joinedName, setJoinedName] = useState<string | null>(null);
  // 開いたらフォーカスを画面の中へ移す。外（body）のままだと、Escape と画面の中のキーが Canvas の操作に届く。
  const sectionRef = useRef<HTMLElement | null>(null);
  useEffect(() => { sectionRef.current?.focus({ preventScroll: true }); }, []);
  const byId = new Map(cards.map((card) => [card.id, card]));
  const texts = new Map(cards.map((card) => [card.id, card.text]));
  const excluded = new Set(capture.excluded ?? []);
  const count = capture.order.filter((id) => !excluded.has(id) && byId.has(id)).length;
  const folderChoices = folders?.folders ?? [{ path: "", label: "" }];
  const submitJoined = (event: FormEvent) => {
    event.preventDefault();
    const name = manuscriptFileName(joinedName ?? "");
    if (name && !busy) onCreateJoined(folder, name);
  };
  return <div className="canvasModalBackdrop" role="presentation">
    <section ref={sectionRef} tabIndex={-1} className="canvasManuscriptModal" role="dialog"
      aria-modal="true" aria-label="この順で原稿を作る"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !busy) onCancel();
      }}>
      <header>
        <h2>この順で原稿を作る</h2>
        <button type="button" aria-label="閉じる" disabled={busy} onClick={onCancel}>×</button>
      </header>
      <ManuscriptOrderList capture={capture} texts={texts} editable={!busy && joinedName === null} onChange={onChange}
        excludeLabel="原稿から除外" includeLabel="原稿に戻す"
        nameOf={(id) => { const card = byId.get(id); return card ? cardManuscriptName(card) : ""; }} />
      <label>
        <span>作る先</span>
        <select value={folder} disabled={busy} onChange={(event) => setFolder(event.target.value)}>
          {folderChoices.map((choice) => <option key={choice.path} value={choice.path}>{choice.label}</option>)}
        </select>
      </label>
      {joinedName === null ? <footer>
        <button type="button" disabled={busy} onClick={onCancel}>キャンセル</button>
        <span className="canvasManuscriptActions">
          <button type="button" disabled={busy || count === 0} onClick={() => setJoinedName(manuscriptFileName(boardName))}>
            1本の原稿につなげる
          </button>
          <button type="button" className="manuscriptOrderPrimary" disabled={busy || count === 0} onClick={() => onCreateCards(folder)}>
            カードごとに原稿を作る
          </button>
        </span>
      </footer> : <form className="canvasManuscriptJoined" onSubmit={submitJoined}>
        <label>
          <span>名前</span>
          <input autoFocus value={joinedName} disabled={busy} onChange={(event) => setJoinedName(event.target.value)} />
        </label>
        <footer>
          <button type="button" disabled={busy} onClick={() => setJoinedName(null)}>戻る</button>
          <button type="submit" disabled={busy || !manuscriptFileName(joinedName)}>原稿を作る</button>
        </footer>
      </form>}
    </section>
  </div>;
}
