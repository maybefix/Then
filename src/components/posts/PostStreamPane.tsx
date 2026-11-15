import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { IdeaComposerBox } from "./IdeaComposerBox";
import {
  arrangePosts,
  countInbox,
  dayLabel,
  groupByDay,
  isFromWork,
  noteLabel,
  postFilterLabels,
  postFilters,
  timeLabel,
  type Post,
  type PostFilter,
} from "../../posts/postModel";
import type { PostStream } from "../../posts/usePostStream";

type PostStreamPaneProps = {
  stream: PostStream;
  filter: PostFilter;
  onFilterChange: (filter: PostFilter) => void;

  /** 「ノートにする」（2-3）。ないとき（ライブラリ直下）はボタンを出さない。 */
  onMakeNote?: (post: Post) => void;
  /** 札を押してノートを開く。 */
  onOpenNote?: (post: Post) => void;
};

function PlusIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>;
}
function ReplyIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 7 4 12l5 5" /><path d="M4 12h10a6 6 0 0 1 6 6v1" /></svg>;
}
function FileAwayIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 13h5l1.5 3h3L15 13h5" /><path d="M6 5h12l2 8v6H4v-6z" /><path d="m9 9 3 3 3-3" /></svg>;
}
function ReturnToInboxIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 13h5l1.5 3h3L15 13h5" /><path d="M6 5h12l2 8v6H4v-6z" /><path d="m9 11 3-3 3 3" /></svg>;
}
function NoteIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /><path d="M10 12h5M10 16h5" /></svg>;
}
function MoreIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="6" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="18" cy="12" r="1" /></svg>;
}

export function PostStreamPane({ stream, filter, onFilterChange, onMakeNote, onOpenNote }: PostStreamPaneProps) {
  const { scoped, available, posts, work, add, editBody, setFiled, remove, refresh } = stream;
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const composingRef = useRef(false);

  // 右のペインを開いたときに、外で書き換えられていれば読み直す。
  useEffect(() => { void refresh(); }, [refresh]);
  // 作品を開いていない（ライブラリ直下）ときは「この作品」がないので、受信箱で見せる。
  const effectiveFilter: PostFilter = filter === "work" && !work ? "inbox" : filter;

  useEffect(() => {
    if (!menuId) return;
    const close = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".postMenuHost")) setMenuId(null);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setMenuId(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape, true);
    };
  }, [menuId]);

  const days = useMemo(
    () => groupByDay(arrangePosts(posts, effectiveFilter, work)),
    [effectiveFilter, posts, work],
  );
  const inboxCount = useMemo(() => countInbox(posts), [posts]);

  const submitOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>, action: () => void) => {
    if (event.key !== "Enter" || event.shiftKey || composingRef.current || event.nativeEvent.isComposing) return;
    event.preventDefault();
    action();
  };
  const post = async () => {
    const body = text;
    if (!body.trim()) return;
    if (await add(body)) setText((current) => (current === body ? "" : current));
  };
  const reply = async (parentId: string) => {
    const body = replyText;
    if (!body.trim()) return;
    if (await add(body, parentId)) {
      setReplyText("");
      setReplyTo(null);
    }
  };
  const saveBody = async (target: Post, element: HTMLElement) => {
    const next = element.textContent ?? "";
    if (!next.trim()) {
      element.textContent = target.body;
      return;
    }
    if (next === target.body) return;
    // 外で直されていて書けなかったときは、直した文を入力欄に移して残す。
    if (!(await editBody(target, next))) setText((current) => (current.trim() ? `${current}\n${next}` : next));
  };

  const chips = (
    <div className="ideaChipsRow">
      <div className="ideaChips" aria-label="絞り込み">
        {postFilters.filter((value) => value !== "work" || work).map((value) => (
          <button
            key={value}
            type="button"
            className={`ideaChip ${effectiveFilter === value ? "isActive" : ""}`}
            aria-pressed={effectiveFilter === value}
            onClick={() => onFilterChange(value)}
          >
            {postFilterLabels[value]}
            {value === "inbox" && inboxCount > 0 && <span className="postChipCount">{inboxCount}</span>}
          </button>
        ))}
      </div>
    </div>
  );

  const renderPost = (row: ReturnType<typeof arrangePosts>[number]) => {
    const { post: entry, depth, context } = row;
    const otherWork = entry.work && effectiveFilter !== "work" && !isFromWork(entry, work) ? entry.work.name : null;
    return (
      <article
        key={entry.id}
        className={`ideaFragment postItem ${depth > 0 ? "isReply" : ""} ${context ? "isContext" : ""}`}
        style={depth > 0 ? { marginLeft: `${Math.min(depth, 3) * 16}px` } : undefined}
        data-post-id={entry.id}
      >
        <div className="postMain">
          <div
            className="ideaFragmentBody postBody"
            contentEditable={available}
            spellCheck={false}
            suppressContentEditableWarning
            onBlur={(event) => void saveBody(entry, event.currentTarget)}
          >
            {entry.body}
          </div>
          {/* 今の Idea の断片と同じく、左に時刻（と、ほかの作品なら作品名）、右に操作。 */}
          <div className="ideaFragmentFoot postFoot">
            <span className="postHead">
              <time className="ideaFragmentDate" dateTime={entry.at}>{timeLabel(entry.at)}</time>
              {otherWork && <span className="postWork">{otherWork}</span>}
              {entry.note && (() => {
                const note = entry.note;
                const label = noteLabel(note.path);
                // いまの作品のノートでなければ、作品名も添える。
                const shown = note.workName && note.work !== work?.id ? `${note.workName} / ${label}` : label;
                return (
                  <button
                    type="button"
                    className={`postNoteTag ${note.exists ? "" : "isMissing"}`}
                    disabled={!note.exists}
                    title={shown}
                    aria-label={`ノート「${shown}」を開く`}
                    onClick={() => onOpenNote?.(entry)}
                  >
                    <NoteIcon /><span>{shown}</span>
                  </button>
                );
              })()}
            </span>
            <span className="ideaFragmentBtns postMenuHost">
              {onMakeNote && !entry.noted && (
                <button className="postNoteBtn" type="button" onClick={() => onMakeNote(entry)}>ノートにする</button>
              )}
              <button className="ideaMiniIcon" type="button" aria-label="返信" title="返信" onClick={() => { setReplyTo((current) => current === entry.id ? null : entry.id); setReplyText(""); }}><ReplyIcon /></button>
              {/* ノートにした投稿は受信箱に入らないので、外す・戻すを出さない（確認1の 3）。 */}
              {entry.noted ? null : entry.filed
                ? <button className="ideaMiniIcon" type="button" aria-label="受信箱に戻す" title="受信箱に戻す" onClick={() => void setFiled(entry, false)}><ReturnToInboxIcon /></button>
                : <button className="ideaMiniIcon" type="button" aria-label="受信箱から外す" title="受信箱から外す" onClick={() => void setFiled(entry, true)}><FileAwayIcon /></button>}
              <button className="ideaMiniIcon" type="button" aria-label="その他の操作" title="その他の操作" aria-haspopup="menu" aria-expanded={menuId === entry.id} onClick={() => setMenuId((current) => current === entry.id ? null : entry.id)}><MoreIcon /></button>
              {menuId === entry.id && (
                <div className="referenceContextMenu ideaReferenceMenu ideaFragmentMenu" role="menu" aria-label="その他の操作">
                  <button type="button" role="menuitem" className="dangerMenuItem" onClick={() => { setMenuId(null); void remove(entry); }}>削除</button>
                </div>
              )}
            </span>
          </div>
          {replyTo === entry.id && (
            <div className="postReply">
              <IdeaComposerBox text={replyText}>
                <textarea
                  autoFocus
                  value={replyText}
                  rows={2}
                  aria-label="返信"
                  onChange={(event) => setReplyText(event.target.value)}
                  onCompositionStart={() => (composingRef.current = true)}
                  onCompositionEnd={() => (composingRef.current = false)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") { event.preventDefault(); setReplyTo(null); return; }
                    submitOnEnter(event, () => void reply(entry.id));
                  }}
                />
                <div className="ideaCaptureControls">
                  <span className="ideaCaptureSpacer" />
                  <button className="ideaPrimaryBtn" type="button" disabled={!replyText.trim()} onClick={() => void reply(entry.id)}>返信</button>
                </div>
              </IdeaComposerBox>
            </div>
          )}
        </div>
      </article>
    );
  };

  // フォルダを開いていない（ファイルを1本だけ開いた）ときは投稿を書く場所がないので、投稿の欄を出さない（BINDER 2-1）。
  if (!scoped) return <section className="ideaPane postStreamPane" aria-label="アイデア" />;

  return (
    <section className="ideaPane postStreamPane" aria-label="アイデア">
      <div className="ideaViewTop">
        <div className="ideaCapture">
          <IdeaComposerBox text={text}>
            <span className="ideaCapturePlus" aria-hidden="true"><PlusIcon /></span>
            <textarea
              value={text}
              rows={2}
              aria-label="投稿"
              disabled={!available}
              onChange={(event) => setText(event.target.value)}
              onCompositionStart={() => (composingRef.current = true)}
              onCompositionEnd={() => (composingRef.current = false)}
              onKeyDown={(event) => submitOnEnter(event, () => void post())}
            />
            <div className="ideaCaptureControls">
              <span className="ideaCaptureSpacer" />
              <button className="ideaPrimaryBtn" type="button" disabled={!available || !text.trim()} onClick={() => void post()}><PlusIcon /><span>投稿</span></button>
            </div>
          </IdeaComposerBox>
        </div>
        {chips}
      </div>
      <div className="ideaScroll postScroll">
        {days.map((day) => (
          <section key={day.key || "unknown"} className="postDay" aria-label={dayLabel(day.key) || undefined}>
            {dayLabel(day.key) && <h3 className="postDayLabel">{dayLabel(day.key)}</h3>}
            {day.rows.map(renderPost)}
          </section>
        ))}
      </div>
    </section>
  );
}
