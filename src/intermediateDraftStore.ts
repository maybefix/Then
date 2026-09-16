import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { normalizeCanvasDocument, type CanvasBoardSummary, type CanvasScope } from "./canvasTypes";
import { draftBoardKey, type DraftBoard, type DraftHistory } from "./intermediateDraft";

const native = () => "__TAURI_INTERNALS__" in window;
const localBoardsKey = (scope: CanvasScope, rootPath: string | null) =>
  `then.canvas-board.${scope}.${rootPath ?? "global"}`;

export async function listDraftBoards(scope: CanvasScope, rootPath: string | null): Promise<CanvasBoardSummary[]> {
  if (native()) return invoke("list_canvas_boards", { scope, rootPath });
  const boards = JSON.parse(localStorage.getItem(localBoardsKey(scope, rootPath)) ?? "{}");
  return Object.entries(boards).map(([id, raw]) => {
    const board = normalizeCanvasDocument(raw, id, scope);
    return { id, name: board.then!.name, path: id, scope, updatedAt: board.then!.updatedAt,
      nodeCount: board.nodes.length, edgeCount: board.edges.length };
  });
}

export async function loadDraftBoard(target: DraftBoard) {
  const raw = native() ? await invoke("load_canvas_board", target) :
    JSON.parse(localStorage.getItem(localBoardsKey(target.scope, target.rootPath)) ?? "{}")[target.boardId];
  if (!raw) throw new Error("ボードがありません");
  return normalizeCanvasDocument(raw, target.boardId, target.scope);
}

type Snapshot = { history: DraftHistory | null; status: string; error: string | null };
/** Sessions survive sidebar/mode changes, including an in-flight save or a failed save. */
class DraftSession {
  snapshot: Snapshot = { history: null, status: "読み込み中", error: null };
  listeners = new Set<() => void>();
  timer: ReturnType<typeof setTimeout> | undefined;
  loading: Promise<void> | undefined;
  saving: Promise<void> | undefined;
  dirty = false;
  revision = 0;
  constructor(readonly target: DraftBoard) {}
  recoveryKey() {
    return native() ? `then.draft-recovery.${getCurrentWindow().label}.${draftBoardKey(this.target)}` : null;
  }
  checkpoint() {
    const key = this.recoveryKey();
    if (key) localStorage.setItem(key, JSON.stringify({ history: this.snapshot.history, expectedRevision: this.revision }));
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  publish(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  async load() {
    if (this.dirty || this.saving) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      await Promise.resolve();
      try {
        const history = native() ? await invoke<DraftHistory>("load_intermediate_draft", this.target) :
          JSON.parse(localStorage.getItem(`then.draft.${draftBoardKey(this.target)}`) ?? "null") as DraftHistory | null;
        const next = history ?? { schemaVersion: 1, boardId: this.target.boardId, revision: 0, versions: [] };
        // A local edit may have started while the refresh was in flight.
        if (this.dirty) return;
        this.revision = next.revision;
        const recoveryKey = this.recoveryKey();
        const recovery = recoveryKey ? JSON.parse(localStorage.getItem(recoveryKey) ?? "null") as
          { history: DraftHistory; expectedRevision: number } | null : null;
        if (recovery && recovery.history.boardId === this.target.boardId) {
          if (JSON.stringify(recovery.history.versions) === JSON.stringify(next.versions)) {
            localStorage.removeItem(recoveryKey!);
          } else {
            this.dirty = true;
            this.revision = recovery.expectedRevision;
            this.publish({ history: recovery.history, status: "終了前の未保存内容を復元しました",
              error: next.revision === recovery.expectedRevision ? null : "保存版が更新されています。復元した編集内容をコピーしてから保存版を読み直してください。" });
            if (!this.snapshot.error) this.timer = setTimeout(() => void this.flush(), 400);
            return;
          }
        }
        this.publish({ history: next, status: "保存済み", error: null });
      } catch (error) { this.publish({ status: "読込失敗", error: String(error) }); }
      finally { this.loading = undefined; }
    })();
    return this.loading;
  }
  change(history: DraftHistory) {
    this.dirty = true;
    this.publish({ history, status: "未保存" });
    // Synchronous journal survives a native window closing before the debounced invoke finishes.
    try { this.checkpoint(); } catch (error) { this.publish({ error: `一時保存に失敗しました: ${String(error)}` }); }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 400);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.saving) { await this.saving; if (this.dirty && !this.snapshot.error) return this.flush(); return; }
    if (!this.dirty || !this.snapshot.history) return;
    const history = this.snapshot.history;
    this.publish({ status: "保存中", error: null });
    this.saving = (async () => {
      try {
        let revision: number;
        if (native()) {
          revision = await invoke<number>("save_intermediate_draft", {
            ...this.target, history, expectedRevision: this.revision,
          });
        } else {
          const key = `then.draft.${draftBoardKey(this.target)}`;
          const current = JSON.parse(localStorage.getItem(key) ?? "null") as DraftHistory | null;
          if ((current?.revision ?? 0) !== this.revision) throw new Error("別の画面で更新されています。編集内容をコピーしてから読み直してください。");
          revision = this.revision + 1;
          localStorage.setItem(key, JSON.stringify({ ...history, revision }));
        }
        this.revision = revision;
        this.dirty = this.snapshot.history !== history;
        if (this.dirty) this.checkpoint();
        else {
          const key = this.recoveryKey();
          if (key) localStorage.removeItem(key);
        }
        this.publish({ status: this.dirty ? "未保存" : "保存済み" });
      } catch (error) { this.publish({ status: "保存失敗（編集内容は保持しています）", error: String(error) }); }
    })();
    await this.saving;
    this.saving = undefined;
    if (this.dirty && !this.snapshot.error) await this.flush();
  }
  async discardAndReload() {
    await this.saving;
    clearTimeout(this.timer);
    const key = this.recoveryKey();
    if (key) localStorage.removeItem(key);
    this.dirty = false;
    await this.load();
  }
}

const sessions = new Map<string, DraftSession>();
export async function prepareDraftBoardTrash(target: DraftBoard) {
  const key = draftBoardKey(target);
  const session = sessions.get(key);
  if (session) {
    await session.flush();
    if (session.dirty) throw new Error("中間稿の保存に失敗しています。保存してからボードを削除してください。");
    sessions.delete(key);
  }
}
export function getDraftSession(target: DraftBoard) {
  const key = draftBoardKey(target);
  let session = sessions.get(key);
  if (!session) { session = new DraftSession(target); sessions.set(key, session); }
  return session;
}

window.addEventListener("beforeunload", (event) => {
  if ([...sessions.values()].some((session) => session.dirty || session.saving)) {
    event.preventDefault();
    event.returnValue = "";
    sessions.forEach((session) => void session.flush());
  }
});
