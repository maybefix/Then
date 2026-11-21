import { useRef, type ReactNode } from "react";
import { moveDraftCard, toggleDraftCard, type DraftCapture } from "../../intermediateDraft";

/**
 * カードの並べ替えの一覧（つまみでドラッグ・番号・抜粋・除外・上下）。中間稿のペインと、
 * 「この順で原稿を作る」（BINDER 4-4）の画面が使う。見た目は intermediateDraft.css（`.intermediateDraftPane` の下）。
 */
type Props = {
  capture: DraftCapture | null | undefined;
  /** カードの文章（ID ごと）。 */
  texts: Map<string, string>;
  /** 並べ替え・除外ができるか。 */
  editable: boolean;
  onChange: (next: DraftCapture) => void;
  /** 除外のボタンの名前の後ろ半分（「カード1を」に続く）。 */
  excludeLabel: string;
  includeLabel: string;
  isSelected?: (id: string) => boolean;
  /** 抜粋を押したとき。ないときは押せない見た目にする。 */
  onSelect?: (id: string) => void;
  /** 抜粋の前に出す名前。 */
  nameOf?: (id: string) => string;
};

export default function DraftOrderList({
  capture, texts, editable, onChange, excludeLabel, includeLabel, isSelected, onSelect, nameOf,
}: Props) {
  const dragged = useRef<string | null>(null);
  const excluded = new Set(capture?.excluded ?? []);
  const move = (id: string, target: string) => {
    if (capture) onChange(moveDraftCard(capture, id, target));
  };
  return <ol className="draftOrderList" aria-label="カード順">
    {capture?.order.map((id, index) => {
      const text = texts.get(id);
      const name = nameOf?.(id);
      const excerpt = text?.replace(/\s+/g, " ").slice(0, 160) || "空のカード";
      return <li key={id}
        className={`${isSelected?.(id) ? "isSelected" : ""}${excluded.has(id) ? " isExcluded" : ""}`.trim()}
        onDragOver={(event) => { if (editable && dragged.current) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
        onDrop={(event) => { if (editable && dragged.current) { event.preventDefault(); event.stopPropagation(); move(dragged.current, id); dragged.current = null; } }}>
        <button type="button" className="draftDragHandle" aria-label={`カード${index + 1}をドラッグで移動`}
          disabled={!editable} draggable={editable}
          onDragStart={(event) => { if (!editable) return; dragged.current = id; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-then-draft-card", id); }}
          onDragEnd={() => { dragged.current = null; }}><GripIcon /></button>
        <span className="draftOrderNumber">{index + 1}</span>
        {onSelect
          ? <button type="button" className="draftExcerpt" onClick={() => onSelect(id)}
            title={text || "空のカード"}>{excerpt}</button>
          : <span className="draftExcerpt" title={text || "空のカード"}>
            {name && <strong className="draftCardName">{name}</strong>}{excerpt}
          </span>}
        {editable && <button type="button" className="draftExcludeButton"
          aria-label={`カード${index + 1}を${excluded.has(id) ? includeLabel : excludeLabel}`}
          title={excluded.has(id) ? includeLabel : excludeLabel}
          onClick={() => capture && onChange(toggleDraftCard(capture, id))}>
          <ExcludeIcon restore={excluded.has(id)} />
        </button>}
        {editable && capture && <div className="draftMoveActions">
          <button type="button" aria-label={`カード${index + 1}を上へ`} disabled={index === 0}
            onClick={() => move(id, capture.order[index - 1])}><ChevronIcon direction="up" /></button>
          <button type="button" aria-label={`カード${index + 1}を下へ`} disabled={index === capture.order.length - 1}
            onClick={() => move(id, capture.order[index + 1])}><ChevronIcon direction="down" /></button>
        </div>}
      </li>;
    })}
    {!capture?.order.length && <li className="draftEmpty">テキストカードがありません。</li>}
  </ol>;
}

export function DraftIcon({ children }: { children: ReactNode }) {
  return <svg className="draftIcon" viewBox="0 0 16 16" fill="none" aria-hidden="true">{children}</svg>;
}
function GripIcon() {
  return <DraftIcon><circle cx="5.5" cy="4" r=".8" fill="currentColor" stroke="none"/><circle cx="10.5" cy="4" r=".8" fill="currentColor" stroke="none"/><circle cx="5.5" cy="8" r=".8" fill="currentColor" stroke="none"/><circle cx="10.5" cy="8" r=".8" fill="currentColor" stroke="none"/><circle cx="5.5" cy="12" r=".8" fill="currentColor" stroke="none"/><circle cx="10.5" cy="12" r=".8" fill="currentColor" stroke="none"/></DraftIcon>;
}
function ChevronIcon({ direction }: { direction: "up" | "down" }) {
  return <DraftIcon><path d={direction === "up" ? "m4.5 9.5 3.5-3 3.5 3" : "m4.5 6.5 3.5 3 3.5-3"} /></DraftIcon>;
}
function ExcludeIcon({ restore }: { restore: boolean }) {
  return <DraftIcon><circle cx="8" cy="8" r="5.25"/><path d="M5.5 8h5" />{restore && <path d="M8 5.5v5" />}</DraftIcon>;
}
