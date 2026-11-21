import { useRef, type ReactNode } from "react";
import { moveOrderedCard, toggleOrderedCard, type CardOrder } from "../../canvasToManuscript";

/**
 * カードの並べ替えの一覧（つまみでドラッグ・番号・名前と抜粋・除外・上下）。「この順で原稿を作る」（BINDER 4-4）の
 * 画面が使う。見た目は canvas.css（`.canvasManuscriptModal` の下）。
 */
type Props = {
  capture: CardOrder;
  /** カードの文章（ID ごと）。 */
  texts: Map<string, string>;
  /** 並べ替え・除外ができるか。 */
  editable: boolean;
  onChange: (next: CardOrder) => void;
  /** 除外のボタンの名前の後ろ半分（「カード1を」に続く）。 */
  excludeLabel: string;
  includeLabel: string;
  /** 抜粋の前に出す名前。 */
  nameOf?: (id: string) => string;
};

export default function ManuscriptOrderList({
  capture, texts, editable, onChange, excludeLabel, includeLabel, nameOf,
}: Props) {
  const dragged = useRef<string | null>(null);
  const excluded = new Set(capture.excluded ?? []);
  const move = (id: string, target: string) => onChange(moveOrderedCard(capture, id, target));
  return <ol className="manuscriptOrderList" aria-label="カード順">
    {capture.order.map((id, index) => {
      const text = texts.get(id);
      const name = nameOf?.(id);
      const excerpt = text?.replace(/s+/g, " ").slice(0, 160) || "空のカード";
      return <li key={id} className={excluded.has(id) ? "isExcluded" : undefined}
        onDragOver={(event) => { if (editable && dragged.current) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
        onDrop={(event) => { if (editable && dragged.current) { event.preventDefault(); event.stopPropagation(); move(dragged.current, id); dragged.current = null; } }}>
        <button type="button" className="manuscriptOrderHandle" aria-label={`カード${index + 1}をドラッグで移動`}
          disabled={!editable} draggable={editable}
          onDragStart={(event) => { if (!editable) return; dragged.current = id; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-then-manuscript-card", id); }}
          onDragEnd={() => { dragged.current = null; }}><GripIcon /></button>
        <span className="manuscriptOrderNumber">{index + 1}</span>
        <span className="manuscriptOrderExcerpt" title={text || "空のカード"}>
          {name && <strong className="manuscriptOrderName">{name}</strong>}{excerpt}
        </span>
        {editable && <button type="button" className="manuscriptOrderExclude"
          aria-label={`カード${index + 1}を${excluded.has(id) ? includeLabel : excludeLabel}`}
          title={excluded.has(id) ? includeLabel : excludeLabel}
          onClick={() => onChange(toggleOrderedCard(capture, id))}>
          <ExcludeIcon restore={excluded.has(id)} />
        </button>}
        {editable && <div className="manuscriptOrderMove">
          <button type="button" aria-label={`カード${index + 1}を上へ`} disabled={index === 0}
            onClick={() => move(id, capture.order[index - 1])}><ChevronIcon direction="up" /></button>
          <button type="button" aria-label={`カード${index + 1}を下へ`} disabled={index === capture.order.length - 1}
            onClick={() => move(id, capture.order[index + 1])}><ChevronIcon direction="down" /></button>
        </div>}
      </li>;
    })}
    {!capture.order.length && <li className="manuscriptOrderEmpty">テキストカードがありません。</li>}
  </ol>;
}

function OrderIcon({ children }: { children: ReactNode }) {
  return <svg className="manuscriptOrderIcon" viewBox="0 0 16 16" fill="none" aria-hidden="true">{children}</svg>;
}
function GripIcon() {
  return <OrderIcon><circle cx="5.5" cy="4" r=".8" fill="currentColor" stroke="none"/><circle cx="10.5" cy="4" r=".8" fill="currentColor" stroke="none"/><circle cx="5.5" cy="8" r=".8" fill="currentColor" stroke="none"/><circle cx="10.5" cy="8" r=".8" fill="currentColor" stroke="none"/><circle cx="5.5" cy="12" r=".8" fill="currentColor" stroke="none"/><circle cx="10.5" cy="12" r=".8" fill="currentColor" stroke="none"/></OrderIcon>;
}
function ChevronIcon({ direction }: { direction: "up" | "down" }) {
  return <OrderIcon><path d={direction === "up" ? "m4.5 9.5 3.5-3 3.5 3" : "m4.5 6.5 3.5 3 3.5-3"} /></OrderIcon>;
}
function ExcludeIcon({ restore }: { restore: boolean }) {
  return <OrderIcon><circle cx="8" cy="8" r="5.25"/><path d="M5.5 8h5" />{restore && <path d="M8 5.5v5" />}</OrderIcon>;
}
