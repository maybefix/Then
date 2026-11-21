// Canvas をどこに出すか（BINDER 4-3、確認1の 2・4）。キャンバスはメイン画面の中央に出し、別ウィンドウは
// 「別ウィンドウで開く」で移す。同じボードを中央と別ウィンドウの2か所で直すと後から書いたほうが勝つので、
// 別ウィンドウが開いているあいだは、中央には出さずに別ウィンドウを使う。React には依存しない。

/** メニューの「キャンバス」を選んだときにすること。 */
export type CanvasModeChoice = "focus-window" | "resume-center" | "open-center";

export function chooseCanvasMode(state: { windowOpen: boolean; hasCenterBoard: boolean }): CanvasModeChoice {
  if (state.windowOpen) return "focus-window";
  return state.hasCenterBoard ? "resume-center" : "open-center";
}

export type CanvasMoveHost = {
  /** メイン画面を本文へ戻す（中央のキャンバスが外れ、外れるときに待っている保存を順番待ちへ渡す）。 */
  showBody: () => void;
  /** 外れるのを待つ。 */
  afterUnmount: () => Promise<void>;
  /** ボードの保存の順番待ちを書き切る。外の変更などで書けなければ失敗する。 */
  flushBoards: () => Promise<void>;
  /** ノート・原稿への書き戻しを書き切る。 */
  flushFileWrites: () => Promise<void>;
  /** 中央のキャンバスへ戻す（書けなかったとき。開き直したキャンバスで選んでもらう）。 */
  showCanvas: () => void;
  /** 中央に覚えていたボードを忘れる（次に中央へ出すときは読み直す）。 */
  forgetCenter: () => void;
  openWindow: (boardId: string | null) => Promise<void>;
};

/** 中央のキャンバスを別ウィンドウへ移す。待っている保存を書き切ってから開く。移せたら true。 */
export async function moveCanvasToWindow(host: CanvasMoveHost, boardId: string | null): Promise<boolean> {
  host.showBody();
  await host.afterUnmount();
  try {
    await host.flushBoards();
  } catch {
    host.showCanvas();
    return false;
  }
  await host.flushFileWrites().catch(() => {});
  host.forgetCenter();
  await host.openWindow(boardId);
  return true;
}
