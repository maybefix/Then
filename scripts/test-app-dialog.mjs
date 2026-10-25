// アプリ内ダイアログ（useAppDialog）を実際に動かして確かめる。
// react は「useState の値を1つ覚えるだけ」の入れ物に差し替え、App の描画と同じく、
// 操作のたびにフックを呼び直して、その時点の appDialog と関数を取り出す。
import assert from "node:assert/strict";
import { build } from "esbuild";

const stubReact = {
  name: "stub-react",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "stub-react" }));
    pluginBuild.onLoad({ filter: /.*/, namespace: "stub-react" }, () => ({
      contents: `
        export function useState(initial) {
          const hook = globalThis.__dialogState;
          if (!hook.ready) {
            hook.value = typeof initial === "function" ? initial() : initial;
            hook.ready = true;
            hook.set = (next) => {
              hook.value = typeof next === "function" ? next(hook.value) : next;
            };
          }
          return [hook.value, hook.set];
        }
      `,
      loader: "js",
    }));
  },
};

const bundled = await build({
  entryPoints: ["src/components/dialogs/useAppDialog.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  plugins: [stubReact],
  write: false,
});
const { useAppDialog } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

/** 描画1回ぶん。毎回フックを呼び直す。 */
const render = () => useAppDialog();
const reset = () => {
  globalThis.__dialogState = { ready: false };
};
/** Promise の答え。まだなら "pending"。 */
const answerOf = async (promise) => {
  const pending = Symbol("pending");
  const value = await Promise.race([promise, new Promise((resolve) => setImmediate(() => resolve(pending)))]);
  return value === pending ? "pending" : value;
};
const submitEvent = () => {
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  return event;
};
const submit = () => {
  const event = submitEvent();
  render().submitAppDialog(event);
  assert.equal(event.prevented, true, "submit must prevent the form's own submission");
};

// ---- 1行の入力 ----
{
  reset();
  assert.equal(render().appDialog, null);
  const answer = render().requestInput({ title: "名前を変更", label: "作品名", initialValue: "旧名", confirmLabel: "変更" });
  assert.deepEqual(
    { ...render().appDialog, resolve: undefined },
    {
      type: "input", title: "名前を変更", label: "作品名", value: "旧名", confirmLabel: "変更",
      placeholder: undefined, optional: false, error: "", resolve: undefined,
    },
  );
  render().updateAppDialogValue("   ");
  submit();
  assert.equal(render().appDialog?.error, "名前を入力してください", "a required empty name keeps the dialog open");
  assert.equal(await answerOf(answer), "pending");
  render().updateAppDialogValue("  新しい名前  ");
  assert.equal(render().appDialog?.error, "", "typing clears the error");
  submit();
  assert.equal(await answerOf(answer), "新しい名前", "the answer is trimmed");
  assert.equal(render().appDialog, null);
}
{
  reset();
  const answer = render().requestInput({ title: "t", label: "l", initialValue: "", confirmLabel: "ok", optional: true });
  submit();
  assert.equal(await answerOf(answer), "", "an optional empty value is answered as empty text");
}
{
  reset();
  const answer = render().requestInput({ title: "t", label: "l", initialValue: "x", confirmLabel: "ok" });
  render().closeAppDialog();
  assert.equal(await answerOf(answer), null, "closing an input answers null");
  assert.equal(render().appDialog, null);
}

// ---- 複数の入力 ----
{
  reset();
  const answer = render().requestMultiInput({
    title: "作品を作成",
    fields: [
      { id: "name", label: "作品名", initialValue: "" },
      { id: "note", label: "メモ", initialValue: " a ", optional: true, multiline: true },
      { id: "kind", label: "種類", initialValue: "novel", options: [{ value: "novel", label: "小説" }] },
    ],
    confirmLabel: "作成",
  });
  const dialog = render().appDialog;
  assert.equal(dialog.type, "multiInput");
  assert.deepEqual(dialog.fields.map((field) => [field.id, field.value, field.optional, field.multiline]), [
    ["name", "", undefined, undefined],
    ["note", " a ", true, true],
    ["kind", "novel", undefined, undefined],
  ]);
  render().updateAppDialogValue("ignored");
  assert.equal(render().appDialog, dialog, "the single-line setter leaves other dialogs alone");
  submit();
  assert.equal(render().appDialog.error, "作品名を入力してください");
  render().updateAppDialogFieldValue("name", "  第一作 ");
  assert.equal(render().appDialog.error, "");
  submit();
  assert.deepEqual(await answerOf(answer), { name: "第一作", note: "a", kind: "novel" });
  assert.equal(render().appDialog, null);
}
{
  reset();
  const answer = render().requestMultiInput({ title: "t", fields: [{ id: "a", label: "A", initialValue: "x" }], confirmLabel: "ok" });
  render().closeAppDialog();
  assert.equal(await answerOf(answer), null);
}

// ---- 新規ファイル ----
{
  reset();
  const templates = [{ id: "t1", name: "章", scope: "workspace", extension: "md" }];
  const answer = render().requestCreateFile(templates);
  const dialog = render().appDialog;
  assert.equal(dialog.type, "createFile");
  assert.equal(dialog.title, "新規ファイルを作成");
  assert.equal(dialog.fileName, "新規ノート");
  assert.equal(dialog.extension, "txt");
  assert.equal(dialog.templateId, "");
  assert.equal(dialog.templates, templates);
  render().updateAppDialogFieldValue("extension", "rtf");
  assert.equal(render().appDialog.extension, "txt", "only txt and md are accepted");
  render().updateAppDialogFieldValue("fileName", " .txt ");
  submit();
  assert.equal(render().appDialog.error, "テキストファイル名を入力してください", "an extension alone is not a name");
  render().updateAppDialogFieldValue("fileName", "第一章.TXT");
  render().updateAppDialogFieldValue("extension", "md");
  assert.equal(render().appDialog.error, "");
  submit();
  assert.deepEqual(await answerOf(answer), { fileName: "第一章.md", templateId: null }, "the typed extension is replaced by the chosen one");
}
{
  reset();
  const answer = render().requestCreateFile([]);
  render().updateAppDialogFieldValue("templateId", "t1");
  render().updateAppDialogFieldValue("unknown", "x");
  submit();
  assert.deepEqual(await answerOf(answer), { fileName: "新規ノート.txt", templateId: "t1" });
}
{
  reset();
  const answer = render().requestCreateFile([]);
  render().closeAppDialog();
  assert.equal(await answerOf(answer), null);
}

// ---- 確認 ----
{
  reset();
  const answer = render().requestConfirm({ title: "削除", message: "消しますか？", confirmLabel: "削除する" });
  assert.equal(render().appDialog.type, "confirm");
  assert.equal(render().appDialog.danger, false);
  const dialog = render().appDialog;
  render().chooseAppDialog("primary");
  render().chooseAppDialogOption("x");
  render().updateAppDialogValue("x");
  render().updateAppDialogFieldValue("fileName", "x");
  assert.equal(render().appDialog, dialog, "other kinds' handlers do nothing to a confirm");
  assert.equal(await answerOf(answer), "pending");
  submit();
  assert.equal(await answerOf(answer), true);
  assert.equal(render().appDialog, null);
}
{
  reset();
  const answer = render().requestConfirm({ title: "t", message: "m", confirmLabel: "ok", danger: true });
  assert.equal(render().appDialog.danger, true);
  render().closeAppDialog();
  assert.equal(await answerOf(answer), false, "closing a confirm answers false, not null");
}

// ---- 二択 ----
{
  reset();
  const answer = render().requestChoice({ title: "t", message: "m", primaryLabel: "再試行", secondaryLabel: "あとで" });
  render().chooseAppDialogOption("x");
  assert.equal(await answerOf(answer), "pending");
  render().chooseAppDialog("secondary");
  assert.equal(await answerOf(answer), "secondary");
  assert.equal(render().appDialog, null);
}
{
  reset();
  const answer = render().requestChoice({ title: "t", message: "m", primaryLabel: "a", secondaryLabel: "b" });
  submit();
  assert.equal(await answerOf(answer), "primary", "Enter picks the primary button");
}
{
  reset();
  const answer = render().requestChoice({ title: "t", message: "m", primaryLabel: "a", secondaryLabel: "b" });
  render().closeAppDialog();
  assert.equal(await answerOf(answer), null);
}

// ---- 選択肢 ----
{
  reset();
  const options = [{ id: "a", label: "A" }, { id: "b", label: "B", description: "説明" }];
  const answer = render().requestOption({ title: "t", message: "m", detail: "d", options });
  assert.deepEqual({ ...render().appDialog, resolve: undefined }, {
    type: "options", title: "t", message: "m", detail: "d", options, resolve: undefined,
  });
  const dialog = render().appDialog;
  submit();
  assert.equal(render().appDialog, dialog, "Enter does nothing on an option list");
  render().chooseAppDialog("primary");
  assert.equal(await answerOf(answer), "pending");
  render().chooseAppDialogOption("b");
  assert.equal(await answerOf(answer), "b");
  assert.equal(render().appDialog, null);
}
{
  reset();
  const answer = render().requestOption({ title: "t", message: "m", options: [{ id: "a", label: "A" }] });
  render().closeAppDialog();
  assert.equal(await answerOf(answer), null);
}

// ---- 何も出ていないとき ----
{
  reset();
  const hook = render();
  hook.closeAppDialog();
  hook.submitAppDialog(submitEvent());
  hook.chooseAppDialog("primary");
  hook.chooseAppDialogOption("a");
  hook.updateAppDialogValue("a");
  hook.updateAppDialogFieldValue("a", "b");
  assert.equal(render().appDialog, null);
}

// ---- 重なったとき（後から来たダイアログは、今のダイアログが閉じるまで待つ） ----
// 起動時の「保存されていない編集」と「古い共通データを削除できませんでした」が同じ起動で出ると、
// 後のほうが前のほうを置き換え、前のほうの処理が答えをもらえずに止まっていた。
{
  reset();
  const first = render().requestChoice({ title: "保存されていない編集が残っています", message: "", primaryLabel: "開く", secondaryLabel: "破棄" });
  const second = render().requestChoice({ title: "古い共通データを削除できませんでした", message: "", primaryLabel: "再試行", secondaryLabel: "あとで" });
  assert.equal(render().appDialog.title, "保存されていない編集が残っています", "a later dialog waits instead of replacing the open one");
  render().chooseAppDialog("secondary");
  assert.equal(await answerOf(first), "secondary", "the first dialog still gets its answer");
  assert.equal(render().appDialog?.title, "古い共通データを削除できませんでした", "the waiting dialog shows once the first closes");
  assert.equal(await answerOf(second), "pending");
  render().closeAppDialog();
  assert.equal(await answerOf(second), null);
  assert.equal(render().appDialog, null);
}
{
  reset();
  const name = render().requestInput({ title: "t", label: "作品名", initialValue: "", confirmLabel: "ok" });
  const confirm = render().requestConfirm({ title: "c", message: "m", confirmLabel: "ok" });
  const option = render().requestOption({ title: "o", message: "m", options: [{ id: "a", label: "A" }] });
  const firstKey = render().appDialogKey;
  assert.notEqual(firstKey, undefined);
  submit();
  assert.equal(render().appDialog.type, "input", "an error keeps the open dialog in front");
  assert.equal(render().appDialog.error, "名前を入力してください");
  render().updateAppDialogValue("x");
  assert.equal(render().appDialogKey, firstKey, "editing keeps the modal mounted");
  submit();
  assert.equal(await answerOf(name), "x");
  assert.equal(render().appDialog.type, "confirm");
  assert.notEqual(render().appDialogKey, firstKey, "the next dialog remounts the modal so its first focus is set again");
  render().closeAppDialog();
  assert.equal(await answerOf(confirm), false);
  assert.equal(render().appDialog.type, "options");
  render().chooseAppDialogOption("a");
  assert.equal(await answerOf(option), "a");
  assert.equal(render().appDialog, null);
  assert.equal(render().appDialogKey, undefined);
}

console.log("app dialog: ok");
