import assert from "node:assert/strict";
import { build } from "esbuild";

// 待っている遅延保存の一覧（src/pendingSaves.ts）を、実際に動かして確かめる
// （docs/ANCHOR_SAVE_ON_CLOSE_FIX_PLAN.md）。閉じる前に、まだ書いていない保存を書き切る。
const bundled = await build({
  entryPoints: ["src/pendingSaves.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const { setPendingSave, clearPendingSave, flushPendingSaves, schedulePendingSave } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

// 載せた保存を、載せた順に書き、書き終わるのを待つ。書いた後は空になる。
{
  const written = [];
  let release;
  setPendingSave("a", () => written.push("a"));
  setPendingSave("b", () => new Promise((resolve) => { release = () => { written.push("b"); resolve(); }; }));
  let done = false;
  const flushing = flushPendingSaves().then(() => { done = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(written, ["a"]);
  assert.equal(done, false, "flushing must wait for the saves to finish");
  release();
  await flushing;
  assert.deepEqual(written, ["a", "b"]);
  await flushPendingSaves();
  assert.deepEqual(written, ["a", "b"], "a written save must not be written again");
}

// 同じ名前で載せ直すと、新しいほうだけを書く。
{
  const written = [];
  setPendingSave("state", () => written.push("old"));
  setPendingSave("state", () => written.push("new"));
  await flushPendingSaves();
  assert.deepEqual(written, ["new"]);
}

// 外す。保存を渡したときは、同じ名前で後から載った保存を外さない。
{
  const written = [];
  const first = () => written.push("first");
  setPendingSave("x", first);
  clearPendingSave("x", first);
  setPendingSave("y", () => written.push("y-old"));
  const stale = () => written.push("stale");
  clearPendingSave("y", stale);
  setPendingSave("z", () => written.push("z"));
  clearPendingSave("z");
  await flushPendingSaves();
  assert.deepEqual(written, ["y-old"]);
}

// 1つが失敗しても、ほかは書く。
{
  const written = [];
  setPendingSave("fails", () => { throw new Error("disk full"); });
  setPendingSave("rejects", () => Promise.reject(new Error("denied")));
  setPendingSave("ok", () => written.push("ok"));
  await flushPendingSaves();
  assert.deepEqual(written, ["ok"]);
}

// 書き切る処理が次の遅延保存を始めたら（カーソル位置 → アプリ状態）、それも書く。
// 次の保存は、React が描画し直してから（ここでは次のタスクで）載る。
{
  const written = [];
  setPendingSave("cursor", () => {
    written.push("cursor");
    setTimeout(() => setPendingSave("app-state", () => written.push("app-state")), 0);
  });
  await flushPendingSaves();
  assert.deepEqual(written, ["cursor", "app-state"]);
}

// schedulePendingSave: 待ってから書く。閉じる前なら待たずに書き、待っていた分は書かない。取り消せる。
{
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const written = [];
  schedulePendingSave("later", 20, () => written.push("later"));
  await wait(40);
  assert.deepEqual(written, ["later"], "the save must run after the delay");
  await flushPendingSaves();
  assert.deepEqual(written, ["later"], "a save that already ran must not run again");

  schedulePendingSave("now", 1000, () => written.push("now"));
  await flushPendingSaves();
  assert.deepEqual(written, ["later", "now"], "flushing must run a waiting save at once");
  await wait(30);

  const cancel = schedulePendingSave("cancelled", 20, () => written.push("cancelled"));
  cancel();
  await wait(40);
  await flushPendingSaves();
  assert.deepEqual(written, ["later", "now"], "a cancelled save must not run");

  // 書き換えのたびに取り消して待ち直す（useEffect の後片付けと同じ）。最後の値だけを書く。
  let cancelPrevious = () => {};
  for (const value of [1, 2, 3]) {
    cancelPrevious();
    cancelPrevious = schedulePendingSave("latest", 1000, () => written.push(`latest ${value}`));
  }
  await flushPendingSaves();
  assert.deepEqual(written.slice(2), ["latest 3"]);
  cancelPrevious();
}

// 作品を切り替えたとき（docs/SAVE_ON_WORK_SWITCH_FIX_PLAN.md）: 後片付けで「今書く」と答えると、
// 取り消す代わりに待たずに一度だけ書き、一覧から外れる。「書かない」なら今のとおり取り消す。
{
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const written = [];
  let workChanged = false;
  const cleanupA = schedulePendingSave("work", 1000, () => written.push("work A"), () => workChanged);
  workChanged = true;
  cleanupA();
  assert.deepEqual(written, ["work A"], "a save cancelled because the work changed must run at once");
  await wait(30);
  await flushPendingSaves();
  assert.deepEqual(written, ["work A"], "it must run only once and leave the pending list");

  // 同じ作品の中で値が変わったとき（答えが偽）は、今のとおり取り消す。
  const cleanupSame = schedulePendingSave("work", 20, () => written.push("same work"), () => false);
  cleanupSame();
  await wait(40);
  await flushPendingSaves();
  assert.deepEqual(written, ["work A"], "a save cancelled within the same work must not run");

  // もう書き終えた予約は、後片付けで書き直さない（待ち終えたとき、閉じる前に書き切ったとき）。
  const cleanupDone = schedulePendingSave("work", 10, () => written.push("timer"), () => true);
  await wait(30);
  cleanupDone();
  const cleanupFlushed = schedulePendingSave("work", 1000, () => written.push("flushed"), () => true);
  await flushPendingSaves();
  cleanupFlushed();
  assert.deepEqual(written, ["work A", "timer", "flushed"], "a save that already ran must not run again on cleanup");
}

// 何も待っていなければ、すぐ終わる。
await flushPendingSaves();

console.log("pending saves: ok");
