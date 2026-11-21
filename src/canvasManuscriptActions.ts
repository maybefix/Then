/**
 * 「この順で原稿を作る」（BINDER 4-4、docs/BINDER_CANVAS_TO_MANUSCRIPT_PLAN.md）の、メイン画面の側の流れ。
 * キャンバスの頼みを受けて原稿を作り、中身を書き、作る先のフォルダの後ろに一覧の順で並べ、一覧を読み直す。
 * 「元に戻す」は2つの口（キャンバスの Ctrl+Z と、メイン画面の通知）から来るが、1回分につき一度だけ働く。
 * 作ったときから変わっていない原稿（ハッシュが同じで、タブに未保存の変更もない）だけをゴミ箱へ移す。
 * 通知のボタンはあとで押されるので、値は呼ばれたときの deps（App が描画のたびに入れ替える）から読む。
 */
import type { MutableRefObject } from "react";
import type { CanvasManuscriptRequest, CanvasManuscriptResult } from "./canvasTypes";
import type { ProjectFolder, TextDocument } from "./types";
import { getFolderChildren, isSamePath, toProjectRelativePath } from "./utils/projectTree";

type ToastAction = { label: string; onClick: () => void };

export type CanvasManuscriptDeps = {
  projectFolder: ProjectFolder | null;
  /** 作品のフォルダと、そこからの相対パスをつなぐ。 */
  absolutePath: (rootPath: string, relative: string) => string;
  /** 空の原稿を作る（同じ名前があれば「-2」）。 */
  createFile: (folderPath: string, name: string) => Promise<TextDocument>;
  saveFile: (path: string, content: string, expectedHash: string | null) => Promise<TextDocument>;
  readFile: (path: string) => Promise<TextDocument>;
  /** フォルダの中の並びを書く（通知は出さない）。 */
  saveOrder: (rootPath: string, folderPath: string, orderedPaths: string[]) => Promise<void>;
  refreshProjectFolder: (folderPath: string) => Promise<ProjectFolder | null>;
  openFile: (path: string) => Promise<void>;
  activeFilePath: () => string | null;
  isFileDirty: (path: string) => boolean;
  /** 確認なしでゴミ箱へ移す。移せたら true。 */
  trashFile: (path: string) => Promise<boolean>;
  showToast: (message: string, action?: ToastAction | null) => void;
  /** 通知の「元に戻す」で、キャンバスに置き換えを外してもらう。外せたら true。 */
  revertOnCanvas: (conversionId: string) => Promise<boolean>;
};

type MadeFile = { path: string; hash: string | null };
type Conversion = { rootPath: string; files: MadeFile[]; undone: boolean };

const manuscriptLabel = (path: string) => (path.split(/[\\/]/).pop() ?? path).replace(/\.(txt|md)$/i, "");

export function createCanvasManuscriptActions(depsRef: MutableRefObject<CanvasManuscriptDeps>) {
  const conversions = new Map<string, Conversion>();
  let content: Promise<typeof import("./canvasManuscriptContent")> | null = null;
  const loadContent = () => (content ??= import("./canvasManuscriptContent"));

  /** 原稿を1本作って中身を書く。中身を書けなかったら、作ったばかりの空の原稿はゴミ箱へ戻す。 */
  const makeFile = async (folderPath: string, name: string, text: string): Promise<MadeFile> => {
    const { createFile, saveFile } = depsRef.current;
    const created = await createFile(folderPath, name);
    try {
      const saved = await saveFile(created.path, text, created.contentHash ?? null);
      return { path: saved.path, hash: saved.contentHash ?? null };
    } catch (error) {
      await depsRef.current.refreshProjectFolder(folderPath).catch(() => null);
      await depsRef.current.trashFile(created.path).catch(() => false);
      throw error;
    }
  };

  /** 作る先のフォルダの今の並びの後ろに、作った順で足す。 */
  const appendToOrder = async (rootPath: string, folderPath: string, paths: string[]) => {
    const { projectFolder, saveOrder } = depsRef.current;
    if (paths.length === 0 || !projectFolder) return;
    const current = getFolderChildren(projectFolder, folderPath)
      .map((entry) => entry.path)
      .filter((path) => !paths.some((made) => isSamePath(made, path)));
    await saveOrder(rootPath, folderPath, [...current, ...paths]);
  };

  /** 作ったときから変わっていない原稿をゴミ箱へ移す。書き足してあれば残す。 */
  const trashUnchanged = async (rootPath: string, files: MadeFile[], previousPath: string | null = null) => {
    const { isFileDirty, readFile, refreshProjectFolder, activeFilePath, openFile } = depsRef.current;
    const unchanged: string[] = [];
    let kept = 0;
    for (const file of files) {
      let same = !isFileDirty(file.path);
      if (same) {
        try {
          same = (await readFile(file.path)).contentHash === file.hash;
        } catch {
          // 外で消された・動かされた原稿は、ゴミ箱へ移すものがない。
          continue;
        }
      }
      if (same) unchanged.push(file.path);
      else kept += 1;
    }
    // 開いている原稿を消すと、削除は一覧の最初のファイルを開き直すので、作る前に開いていたファイルへ先に戻る（2-3 と同じ）。
    const active = activeFilePath();
    if (previousPath && active && unchanged.some((path) => isSamePath(path, active))) await openFile(previousPath);
    await refreshProjectFolder(rootPath);
    let trashed = 0;
    for (const path of unchanged) {
      if (await depsRef.current.trashFile(path)) trashed += 1;
    }
    return { trashed, kept };
  };

  const undoMessage = (trashed: number, kept: number) =>
    kept > 0
      ? `カードを元に戻しました（原稿 ${kept} 本は書き足してあるので残しました）`
      : `カードを元に戻し、原稿 ${trashed} 本をゴミ箱へ移しました`;

  /** 通知の「元に戻す」（カードごと）。キャンバスで置き換えを外せたときだけ、原稿をゴミ箱へ移す。 */
  const undoCardsFromToast = async (conversionId: string) => {
    const conversion = conversions.get(conversionId);
    if (!conversion || conversion.undone) return;
    if (!(await depsRef.current.revertOnCanvas(conversionId))) {
      depsRef.current.showToast("Canvas でそのボードを開いていないため、元に戻せませんでした");
      return;
    }
    if (conversion.undone) return;
    conversion.undone = true;
    const { trashed, kept } = await trashUnchanged(conversion.rootPath, conversion.files);
    depsRef.current.showToast(undoMessage(trashed, kept));
  };

  const createCards = async (request: Extract<CanvasManuscriptRequest, { kind: "cards" }>): Promise<CanvasManuscriptResult> => {
    const { perCardManuscript } = await loadContent();
    const { absolutePath, refreshProjectFolder, showToast } = depsRef.current;
    const folderPath = request.folder ? absolutePath(request.rootPath, request.folder) : request.rootPath;
    const made: { id: string; path: string }[] = [];
    const files: MadeFile[] = [];
    const failed: string[] = [];
    for (const card of request.cards) {
      try {
        const file = await makeFile(folderPath, card.name, perCardManuscript(card.name, card.text));
        files.push(file);
        made.push({ id: card.id, path: toProjectRelativePath(request.rootPath, file.path) });
      } catch {
        failed.push(card.id);
      }
    }
    if (files.length) {
      await appendToOrder(request.rootPath, folderPath, files.map((file) => file.path)).catch(() => {});
      await refreshProjectFolder(folderPath);
      conversions.set(request.conversionId, { rootPath: request.rootPath, files, undone: false });
      showToast(`原稿を ${files.length} 本作りました`, {
        label: "元に戻す",
        onClick: () => void undoCardsFromToast(request.conversionId),
      });
    }
    return { kind: "cards", made, failed };
  };

  const createJoined = async (request: Extract<CanvasManuscriptRequest, { kind: "joined" }>): Promise<CanvasManuscriptResult> => {
    const { joinedManuscript, sourceCardRef } = await loadContent();
    const { absolutePath, refreshProjectFolder, openFile, showToast, activeFilePath } = depsRef.current;
    const folderPath = request.folder ? absolutePath(request.rootPath, request.folder) : request.rootPath;
    const previousPath = activeFilePath();
    const text = joinedManuscript(
      request.name,
      request.cards,
      request.cards.map((card) => sourceCardRef(request.boardName, card.id)),
    );
    const file = await makeFile(folderPath, request.name, text);
    await appendToOrder(request.rootPath, folderPath, [file.path]).catch(() => {});
    await refreshProjectFolder(folderPath);
    await openFile(file.path);
    let undone = false;
    showToast(`原稿「${manuscriptLabel(file.path)}」を作りました`, {
      label: "元に戻す",
      onClick: () => {
        if (undone) return;
        undone = true;
        void trashUnchanged(request.rootPath, [file], previousPath).then(({ trashed }) =>
          depsRef.current.showToast(trashed
            ? `原稿「${manuscriptLabel(file.path)}」をゴミ箱へ移しました`
            : `原稿「${manuscriptLabel(file.path)}」は書き足してあるので残しました`));
      },
    });
    return { kind: "joined", path: toProjectRelativePath(request.rootPath, file.path) };
  };

  /** キャンバスの Ctrl+Z（カードごと）。通知からすでに戻していれば何もしない。 */
  const undoCards = async (conversionId: string): Promise<CanvasManuscriptResult> => {
    const conversion = conversions.get(conversionId);
    if (!conversion || conversion.undone) return { kind: "undo", done: false, trashed: 0, kept: 0 };
    conversion.undone = true;
    const { trashed, kept } = await trashUnchanged(conversion.rootPath, conversion.files);
    depsRef.current.showToast(undoMessage(trashed, kept));
    return { kind: "undo", done: true, trashed, kept };
  };

  const handle = (request: CanvasManuscriptRequest): Promise<CanvasManuscriptResult> => {
    const { projectFolder } = depsRef.current;
    if (!projectFolder || !isSamePath(projectFolder.path, request.rootPath)) {
      return Promise.reject(new Error("この作品を開いていないため、原稿を作れません"));
    }
    if (request.kind === "cards") return createCards(request);
    if (request.kind === "joined") return createJoined(request);
    return undoCards(request.conversionId);
  };

  return { handle };
}
