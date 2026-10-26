// 待っている遅延保存の一覧。遅延保存は、待ち始めるときに「今すぐ書く」処理を名前で載せ、
// 書いたら（またはやめたら）外す。閉じる前に flushPendingSaves で、まだ書いていないものを書く。
type PendingSave = () => unknown;

const pendingSaves = new Map<string, PendingSave>();

// 書き切る処理が別の遅延保存を始めることがある（カーソル位置 → アプリ状態）。
// React が描画し直して次の保存を載せるのを待って、空になるまで繰り返す。
const MAX_FLUSH_ROUNDS = 4;

export function setPendingSave(key: string, save: PendingSave) {
  pendingSaves.set(key, save);
}

/** `save` を渡すと、同じ名前で後から載った保存は外さない。 */
export function clearPendingSave(key: string, save?: PendingSave) {
  if (!save || pendingSaves.get(key) === save) pendingSaves.delete(key);
}

export async function flushPendingSaves() {
  for (let round = 0; round < MAX_FLUSH_ROUNDS && pendingSaves.size > 0; round++) {
    const saves = [...pendingSaves.values()];
    pendingSaves.clear();
    await Promise.allSettled(saves.map((save) => Promise.resolve().then(save)));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
