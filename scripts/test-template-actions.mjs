// テンプレートの一覧と登録（createTemplateActions）を実際に動かして確かめる（docs/TEMPLATE_ACTIONS_SEPARATION_PLAN.md）。
// invoke はメモリの中のテンプレートに読み書きする入れ物に差し替える。入れ物は Rust の register_text_template と同じく、
// 名前の前後の空白を削り、同じファイル名（Windows と同じく大文字小文字は区別しない）があって上書きでなければ断る。
// App の描画と同じく、操作のたびにその時点の値で createTemplateActions を作り直す。
import assert from "node:assert/strict";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const stubTauri = {
  name: "stub-tauri",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: "core", namespace: "stub-tauri" }));
    pluginBuild.onLoad({ filter: /.*/, namespace: "stub-tauri" }, () => ({
      contents: "export const invoke = (command, args) => globalThis.__invoke(command, args);",
      loader: "js",
    }));
  },
};

const tmpDir = path.join(process.cwd(), ".tmp");
await mkdir(tmpDir, { recursive: true });
const compiledPath = path.join(tmpDir, `template-actions-${process.pid}.mjs`);
const bundled = await build({
  stdin: {
    contents: 'export { createTemplateActions } from "./src/templateActions";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  plugins: [stubTauri],
  write: false,
  logLevel: "error",
});
await writeFile(compiledPath, bundled.outputFiles[0].text);
globalThis.window ??= globalThis;
const { createTemplateActions } = await import(pathToFileURL(compiledPath).href).finally(() => unlink(compiledPath));

const ROOT = "C:\\Novel";

function createApp({ tauri = true, projectFolder = { path: ROOT }, currentFileName = "第一章.txt", markdown = "本文\n", templates = [] } = {}) {
  if (tauri) window.__TAURI_INTERNALS__ = {};
  else delete window.__TAURI_INTERNALS__;
  const app = {
    projectFolder,
    currentFileName,
    markdown,
    lastError: "",
    toasts: [],
    calls: [],
    dialogs: [],
    confirms: [],
    // ダイアログの答え。関数なら、出たダイアログを受け取って答えを返す。
    multiInputAnswer: (request) =>
      Object.fromEntries(request.fields.map((field) => [field.id, field.initialValue])),
    confirmAnswer: true,
    templates: templates.map((template) => ({ ...template })),
    failRegister: null,
  };
  globalThis.__invoke = async (command, args) => {
    app.calls.push({ command, args });
    if (command === "list_text_templates") return app.templates.map((template) => ({ ...template }));
    if (command === "register_text_template") {
      if (app.failRegister) throw new Error(app.failRegister);
      const label = args.name.trim().replace(new RegExp(`\\.${args.extension}$`, "i"), "").trim();
      if (!label) throw new Error("template name is required");
      const fileKey = (template) => `${template.scope}/${template.name}.${template.extension}`.toUpperCase();
      const registered = { id: `${args.scope}:${label}.${args.extension}`, name: label, scope: args.scope, extension: args.extension };
      const existing = app.templates.find((template) => fileKey(template) === fileKey(registered));
      if (existing && !args.overwrite) throw new Error("template already exists");
      if (existing) existing.content = args.content;
      else app.templates.push({ ...registered, content: args.content });
      return registered;
    }
    throw new Error(`unexpected command ${command}`);
  };
  const actions = () =>
    createTemplateActions({
      projectFolder: app.projectFolder,
      currentFileName: app.currentFileName,
      markdown: app.markdown,
      setLastError: (value) => {
        app.lastError = typeof value === "function" ? value(app.lastError) : value;
      },
      showToast: (message) => app.toasts.push(message),
      requestMultiInput: async (request) => {
        app.dialogs.push(request);
        return typeof app.multiInputAnswer === "function" ? app.multiInputAnswer(request) : app.multiInputAnswer;
      },
      requestConfirm: async (request) => {
        app.confirms.push(request);
        return app.confirmAnswer;
      },
    });
  return { app, actions };
}

const registerCalls = (app) => app.calls.filter((call) => call.command === "register_text_template");

// ---- Tauri 版でないとき ----
{
  const { app, actions } = createApp({ tauri: false });
  await actions().handleRegisterCurrentFileAsTemplate();
  assert.deepEqual(app.toasts, ["テンプレート登録はTauri版で利用できます"]);
  assert.equal(app.dialogs.length, 0);
  assert.equal(app.calls.length, 0);
  assert.deepEqual(await actions().loadTextTemplates(), []);
  assert.equal(app.calls.length, 0);
}

// ---- 一覧を読む: 作品のパスを渡す。作品がなければ null ----
{
  const { app, actions } = createApp({ templates: [{ id: "t1", name: "章", scope: "workspace", extension: "txt" }] });
  const list = await actions().loadTextTemplates();
  assert.deepEqual(list.map((template) => template.id), ["t1"]);
  assert.deepEqual(app.calls.at(-1), { command: "list_text_templates", args: { rootPath: ROOT } });
  app.projectFolder = null;
  await actions().loadTextTemplates();
  assert.deepEqual(app.calls.at(-1), { command: "list_text_templates", args: { rootPath: null } });
}

// ---- 作品を開いているとき: ダイアログの中身と、登録の引数 ----
{
  const { app, actions } = createApp({ markdown: "第一章の本文\r\n" });
  await actions().handleRegisterCurrentFileAsTemplate();
  assert.equal(app.dialogs.length, 1);
  const dialog = app.dialogs[0];
  assert.equal(dialog.title, "このファイルをテンプレートとして登録");
  assert.equal(dialog.confirmLabel, "登録");
  assert.deepEqual(
    dialog.fields.map(({ id, label, initialValue, placeholder, options }) => ({ id, label, initialValue, placeholder, options })),
    [
      { id: "name", label: "テンプレート名", initialValue: "第一章", placeholder: "例: 章のひな型", options: undefined },
      {
        id: "scope",
        label: "保存先",
        initialValue: "workspace",
        placeholder: undefined,
        options: [
          { value: "workspace", label: "このワークスペース" },
          { value: "profile", label: "すべてのワークスペースで共通" },
        ],
      },
    ],
  );
  assert.equal(app.confirms.length, 0);
  assert.deepEqual(registerCalls(app).map((call) => call.args), [
    { rootPath: ROOT, scope: "workspace", name: "第一章", extension: "txt", content: "第一章の本文\r\n", overwrite: false },
  ]);
  assert.deepEqual(app.toasts, ["テンプレート「第一章」を登録しました"]);
}

// ---- 作品を開いていないとき: 共通だけ ----
{
  const { app, actions } = createApp({ projectFolder: null });
  await actions().handleRegisterCurrentFileAsTemplate();
  const scope = app.dialogs[0].fields[1];
  assert.equal(scope.initialValue, "profile");
  assert.deepEqual(scope.options, [{ value: "profile", label: "すべてのワークスペースで共通" }]);
  assert.equal(registerCalls(app)[0].args.rootPath, null);
  assert.equal(registerCalls(app)[0].args.scope, "profile");
}

// ---- .md のファイルは md で登録。名前に付けた拡張子は外す ----
{
  const { app, actions } = createApp({ currentFileName: "メモ.MD" });
  app.multiInputAnswer = { name: "ひな型.md", scope: "workspace" };
  await actions().handleRegisterCurrentFileAsTemplate();
  assert.equal(app.dialogs[0].fields[0].initialValue, "メモ");
  const args = registerCalls(app)[0].args;
  assert.equal(args.extension, "md");
  assert.equal(args.name, "ひな型");
}

// ---- 拡張子だけの名前なら「新規テンプレート」 ----
{
  const { app, actions } = createApp({ currentFileName: ".txt" });
  await actions().handleRegisterCurrentFileAsTemplate();
  assert.equal(app.dialogs[0].fields[0].initialValue, "新規テンプレート");
}

// ---- ダイアログをやめたら何もしない ----
{
  const { app, actions } = createApp();
  app.multiInputAnswer = null;
  await actions().handleRegisterCurrentFileAsTemplate();
  assert.equal(app.calls.length, 0);
  assert.deepEqual(app.toasts, []);
}

// ---- 同じ名前があれば上書きの確認。やめたら書かない、上書きなら overwrite: true ----
{
  const existing = [{ id: "w1", name: "第一章", scope: "workspace", extension: "txt" }];
  const cancelled = createApp({ templates: existing });
  cancelled.app.confirmAnswer = false;
  await cancelled.actions().handleRegisterCurrentFileAsTemplate();
  assert.deepEqual(cancelled.app.confirms, [
    {
      title: "テンプレートを上書き",
      message: "「第一章」はすでに登録されています。",
      detail: "登録済みの内容を、現在のファイル内容で置き換えます。",
      confirmLabel: "上書き",
    },
  ]);
  assert.equal(registerCalls(cancelled.app).length, 0);
  assert.deepEqual(cancelled.app.toasts, []);

  const accepted = createApp({ templates: existing });
  await accepted.actions().handleRegisterCurrentFileAsTemplate();
  assert.equal(accepted.app.confirms.length, 1);
  assert.equal(registerCalls(accepted.app)[0].args.overwrite, true);
  assert.deepEqual(accepted.app.toasts, ["テンプレート「第一章」を登録しました"]);

  // 保存先か拡張子が違えば、同じ名前でも別のテンプレート。
  const otherScope = createApp({ templates: [{ id: "p1", name: "第一章", scope: "profile", extension: "txt" }] });
  await otherScope.actions().handleRegisterCurrentFileAsTemplate();
  assert.equal(otherScope.app.confirms.length, 0);
  const otherExtension = createApp({ templates: [{ id: "w2", name: "第一章", scope: "workspace", extension: "md" }] });
  await otherExtension.actions().handleRegisterCurrentFileAsTemplate();
  assert.equal(otherExtension.app.confirms.length, 0);

  // 大文字小文字の違いだけなら同じ名前（Windows では同じファイル）。
  const caseOnly = createApp({ currentFileName: "Chapter.txt", templates: [{ id: "w3", name: "chapter", scope: "workspace", extension: "txt" }] });
  await caseOnly.actions().handleRegisterCurrentFileAsTemplate();
  assert.equal(caseOnly.app.confirms.length, 1);
  assert.equal(registerCalls(caseOnly.app)[0].args.overwrite, true);
}

// ---- 癖1: 名前の前後の空白は削ってから同じ名前を探す（Rust も削るので、削らないと上書きの確認が出ずに断られる） ----
{
  const { app, actions } = createApp({ templates: [{ id: "w1", name: "第一章", scope: "workspace", extension: "txt" }] });
  app.multiInputAnswer = { name: "  第一章 .txt ", scope: "workspace" };
  await actions().handleRegisterCurrentFileAsTemplate();
  assert.equal(app.confirms.length, 1, "a padded name must still find the registered template");
  assert.equal(app.confirms[0].message, "「第一章」はすでに登録されています。");
  assert.equal(registerCalls(app)[0].args.name, "第一章");
  assert.equal(registerCalls(app)[0].args.overwrite, true);
  assert.deepEqual(app.toasts, ["テンプレート「第一章」を登録しました"]);
}

// ---- 癖3: 全角と半角、ひらがなとカタカナだけが違う名前は別のテンプレート（Rust は別のファイルを作る） ----
for (const [registered, typed] of [["ア", "あ"], ["Ａ章", "A章"]]) {
  const { app, actions } = createApp({ templates: [{ id: "w1", name: registered, scope: "workspace", extension: "txt" }] });
  app.multiInputAnswer = { name: typed, scope: "workspace" };
  await actions().handleRegisterCurrentFileAsTemplate();
  assert.equal(app.confirms.length, 0, `${typed} must not be taken for ${registered}`);
  assert.equal(registerCalls(app)[0].args.overwrite, false);
  assert.deepEqual(app.templates.map((template) => template.name), [registered, typed]);
  assert.deepEqual(app.toasts, [`テンプレート「${typed}」を登録しました`]);
}

// ---- 失敗したら通知し、エラーの文を残す ----
{
  const { app, actions } = createApp();
  app.failRegister = "disk full";
  await actions().handleRegisterCurrentFileAsTemplate();
  assert.deepEqual(app.toasts, ["テンプレートを登録できませんでした"]);
  assert.equal(app.lastError, "Error: disk full");
}

// ---- 描画のたびの値を使う: 作り直すと、新しい作品と本文で登録する ----
{
  const { app, actions } = createApp();
  app.projectFolder = { path: "D:\\Other" };
  app.markdown = "別の本文";
  await actions().handleRegisterCurrentFileAsTemplate();
  assert.equal(app.calls[0].args.rootPath, "D:\\Other");
  assert.equal(registerCalls(app)[0].args.rootPath, "D:\\Other");
  assert.equal(registerCalls(app)[0].args.content, "別の本文");
}

console.log("template actions: ok");
