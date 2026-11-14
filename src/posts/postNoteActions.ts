/**
 * 投稿 →「ノートにする」（BINDER 2-3、docs/BINDER_POST_TO_NOTE_PLAN.md）の、画面の側の流れ。
 * 名前を聞く → Rust でノートを作って投稿にリンクを書く → 一覧を読み直してノートモードで開く →
 * 通知の「元に戻す」でリンクを外し、作ったときのままのノートはゴミ箱へ移す。
 * 通知のボタンはあとで押されるので、値は呼ばれたときの deps（App が描画のたびに入れ替える）から読む。
 */
import type { MutableRefObject } from "react";
import type { ProjectFolder } from "../types";
import { isSamePath } from "../utils/projectTree";
import {
  joinWorkPath,
  noteLabel,
  noteNameFromBody,
  noteTextFor,
  noteThread,
  type MadeNote,
  type Post,
} from "./postModel";
import type { PostStream } from "./usePostStream";

type ToastAction = { label: string; onClick: () => void };

export type PostNoteDeps = {
  stream: PostStream;
  projectFolder: ProjectFolder | null;
  requestInput: (options: {
    title: string;
    label: string;
    initialValue: string;
    confirmLabel: string;
    placeholder?: string;
  }) => Promise<string | null>;
  showToast: (message: string, action?: ToastAction | null) => void;
  refreshProjectFolder: (folderPath: string) => Promise<ProjectFolder | null>;
  /** いまの作品のファイルをタブで開く。 */
  openFile: (path: string) => Promise<void>;
  /** 別の作品に切り替えてから、そのファイルを開く。 */
  openFileInWork: (workRoot: string, path: string) => Promise<void>;
  /** いま開いているファイル。 */
  activeFilePath: () => string | null;
  /** そのファイルのタブに、まだ保存していない変更があるか。 */
  isFileDirty: (path: string) => boolean;
  /** 確認なしでゴミ箱へ移す。移せたら true。直前のタブの切り替えが画面に入ってから移す（App が受け持つ）。 */
  trashFile: (path: string) => Promise<boolean>;
};

export function createPostNoteActions(depsRef: MutableRefObject<PostNoteDeps>) {
  const undoMakeNote = async (made: MadeNote, ids: string[], name: string, previousPath: string | null) => {
    const { stream, isFileDirty, refreshProjectFolder, projectFolder, trashFile, showToast, activeFilePath, openFile } = depsRef.current;
    // 作ったあとに書き足していれば（保存前の変更も）、ノートは残してリンクだけ外す。
    const dirty = isFileDirty(made.notePath);
    const unlinked = await stream.unlinkNote(ids, made.notePath, made.noteHash);
    if (!unlinked) return;
    if (!unlinked.noteUnchanged || dirty || !projectFolder) {
      showToast(`投稿を受信箱に戻しました（ノート「${name}」は残しました）`);
      return;
    }
    // ノートを開いたままなら、作る前に開いていたファイルへ戻ってから消す（開いているファイルを消すと、
    // 削除は一覧の最初のファイルを開き直すため）。
    const active = activeFilePath();
    if (previousPath && active && isSamePath(active, made.notePath)) await openFile(previousPath);
    await refreshProjectFolder(projectFolder.path);
    if (await trashFile(made.notePath)) {
      showToast(`投稿を受信箱に戻し、ノート「${name}」をゴミ箱へ移しました`);
    }
  };

  /** 投稿と、その下の返信をノートにする。ライブラリ直下（作品がない）では何もしない。 */
  const makeNote = async (post: Post) => {
    const { stream, projectFolder, requestInput, refreshProjectFolder, openFile, showToast, activeFilePath } = depsRef.current;
    if (!projectFolder || !stream.work) return;
    const previousPath = activeFilePath();
    const posts = noteThread(stream.posts, post.id);
    if (posts.length === 0) return;
    const entered = await requestInput({
      title: "ノートにする",
      label: "ノートの名前",
      initialValue: noteNameFromBody(post.body),
      confirmLabel: "ノートを作る",
    });
    const name = entered?.trim();
    if (!name) return;
    const made = await depsRef.current.stream.makeNote(posts, name, noteTextFor(name, posts));
    if (!made) return;
    // 素材フォルダを作ったときも、一覧を読み直せば素材の段に出て、ノートモードで開く。
    await refreshProjectFolder(projectFolder.path);
    await openFile(made.notePath);
    const label = noteLabel(made.notePath);
    const ids = posts.map((entry) => entry.id);
    showToast(`ノート「${label}」を作りました`, {
      label: "元に戻す",
      onClick: () => void undoMakeNote(made, ids, label, previousPath),
    });
  };

  /** 札を押したとき。ないノートは開かない。別の作品のノートなら、その作品に切り替えて開く。 */
  const openNote = async (post: Post) => {
    const { projectFolder, openFile, openFileInWork } = depsRef.current;
    const note = post.note;
    if (!note?.exists || !note.workRoot) return;
    const path = joinWorkPath(note.workRoot, note.path);
    if (projectFolder && isSamePath(projectFolder.path, note.workRoot)) {
      await openFile(path);
      return;
    }
    await openFileInWork(note.workRoot, path);
  };

  return { makeNote, openNote };
}

