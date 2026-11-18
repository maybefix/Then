/**
 * BINDER 3-2: 本文のリンクを押したときの流れ（docs/BINDER_LINK_SYNTAX_PLAN.md）。
 * 行き先が1つならそのまま開き、2つ以上なら、どのファイルかと、本文のリンクを
 * 直すかどうかを一緒に選んでもらう。直したら、その場で保存してから開き、
 * 通知の「元に戻す」で直す前の本文へ戻せる。
 *
 * 画面とファイルに触る処理はすべて deps に置き、ここには流れだけを置く
 * （投稿の「ノートにする」と同じ形。`src/posts/postNoteActions.ts`）。
 * deps は一度だけ作ればよい。どの口も、呼ばれたときの値を読む。
 */
import { linkOpenTarget } from "../editor/linkDecorations";
import { type LinkIndex, relativeTo } from "./linkIndex";

/** エディタが渡してくる、押されたリンク。 */
export type ActivatedLink = {
  kind: "name" | "path";
  target: string;
  /** 括弧の中の名前だけを書き換える（`|表示名` と `#見出し` は残す）。 */
  rewriteTarget: (next: string) => void;
};

/** ファイルを持つタブと、その保存前の本文。 */
export type LinkOpenTab = { id: string; path: string; markdown: string; isActive: boolean };

export type LinkOpenDeps = {
  /** いま開いている作品の索引。作品を開いていない・まだ読めていなければ null。 */
  index: () => LinkIndex | null;
  requestOption: (options: {
    title: string;
    message: string;
    options: Array<{ id: string; label: string; description?: string }>;
  }) => Promise<string | null>;
  showToast: (message: string, action?: { label: string; onClick: () => void } | null) => void;
  /** そのファイルをタブで開く。 */
  openFile: (path: string) => Promise<void>;
  /** その id のタブ。id を省くと本文に出ているタブ。ファイルを持たない・閉じていれば null。 */
  tab: (id?: string) => LinkOpenTab | null;
  /** そのタブを、いまの本文で、遅延保存を待たずに保存する。 */
  save: (tab: LinkOpenTab) => Promise<unknown>;
  // ここから下は 3-1 の改名の書き換えと共通の口（App の documentWrite）。
  readFile: (path: string) => Promise<{ content: string; contentHash: string | null }>;
  writeFile: (path: string, content: string, expectedHash: string | null) => Promise<unknown>;
  applyToActiveTab: (tab: { id: string; path: string }, text: string) => void;
  applyToBackgroundTab: (tab: { id: string; path: string }, text: string) => Promise<void>;
};

/** 一覧に出す選択肢の id。`<操作>:<候補の番号>`。 */
function optionId(action: "open" | "fix", index: number): string {
  return `${action}:${index}`;
}

export function createLinkOpenActions(deps: LinkOpenDeps) {
  /**
   * 直す前の本文へ戻す。直したあとに書き足されていたり、外で書き換えられて
   * いれば戻さない（`after` は直した直後の本文）。
   */
  const undoFix = async (tab: LinkOpenTab, before: string, after: string, target: string) => {
    const restored = await (async () => {
      const open = deps.tab(tab.id);
      if (open) {
        if (open.markdown !== after) return false;
        if (open.isActive) deps.applyToActiveTab(open, before);
        else await deps.applyToBackgroundTab(open, before);
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
    const index = deps.index();
    if (!index) return;
    const { path, choices } = linkOpenTarget(index, link);
    if (path) {
      await deps.openFile(path);
      return;
    }
    if (choices.length < 2) return;
    const chosen = await deps.requestOption({
      title: "リンクの行き先",
      message: `[[${link.target}]]`,
      options: choices.flatMap((choice, at) => [
        {
          id: optionId("open", at),
          label: `「${choice.name}」を開く`,
          description: relativeTo(index.rootPath, choice.path) ?? choice.path,
        },
        { id: optionId("fix", at), label: `リンクを「${choice.name}」に直して開く` },
      ]),
    });
    if (!chosen) return;
    const [action, at] = chosen.split(":");
    const choice = choices[Number(at)];
    if (!choice) return;
    let undo: (() => void) | null = null;
    if (action === "fix") {
      const before = deps.tab();
      link.rewriteTarget(choice.name);
      // 直したらすぐ別のファイルを開くので、遅延保存（0.7秒）を待たずに書く。
      // 待つと、タブが入れ替わったところで取り消されて残らない。
      const fixed = deps.tab();
      if (fixed) await deps.save(fixed).catch(() => undefined);
      if (before && fixed && fixed.id === before.id && fixed.markdown !== before.markdown) {
        undo = () => void undoFix(fixed, before.markdown, fixed.markdown, link.target);
      }
    }
    await deps.openFile(choice.path);
    // 通知はファイルを開いたあとに出す。開いたときの通知が後から来て、
    // 「元に戻す」の通知を押し流してしまうため。
    if (undo) {
      deps.showToast(`リンクを「${choice.name}」に直しました`, { label: "元に戻す", onClick: undo });
    }
  };

  return { activate };
}
