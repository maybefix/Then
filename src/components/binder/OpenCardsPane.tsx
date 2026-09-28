import type {
  BinderCardState,
  IdeaThread,
  ReferenceFileInfo,
} from "../../types";
import { isIdeaBinderCard } from "../../types";
import { normalizedReferenceKey } from "../../ideaReferenceModel";

type OpenCardsPaneProps = {
  cards: BinderCardState[];
  threads: IdeaThread[];
  candidates: ReferenceFileInfo[];
  onFocusCard: (cardId: string) => void;
  onCloseCard: (cardId: string) => void;
  onPinCard: (cardId: string, pinned: boolean) => void;
  onCollapseCard: (cardId: string, collapsed: boolean) => void;
};

const fileName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export function OpenCardsPane({
  cards,
  threads,
  candidates,
  onFocusCard,
  onCloseCard,
  onPinCard,
  onCollapseCard,
}: OpenCardsPaneProps) {
  const files = new Map(candidates.map((file) => [normalizedReferenceKey(file.sourcePath), file]));
  return (
    <section className="openCardsPane" aria-label="開いているカード">
      <div className="openCardsPaneHeader"><strong>開いているカード</strong><span>{cards.length}</span></div>
      {cards.length === 0 ? (
        <p className="openCardsEmpty">開いているカードはありません</p>
      ) : (
        <div className="openCardsList">
          {cards
            .slice()
            .sort((left, right) => right.zIndex - left.zIndex)
            .map((card) => {
              const idea = isIdeaBinderCard(card);
              const thread = idea ? threads.find((entry) => entry.id === card.threadId) : null;
              const fragment = idea
                ? thread?.fragments.find((entry) => entry.id === card.fragmentId)
                : null;
              const file = idea ? null : files.get(normalizedReferenceKey(card.sourcePath));
              const title = idea ? thread?.title ?? "Idea" : file?.name ?? fileName(card.sourcePath);
              const detail = idea ? fragment?.body ?? "削除済み" : file?.kind === "image" ? "画像資料" : file?.kind === "pdf" ? "PDF資料" : "テキスト資料";
              return (
                <article className="openCardsItem" key={card.id}>
                  <button type="button" className="openCardsMain" onClick={() => onFocusCard(card.id)}>
                    <span className={`openCardsKind ${idea ? "idea" : "reference"}`} aria-hidden="true">{idea ? "I" : file?.kind === "image" ? "▧" : file?.kind === "pdf" ? "▤" : "≡"}</span>
                    <span><strong>{title}</strong><small>{detail}</small></span>
                  </button>
                  <div className="openCardsActions">
                    <button type="button" className={card.pinned ? "isActive" : ""} aria-label={card.pinned ? "ピン留めを外す" : "ピン留め"} title={card.pinned ? "ピン留めを外す" : "ピン留め"} onClick={() => onPinCard(card.id, !card.pinned)}>⌖</button>
                    <button type="button" className={card.collapsed ? "isActive" : ""} aria-label={card.collapsed ? "展開" : "折りたたむ"} title={card.collapsed ? "展開" : "折りたたむ"} onClick={() => onCollapseCard(card.id, !card.collapsed)}>−</button>
                    <button type="button" aria-label="閉じる" title="閉じる" onClick={() => onCloseCard(card.id)}>×</button>
                  </div>
                </article>
              );
            })}
        </div>
      )}
    </section>
  );
}
