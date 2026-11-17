/**
 * BINDER 3-2: 本文のリンクを押したときの流れ（docs/BINDER_LINK_SYNTAX_PLAN.md）。
 * 行き先が1つならそのまま開き、2つ以上なら、どのファイルかと、本文のリンクを
 * 直すかどうかを一緒に選んでもらう。直したら、その場で保存してから開き、
 * 通知の「元に戻す」で直す前の本文へ戻せる。
 *
 * 画面とファイルに触る処理はすべて deps に置き、ここには流れだけを置く
 * （投稿の「ノートにする」と同じ形。`src/posts/postNoteActions.ts`）。
 * 通知のボタンはあとで押されるので、値は呼ばれたときの deps から読む。
 */
import type { MutableRefObject } from "react";
import { linkOpenTarget } from "../editor/linkDecorations";
import type { LinkIndex } from "./linkIndex";

/** エディタが渡してくる、押されたリンク。 */
export type ActivatedLink = {
  kind: "name" | "path";
  target: string;
  /** 括弧の中の名前だけを書き換える（`|表示名` と `#見出し` は残す）。 */
  rewriteTarget: (next: string) => void;
};

/** 本文に出ているタブと、その保存前の本文。 */
export type LinkOpenTab = { id: string; path: string; markdown: string };

export type LinkOpenDeps = {
  /** いま開いている作品のフォルダ。作品を開いていなければ null。 */
  workRoot: () => string | null;
  /** その作品の索引。まだ読めていなければ null。 */
  index: (rootPath: string) => LinkIndex | null;
  /** 作品のフォルダからのパス（一覧に出す文字）。 */
  relativePath: (rootPath: string, path: string) => string;
  requestOption: (options: {
    title: string;
    message: string;
    options: Array<{ id: string; label: string; description?: string }>;
  }) => Promise<string | null>;
  showToast: (message: string, action?: { label: string; onClick: () => void } | null) => void;
  /** そのファイルをタブで開く。 */
  openFile: (path: string) => Promise<void>;
  /** 本文に出ているタブ（ファイルを持たないタブなら null）。 */
  activeTab: () => LinkOpenTab | null;
  /** 本文に出ているタブを、遅延保存を待たずに保存する。 */
  saveActive: () => Promise<void>;
  /** その id のタブ（閉じていれば null）。 */
  openTab: (id: string) => { path: string; markdown: string; isActive: boolean } | null;
  /** ディスクのファイルを読む（読んだときのハッシュつき）。 */
  readFile: (path: string) => Promise<{ content: string; contentHash: string | null }>;
  /** 読んだときのハッシュを付けてファイルへ書く。 */
  writeFile: (path: string, content: string, expectedHash: string | null) => Promise<unknown>;
  /** 本文に出ているタブの本文を差し替える（自動保存に乗る）。 */
  applyToActiveTab: (tab: { id: string; path: string }, text: string) => void;
  /** 裏のタブの本文を差し替えて、そのタブの保存に回す。 */
  applyToBackgroundTab: (tab: { id: string; path: string }, text: string) => Promise<void>;
};

/** 一覧に出す選択肢の id。`<操作>:<候補の番号>`。 */
function optionId(action: "open" | "fix", index: number): string {
  return `${action}:${index}`;
}

export function createLinkOpenActions(depsRef: MutableRefObject<LinkOpenDeps>) {
  /**
   * 直す前の本文へ戻す。直したあとに書き足されていたり、外で書き換えられて
   * いれば戻さない（`after` は直した直後の本文）。
   */
  const undoFix = async (tab: LinkOpenTab, before: string, after: string, target: string) => {
    const deps = depsRef.current;
    const restored = await (async () => {
      const open = deps.openTab(tab.id);
      if (open) {
        if (open.markdown !== after) return false;
        if (open.isActive) deps.applyToActiveTab(tab, before);
        else await deps.applyToBackgroundTab(tab, before);
        return true;
      }
      // タブを閉じていれば、読んだときのハッシュを付けてファイルへ書く（置換と同じ作法）。
      const file = await deps.readFile(tab.path).catch(() => null);
      if (!file || file.content !== after) return false;
      await deps.writeFile(tab.path, before, file.contentHash).catch(() => undefined);
      return true;
    })();
    deps.showToast(
      restored
        ? `リンクを「${target}」に戻しました`
        : "リンクを戻しませんでした（そのファイルが変わっています）",
    );
  };

  /** 押されたリンクを開く。行き先が決まらなければ選んでもらう。 */
  const activate = async (link: ActivatedLink) => {
    const deps = depsRef.current;
    const root = deps.workRoot();
    if (!root) return;
    const { path, choices } = linkOpenTarget(deps.index(root), link);
    if (path) {
      await deps.openFile(path);
      return;
    }
    if (choices.length < 2) return;
    const chosen = await deps.requestOption({
      title: "リンクの行き先",
      message: `[[${link.target}]]`,
      options: choices.flatMap((choice, index) => [
        {
          id: optionId("open", index),
          label: `「${choice.name}」を開く`,
          description: deps.relativePath(root, choice.path),
        },
        { id: optionId("fix", index), label: `リンクを「${choice.name}」に直して開く` },
      ]),
    });
    if (!chosen) return;
    const [action, at] = chosen.split(":");
    const choice = choices[Number(at)];
    if (!choice) return;
    const after = depsRef.current;
    if (action === "fix") {
      const tab = after.activeTab();
      const before = tab?.markdown ?? null;
      link.rewriteTarget(choice.name);
      // 直したらすぐ別のファイルを開くので、遅延保存（0.7秒）を待たずに書く。
      // 待つと、タブが入れ替わったところで取り消されて残らない。
      await after.saveActive();
      const fixed = after.activeTab();
      if (tab && before !== null && fixed && fixed.id === tab.id && fixed.markdown !== before) {
        after.showToast(`リンクを「${choice.name}」に直しました`, {
          label: "元に戻す",
          onClick: () => void undoFix(tab, before, fixed.markdown, link.target),
        });
      }
    }
    await depsRef.current.openFile(choice.path);
  };

  return { activate };
}
