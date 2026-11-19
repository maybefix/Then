// 「つながり」(BINDER 3-4, docs/BINDER_CONNECTIONS_PLAN.md): where the shown
// document is used. For a note: the manuscripts that link to it (原稿に登場),
// the notes that link to it (リンク元), the posts it was made from (元の投稿)
// and the boards it is placed on (置かれているボード). For a manuscript: the
// files that link to it and the boards. Reads only; each item opens its place.
//
// What is shown is put together by src/links/connections.ts, only when the
// index, the shown document, the posts or the boards change; typing in the
// body changes none of them.
import { memo, useMemo } from "react";
import type { LinkIndex } from "../../links/linkIndex";
import {
  buildConnections,
  decidedCount,
  fileSummary,
  type BoardReferences,
  type ConnectionFile,
} from "../../links/connections";
import { dayKey, dayLabel, timeLabel, type Post } from "../../posts/postModel";
import "./connections.css";

export type ConnectionsPaneProps = {
  /** The open work's link index; null until it has been read, and outside the desktop app. */
  index: LinkIndex | null;
  /** Changes whenever what the index holds may have changed. */
  version: number;
  /** The shown document, when it is a text file in the open work; else null (the pane is empty). */
  document: { path: string; isNote: boolean } | null;
  posts: readonly Post[];
  boards: readonly BoardReferences[];
  onOpenFile: (path: string) => void;
  onOpenPost: (post: Post) => void;
  onOpenBoard: (boardId: string, nodeId: string) => void;
};

function ManuscriptIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3h12v18H6z" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>;
}
function NoteIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /><path d="M10 12h5M10 16h5" /></svg>;
}
function PostIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z" /></svg>;
}
function BoardIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M7 8h4v4H7zM13 12h4v4h-4z" /></svg>;
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="connectionsSection" aria-label={title}>
      <div className="connectionsSectionHead">
        <h3 className="connectionsSectionTitle">{title}</h3>
        <span className="connectionsSectionCount">{count}</span>
      </div>
      {children}
    </section>
  );
}

function FileList({ files, onOpen }: { files: ConnectionFile[]; onOpen: (path: string) => void }) {
  if (files.length === 0) return null;
  return (
    <ul className="connectionsList">
      {files.map((file) => {
        const sub = fileSummary(file);
        return (
          <li key={file.path} className="connectionsItem" data-undecided={file.undecided ? "true" : undefined}>
            <button type="button" className="connectionsOpen" title={file.relative} onClick={() => onOpen(file.path)}>
              {file.isNote ? <NoteIcon /> : <ManuscriptIcon />}
              <span className="connectionsText">
                <span className="connectionsName">{file.name}</span>
                {(sub.decided || sub.undecided) && (
                  <span className="connectionsSub">
                    {sub.decided}
                    {sub.decided && sub.undecided ? " · " : ""}
                    {sub.undecided && <span className="connectionsUndecided">{sub.undecided}</span>}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function firstLine(body: string): string {
  return body.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
}

function ConnectionsPaneInner({ index, version, document, posts, boards, onOpenFile, onOpenPost, onOpenBoard }: ConnectionsPaneProps) {
  const path = document?.path ?? null;
  const isNote = document?.isNote ?? false;
  const connections = useMemo(
    () => (index && path ? buildConnections({ index, path, isNote, posts, boards }) : null),
    // `version` is what says the index changed; the index object stays the same.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, version, path, isNote, posts, boards],
  );

  if (!document || !connections) return <div className="connectionsPane" aria-label="つながり" />;

  return (
    <div className="connectionsPane" aria-label="つながり">
      {connections.kind === "note" && (
        <Section title="原稿に登場" count={decidedCount(connections.manuscripts)}>
          <FileList files={connections.manuscripts} onOpen={onOpenFile} />
        </Section>
      )}
      <Section title="リンク元" count={decidedCount(connections.sources)}>
        <FileList files={connections.sources} onOpen={onOpenFile} />
      </Section>
      {connections.kind === "note" && (
        <Section title="元の投稿" count={connections.posts.length}>
          {connections.posts.length > 0 && (
            <ul className="connectionsList">
              {connections.posts.map((post) => (
                <li key={post.id} className="connectionsItem">
                  <button type="button" className="connectionsOpen" onClick={() => onOpenPost(post)}>
                    <PostIcon />
                    <span className="connectionsText">
                      <span className="connectionsName">{firstLine(post.body)}</span>
                      <span className="connectionsSub">{[dayLabel(dayKey(post.at)), timeLabel(post.at)].filter(Boolean).join(" ")}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
      <Section title="置かれているボード" count={connections.boards.length}>
        {connections.boards.length > 0 && (
          <ul className="connectionsList">
            {connections.boards.map((board) => (
              <li key={board.id} className="connectionsItem">
                <button type="button" className="connectionsOpen" onClick={() => onOpenBoard(board.id, board.nodeId)}>
                  <BoardIcon />
                  <span className="connectionsText">
                    <span className="connectionsName">{board.name}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

export const ConnectionsPane = memo(ConnectionsPaneInner);

export default ConnectionsPane;
