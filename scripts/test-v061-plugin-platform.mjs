import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import ts from "typescript";

const anchorSource = await readFile("src/plugins/anchors.ts", "utf8");
const compiled = ts.transpileModule(anchorSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const anchorApi = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const originalText = "冒頭。\n永続的に追跡する範囲です。\n末尾。";
const original = anchorApi.createThenPluginAnchor({
  id: "stable-id",
  pluginId: "example.notes",
  documentPath: "chapter/one.txt",
  from: originalText.indexOf("追跡"),
  to: originalText.indexOf("範囲") + 2,
  text: originalText,
});
assert.equal(original.id, "stable-id");
assert.equal(originalText, "冒頭。\n永続的に追跡する範囲です。\n末尾。", "creating an anchor must not mutate document text");

const insertedText = `前書き。\n${originalText}`;
const mapped = anchorApi.mapAnchorsThroughTextChange(
  [original],
  "chapter/one.txt",
  originalText,
  insertedText,
);
assert.equal(mapped.anchors[0].id, "stable-id");
assert.equal(
  insertedText.slice(mapped.anchors[0].from, mapped.anchors[0].to),
  original.selectedText,
  "anchor range must follow edits before the range",
);

const externallyEdited = `別の導入。\n${originalText}`;
const resolved = anchorApi.resolveThenPluginAnchor(original, externallyEdited);
assert.ok(resolved, "context anchoring must reconnect after an edit made while Then was closed");
assert.equal(externallyEdited.slice(resolved.from, resolved.to), original.selectedText);

const appSource = await readFile("src/App.tsx", "utf8");
const appCssSource = await readFile("src/App.css", "utf8");
const pluginManagerSource = await readFile("src/components/dialogs/PluginManagerModal.tsx", "utf8");
const runtimeSource = await readFile("src/plugins/PluginRuntimeHost.tsx", "utf8");
const rustSource = await readFile("src-tauri/src/lib.rs", "utf8");
const manifestSchema = JSON.parse(await readFile("plugin-sdk/manifest.schema.json", "utf8"));
const sampleManifest = JSON.parse(await readFile("docs/plugin-example/manifest.json", "utf8"));
assert.match(appSource, /pluginRuntimeHostRef\.current\?\.emit\([\s\S]*?"document\.change"/);
assert.match(appSource, /pluginRuntimeHostRef\.current\?\.emit\("workspace\.change"/);
assert.match(appSource, /editor\.getSelection/);
assert.match(appSource, /editor\.moveCursor/);
assert.match(appSource, /const revealPluginRange[\s\S]*?setAppMode\("write"\)/, "navigation from a plugin screen must reveal the editor");
assert.match(appSource, /views\.register/);
assert.match(appSource, /views\.registerScreen/);
assert.match(appSource, /method === "views\.open"/);
assert.match(appSource, /method === "views\.openModal"/);
assert.match(appSource, /method === "views\.closeModal"/);
const hostOpenModalSource = appSource.slice(
  appSource.indexOf('if (method === "views.openModal")'),
  appSource.indexOf('if (method === "views.closeModal")'),
);
assert.doesNotMatch(hostOpenModalSource, /setAppMode/, "opening a plugin modal must preserve the current screen");
assert.match(appSource, /method === "statusbar\.set"/);
assert.match(appSource, /method === "statusbar\.remove"/);
assert.match(appSource, /command\.menus\?\.includes\("editor\.selection"\)/);
assert.match(appSource, /commands\.register/);
assert.match(runtimeSource, /registerScreen: async/);
assert.match(runtimeSource, /open: \(viewId\) => request\("views\.open"/);
assert.match(runtimeSource, /registerModal: async/);
assert.match(runtimeSource, /onDidChangeWorkspace: \(listener\) => subscribe\("workspace\.change", listener\)/);
assert.match(runtimeSource, /openModal: \(modalId\) => request\("views\.openModal"/);
assert.match(runtimeSource, /then-plugin-modal/);
assert.match(runtimeSource, /kind: "view\.activated"/, "plugin frames must acknowledge that the requested view is active");
assert.match(runtimeSource, /data-active-view-ready/, "the host must wait for view activation before revealing a resized plugin frame");
assert.match(runtimeSource, /useLayoutEffect\(\(\) => \{[\s\S]*?"view\.activate"/, "plugin view activation must be requested before the browser paints the new host bounds");
assert.match(runtimeSource, /setItem: \(definition\) => request\("statusbar\.set"/);
assert.match(runtimeSource, /sandbox="allow-scripts"/);
assert.match(runtimeSource, /connect-src 'none'/);
assert.match(runtimeSource, /closest\("\.rightSidebar"\)/, "the detached plugin host must track its sidebar anchor");
assert.match(
  runtimeSource,
  /requestAnimationFrame\(trackTransition\)[\s\S]*?addEventListener\("transitionrun"/,
  "the detached plugin host must follow the Zone sidebar during its transform transition",
);
assert.match(runtimeSource, /addEventListener\("transitioncancel"/, "interrupted Zone transitions must stop host position tracking");
assert.match(runtimeSource, /"--then-background": "--sidebar-bg"/, "plugin frames must receive Then theme tokens");
assert.match(runtimeSource, /sendEvent\(runtime\.plugin\.manifest\.id, "theme\.change", theme\)/, "theme changes must be sent into every plugin frame");
const rightSidebarStart = appSource.search(/<aside\r?\n\s+className=\{`rightSidebar/);
const rightSidebarEnd = appSource.indexOf("</aside>", rightSidebarStart);
const sidebarRuntimeAnchorPosition = appSource.indexOf("ref={setSidebarPluginRuntimeAnchor}", rightSidebarStart);
const screenPanePosition = appSource.indexOf('className="pluginScreenPane"');
const screenRuntimeAnchorPosition = appSource.indexOf("ref={setScreenPluginRuntimeAnchor}", screenPanePosition);
const runtimeHostPosition = appSource.indexOf("<ThenPluginRuntimeHost", rightSidebarStart);
const referenceLayerPosition = appSource.indexOf("<ReferenceLayer", rightSidebarStart);
assert.ok(
  rightSidebarStart >= 0 &&
    sidebarRuntimeAnchorPosition > rightSidebarStart &&
    sidebarRuntimeAnchorPosition < rightSidebarEnd &&
    screenPanePosition >= 0 &&
    screenRuntimeAnchorPosition > screenPanePosition &&
    screenRuntimeAnchorPosition < rightSidebarStart &&
    runtimeHostPosition > rightSidebarEnd &&
    referenceLayerPosition > runtimeHostPosition,
  "plugin screens and sidebar views must use separate anchors without reusing the sidebar as a full-screen pane",
);
assert.doesNotMatch(appCssSource.match(/\.pluginRuntimeHost \{[\s\S]*?\}/)?.[0] ?? "", /position:\s*absolute/, "plugin views must not float above the workspace");
assert.match(appCssSource, /\.pluginRuntimeDetachedHost[\s\S]*?position:\s*fixed/, "one stable iframe host must dock by measured bounds outside clipped sidebar ancestors");
assert.match(
  appCssSource,
  /\.pluginRuntimeDetachedHost\s*\{[^}]*z-index:\s*0/,
  "normal plugin screens must remain below Then's native modal layer",
);
assert.match(
  appCssSource,
  /\.referenceLayer\s*\{[^}]*top:\s*calc\(var\(--documentbar-height\) \* var\(--ui-font-scale, 1\)\)[^}]*z-index:\s*5/,
  "the detached reference layer must keep workspace coordinates above docked plugin frames",
);
assert.match(
  appCssSource,
  /\.appFrame\[data-editor-focus="true"\] > \.referenceLayer\s*\{[^}]*top:\s*0/,
  "the detached reference layer must follow the workspace when focus mode hides the topbar",
);
assert.match(appSource, /className="appFrame"[\s\S]*?data-app-mode=\{appMode\}/);
assert.match(
  appCssSource,
  /\.appFrame:not\(\[data-app-mode="write"\]\) > \.referenceLayer\s*\{[^}]*display:\s*none/,
  "reference cards must stay hidden on Canvas, full plugin screens, Export, and Checkpoint",
);
assert.match(appCssSource, /\.topbar\s*\{[^}]*z-index:\s*6/, "topbar popovers must remain above reference cards");
assert.match(appCssSource, /\.toast\s*\{[^}]*z-index:\s*7/, "notifications must remain above reference cards");
assert.match(appCssSource, /\.modalBackdrop\s*\{[^}]*z-index:\s*10/, "native dialogs must remain above reference cards");
assert.doesNotMatch(appSource, /pluginScreenRightSidebar/, "a full plugin screen must never resize the right sidebar");
assert.match(appCssSource, /\.pluginScreenPane\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*overflow:\s*hidden/, "full plugin screens need an independent overlay that cannot resize the editor workspace");
assert.match(
  appSource,
  /className=\{`leftWorkspaceCluster \$\{[\s\S]*?appMode !== "write" && appMode !== "plugin"/,
  "the editor workspace must remain laid out behind a plugin screen",
);
assert.match(
  appSource,
  /aria-hidden=\{isEditorFocusMode \|\| appMode === "plugin"\}[\s\S]*?inert/,
  "the preserved editor chrome must not remain interactive behind a plugin screen",
);
assert.match(
  appCssSource,
  /workspace\[data-app-mode="plugin"\][\s\S]*?\.editorColumn[\s\S]*?visibility:\s*hidden/,
  "the preserved editor workspace must not paint behind an opaque plugin screen",
);
const rightSidebarMotionSource = [...appCssSource.matchAll(/\.rightSidebar\s*\{([^}]*)\}/g)].at(-1)?.[1] ?? "";
assert.doesNotMatch(
  rightSidebarMotionSource,
  /(?:width|min-width|flex-basis)\s+\d+ms/,
  "returning from a full plugin screen must not animate the workspace through every intermediate sidebar width",
);
assert.match(
  appCssSource,
  /\.pluginRuntimeDetachedHost:not\(\.pluginModalRuntimeHost\)\s*\{[^}]*transition:\s*opacity\s+140ms/,
  "a detached plugin view must fade in step with the Zone sidebar instead of flashing ahead of it",
);
assert.match(
  appCssSource,
  /\.visiblePluginRuntimeHost\[data-active-view-ready="true"\]\s+\.activePluginRuntimeFrame/,
  "a plugin frame must stay hidden while its previous sidebar, screen, or modal view is still active",
);
assert.match(rustSource, /app_data_dir\(\)[\s\S]*?\.join\("plugins"\)/, "plugin binaries must be installed globally");
assert.match(rustSource, /fn uninstall_plugin\([\s\S]*?remove_dir_all/, "installed plugins must have a removal path");
assert.match(appSource, /id: "plugin-manage"[\s\S]*?setIsPluginManagerOpen\(true\)/, "the command palette must expose one plugin manager entry");
assert.doesNotMatch(appSource, /plugin-uninstall:/, "the command palette must not grow one removal command per plugin");
assert.match(pluginManagerSource, /plugins\.map[\s\S]*?onUninstall\(plugin\)/, "the plugin manager must expose removal for every installed plugin");
assert.ok(manifestSchema.required.includes("icon"), "new plugin manifests must require an icon");
assert.ok(manifestSchema.properties.permissions.items.enum.includes("statusbar"));
assert.match(rustSource, /fn require_plugin_icon[\s\S]*?plugin manifest icon is required/, "plugin installation must enforce the icon requirement");
assert.ok(Array.isArray(manifestSchema.properties.icon.properties.paths.items ? sampleManifest.icon.paths : null));
assert.ok(sampleManifest.icon.paths.length > 0, "a plugin that registers a screen must provide an icon");
assert.match(appSource, /<PluginIcon[\s\S]*?pluginModeSwitcherIcon/, "plugin screens must use their manifest icon in the mode switcher");
assert.match(appSource, /appMode === "plugin" && activePluginScreen[\s\S]*?className="pluginScreenPane"/, "plugin screens must render in their own workspace pane");
assert.doesNotMatch(appSource, /appMode === "plugin" \? " modeHiddenPane"/, "plugin mode must not remove the existing editor layout and trigger a shrink on return");
assert.match(appCssSource, /\.pluginModalRuntimeHost[\s\S]*?position:\s*fixed[\s\S]*?inset:\s*0/, "plugin modals must cover the current workspace without changing screens");
assert.match(rustSource, /\.join\("plugin-data"\)/, "plugin data must remain project-scoped");
assert.doesNotMatch(anchorSource, /documentAst|ProjectAst|JSONContent/, "anchor metadata must not enter the editor AST");

const sampleSource = await readFile("docs/plugin-example/main.js", "utf8");
assert.match(sampleSource, /var\(--then-background\)|var\(--then-surface\)/, "sample plugin must use host theme tokens");
assert.doesNotMatch(sampleSource, /color-scheme:\s*dark/, "sample plugin must not force a dark theme");
const sampleDom = new JSDOM('<div id="plugin-root"></div>', {
  runScripts: "outside-only",
  url: "https://then-plugin.invalid/",
});
const sampleWindow = sampleDom.window;
Object.defineProperty(sampleWindow.crypto, "randomUUID", {
  configurable: true,
  value: () => "sample-note-id",
});
const sampleStorage = new Map();
const sampleCommands = [];
const deletedSampleAnchors = [];
let sampleView = null;
let sampleScreen = null;
sampleWindow.then = {
  editor: {
    getSelection: async () => ({
      documentPath: "chapter/one.txt",
      from: 4,
      to: 10,
      head: 10,
      line: 2,
      text: "選択本文",
    }),
    moveCursor: async () => true,
  },
  anchors: {
    create: async () => ({ id: "sample-anchor-id" }),
    resolve: async () => ({ documentPath: "chapter/one.txt", from: 4, to: 10 }),
    reveal: async () => ({ documentPath: "chapter/one.txt", from: 4, to: 10 }),
    delete: async (anchorId) => {
      deletedSampleAnchors.push(anchorId);
      return true;
    },
  },
  workspace: {
    onDidChangeWorkspace: () => ({ dispose() {} }),
    onDidChangeTextDocument: () => ({ dispose() {} }),
    onDidChangeSelection: () => ({ dispose() {} }),
  },
  storage: {
    get: async (key) => sampleStorage.get(key) ?? null,
    set: async (key, value) => {
      sampleStorage.set(key, value);
      return true;
    },
    delete: async (key) => sampleStorage.delete(key),
  },
  commands: {
    registerCommand: async (definition, handler) => {
      sampleCommands.push({ definition, handler });
      return { dispose() {} };
    },
  },
  views: {
    registerToolView: async (definition, render) => {
      sampleView = definition;
      await render(sampleWindow.document.querySelector("#plugin-root"));
      return { dispose() {} };
    },
    registerScreen: async (definition, render) => {
      sampleScreen = definition;
      const screenRoot = sampleWindow.document.createElement("div");
      screenRoot.id = "plugin-screen-root";
      sampleWindow.document.body.append(screenRoot);
      await render(screenRoot);
      return { dispose() {} };
    },
  },
};
await sampleWindow.eval(sampleSource);
assert.equal(sampleView?.id, "selection-notes");
assert.equal(sampleScreen?.id, "notes-library");
assert.equal(sampleCommands.length, 2, "sample plugin should register capture and navigation commands");
assert.match(sampleWindow.document.body.textContent, /Selection Notes/);
assert.match(sampleWindow.document.querySelector("#plugin-screen-root").textContent, /保存済みノート/);

sampleWindow.document.querySelector(".captureButton").click();
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(sampleStorage.get("selectionNotes.v1")?.length, 1, "sample must persist a captured note");
assert.equal(sampleWindow.document.querySelectorAll(".noteCard").length, 1);

const sampleDelete = sampleWindow.document.querySelector(".dangerButton");
sampleDelete.click();
sampleDelete.click();
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(sampleStorage.get("selectionNotes.v1")?.length, 0, "sample must remove its stored note");
assert.deepEqual(deletedSampleAnchors, ["sample-anchor-id"]);
sampleDom.window.close();

const todoSource = await readFile("docs/ticket/main.js", "utf8");
const todoManifest = JSON.parse(await readFile("docs/ticket/manifest.json", "utf8"));
assert.match(todoSource, /\.todoCardTitle[^}]*font-size:\s*14px/, "Ticket board card titles must remain legible");
assert.match(todoSource, /\.todoCardDetails[^}]*font-size:\s*12\.5px/, "Ticket board card details must remain legible");
assert.match(todoSource, /\.todoColumnHeader h2[^}]*font-size:\s*14px/, "Ticket board column labels must remain legible");
assert.match(todoSource, /\.todoQuickApp[^}]*font-size:\s*13px/, "Ticket sidebar must use the board base font size");
assert.match(todoSource, /\.todoQuickHeader h1[^}]*font-size:\s*14px/, "Ticket sidebar headings must match board column headings");
assert.match(todoSource, /\.todoQuickItem strong[^}]*font-size:\s*14px/, "Ticket sidebar titles must match board card titles");
assert.match(todoSource, /\.todoQuickDetails[^}]*font-size:\s*12\.5px/, "Ticket sidebar details must match board card details");
assert.match(todoSource, /\.ticketGlobalHeader h1[^}]*font-size:\s*15px/, "Ticket sidebar modal heading must match the board modal heading");
assert.match(todoSource, /\.ticketGlobalField input[^}]*font-size:\s*13px/, "Ticket sidebar modal fields must match the board modal fields");
assert.match(todoSource, /\.ticketGlobalButton[^}]*font-size:\s*13px/, "Ticket sidebar modal buttons must match board buttons");
assert.ok(todoManifest.icon.paths.length > 0);
assert.ok(todoManifest.permissions.includes("storage"));
assert.match(todoSource, /registerToolView/);
assert.match(todoSource, /registerScreen/);
assert.match(todoSource, /ondrop/);
assert.match(todoSource, /Mod\+Alt\+T/);
const ticketEditorRequestSource = todoSource.match(/const requestTicketEditor[\s\S]*?\n};/)?.[0] ?? "";
assert.match(ticketEditorRequestSource, /openModal\("ticket-detail"\)/);
assert.doesNotMatch(ticketEditorRequestSource, /views\.open\("ticket-board"\)/);

const todoDom = new JSDOM("<body></body>", {
  runScripts: "outside-only",
  url: "https://then-plugin.invalid/",
});
const todoWindow = todoDom.window;
Object.defineProperty(todoWindow.crypto, "randomUUID", {
  configurable: true,
  value: () => { throw new todoWindow.DOMException("opaque origin"); },
});
const todoStorage = new Map();
const todoCommands = [];
const todoToolDefinitions = [];
const todoOpenedViews = [];
const todoOpenedModals = [];
const todoClosedModals = [];
const todoStatusItems = new Map();
let todoWorkspaceChangeListener = null;
let todoScreenDefinition = null;
let todoModalDefinition = null;
todoWindow.then = {
  editor: {
    getSelection: async () => ({
      documentPath: "chapter/one.txt",
      from: 0,
      to: 4,
      head: 4,
      line: 1,
      text: "推敲する",
    }),
  },
  workspace: {
    onDidChangeWorkspace: (listener) => {
      todoWorkspaceChangeListener = listener;
      return { dispose() {} };
    },
    onDidChangeTextDocument: () => ({ dispose() {} }),
  },
  storage: {
    get: async (key) => todoStorage.get(key) ?? null,
    set: async (key, value) => {
      todoStorage.set(key, value);
      return true;
    },
    delete: async (key) => todoStorage.delete(key),
  },
  commands: {
    registerCommand: async (definition, handler) => {
      todoCommands.push({ definition, handler });
      return { dispose() {} };
    },
  },
  views: {
    registerToolView: async (definition, render) => {
      todoToolDefinitions.push(definition);
      const root = todoWindow.document.createElement("div");
      root.id = `todo-tool-root-${definition.id}`;
      todoWindow.document.body.append(root);
      await render(root);
      return { dispose() {} };
    },
    registerScreen: async (definition, render) => {
      todoScreenDefinition = definition;
      const root = todoWindow.document.createElement("div");
      root.id = "todo-screen-root";
      todoWindow.document.body.append(root);
      await render(root);
      return { dispose() {} };
    },
    registerModal: async (definition, render) => {
      todoModalDefinition = definition;
      const root = todoWindow.document.createElement("div");
      root.id = "todo-modal-root";
      todoWindow.document.body.append(root);
      await render(root);
      return { dispose() {} };
    },
    open: async (viewId) => {
      todoOpenedViews.push(viewId);
      return true;
    },
    openModal: async (modalId) => {
      todoOpenedModals.push(modalId);
      return true;
    },
    closeModal: async (modalId) => {
      todoClosedModals.push(modalId);
      return true;
    },
  },
  statusBar: {
    setItem: async (definition) => {
      todoStatusItems.set(definition.id, { ...definition });
      return true;
    },
    removeItem: async (id) => {
      todoStatusItems.delete(id);
      return true;
    },
  },
};
await todoWindow.eval(todoSource);
await new Promise((resolve) => setTimeout(resolve, 10));
assert.deepEqual(todoToolDefinitions.map((view) => view.id), ["ticket-unstarted", "ticket-doing"]);
assert.ok(todoToolDefinitions.every((view) => view.icon?.paths.length > 0), "multiple views should have distinct declarative icons");
assert.equal(todoScreenDefinition?.id, "ticket-board");
assert.equal(todoModalDefinition?.id, "ticket-detail");
assert.equal(todoCommands.length, 3);
assert.equal(todoManifest.name, "Ticket");
assert.ok(todoManifest.permissions.includes("statusbar"));
assert.equal(todoManifest.permissions.includes("document:read"), false, "Ticket must not subscribe to document edits just to refresh an unchanged status item");
assert.doesNotMatch(todoSource, /onDidChangeTextDocument/, "typing in the editor must not remove and recreate the current-ticket status item");
assert.equal(typeof todoWorkspaceChangeListener, "function", "Ticket must reload when the project changes");
assert.match(todoWindow.document.querySelector("#todo-screen-root").textContent, /未着手/);
assert.doesNotMatch(todoWindow.document.querySelector("#todo-screen-root").textContent, /このプロジェクトの作業を/);

const selectionCommand = todoCommands.find(({ definition }) => definition.id === "create-from-selection");
assert.deepEqual(Array.from(selectionCommand?.definition.menus ?? []), ["editor.selection"]);
await selectionCommand.handler();
assert.equal(todoOpenedModals.at(-1), "ticket-detail", "selection command must open the modal without changing screens");
assert.equal(todoWindow.document.querySelector('[name="globalTicketTitle"]').value, "", "selection must not become the title");
assert.equal(todoWindow.document.querySelector('[name="globalTicketDetails"]').value, "推敲する");
assert.equal(todoWindow.document.querySelector('[name="globalTicketTarget"]').value, "chapter/one.txt");
todoWindow.document.querySelector(".ticketGlobalCancel").click();
assert.equal(todoClosedModals.at(-1), "ticket-detail");

const backlogColumn = todoWindow.document.querySelector('.todoColumn[data-status="backlog"]');
backlogColumn.querySelector(".todoAddCardTrigger").click();
const ticketTitle = todoWindow.document.querySelector('[name="ticketTitle"]');
const ticketType = todoWindow.document.querySelector('[name="ticketType"]');
const ticketTarget = todoWindow.document.querySelector('[name="ticketTarget"]');
const ticketDetails = todoWindow.document.querySelector('[name="ticketDetails"]');
const ticketCurrent = todoWindow.document.querySelector('[name="ticketCurrent"]');
ticketTitle.value = "第1章を推敲する";
ticketType.value = "issue";
ticketTarget.value = "第1章";
ticketDetails.value = "語尾と段落の流れを確認する";
ticketCurrent.checked = true;
todoWindow.document.querySelector(".ticketModalSave").click();
assert.equal(todoWindow.document.querySelectorAll("#todo-screen-root .todoCard").length, 1, "the add button must update the board immediately");
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(todoStorage.get("todoBoard.v1")?.length, 1, "the board add button must save tasks without crypto.randomUUID");
const firstTicket = todoStorage.get("todoBoard.v1")[0];
assert.equal(firstTicket.ticketNumber, 1);
assert.equal(firstTicket.type, "issue");
assert.equal(firstTicket.target, "第1章");
assert.equal(firstTicket.details, "語尾と段落の流れを確認する");
assert.equal(todoStorage.get("ticket.current.v1"), firstTicket.id);
assert.equal(todoStatusItems.get("current-ticket")?.text, "#001 第1章を推敲する");
assert.equal(todoStatusItems.get("current-ticket")?.commandId, "open-current-ticket");
assert.equal(todoWindow.document.querySelectorAll("#todo-screen-root .todoCard").length, 1);
assert.equal(todoWindow.document.querySelectorAll("#todo-tool-root-ticket-unstarted .todoQuickItem").length, 1);

const unstartedRoot = todoWindow.document.querySelector("#todo-tool-root-ticket-unstarted");
const openedViewCountBeforeSidebarEdit = todoOpenedViews.length;
const openedModalCountBeforeSidebarEdit = todoOpenedModals.length;
unstartedRoot.querySelector(".todoQuickItem").click();
assert.equal(todoOpenedViews.length, openedViewCountBeforeSidebarEdit, "sidebar card clicks must keep the editor screen open");
assert.equal(todoOpenedModals.length, openedModalCountBeforeSidebarEdit + 1);
assert.equal(todoOpenedModals.at(-1), "ticket-detail");
assert.equal(todoWindow.document.querySelector('[name="globalTicketTitle"]').value, "第1章を推敲する");
assert.equal(todoWindow.document.querySelector('[name="globalTicketDetails"]').value, "語尾と段落の流れを確認する");
todoWindow.document.querySelector(".ticketGlobalCancel").click();
unstartedRoot.querySelector(".todoQuickCreate").click();
assert.equal(todoOpenedViews.length, openedViewCountBeforeSidebarEdit, "sidebar creation must not navigate to the board");
assert.equal(todoOpenedModals.at(-1), "ticket-detail");
assert.equal(todoWindow.document.querySelector(".ticketGlobalId").textContent, "#002");
todoWindow.document.querySelector(".ticketGlobalCancel").click();

backlogColumn.querySelector(".todoAddCardTrigger").click();
ticketTitle.value = "登場人物の動機を整理する";
ticketType.value = "want";
ticketTarget.value = "主人公";
ticketDetails.value = "選択に説得力を持たせる";
ticketCurrent.checked = false;
todoWindow.document.querySelector(".ticketModalSave").click();
await new Promise((resolve) => setTimeout(resolve, 20));
const storedAfterSecondCreate = todoStorage.get("todoBoard.v1");
assert.equal(storedAfterSecondCreate.length, 2);
const secondTicket = storedAfterSecondCreate.find((task) => task.ticketNumber === 2);
assert.ok(secondTicket, "ticket numbers must increase independently from board order");
assert.equal(todoStorage.get("ticket.next-number.v1"), 3);

const boardCards = [...todoWindow.document.querySelectorAll("#todo-screen-root .todoCard")];
const firstCard = boardCards.find((card) => card.dataset.taskId === firstTicket.id);
const secondCard = boardCards.find((card) => card.dataset.taskId === secondTicket.id);
const transfer = {
  value: "",
  setData(_type, value) { this.value = value; },
  getData() { return this.value; },
};
const dragStart = new todoWindow.Event("dragstart", { bubbles: true, cancelable: true });
Object.defineProperty(dragStart, "dataTransfer", { value: transfer });
secondCard.dispatchEvent(dragStart);
const drop = new todoWindow.Event("drop", { bubbles: true, cancelable: true });
Object.defineProperty(drop, "dataTransfer", { value: transfer });
firstCard.dispatchEvent(drop);
await new Promise((resolve) => setTimeout(resolve, 20));
const reordered = [...todoStorage.get("todoBoard.v1")]
  .filter((task) => task.status === "backlog")
  .sort((left, right) => left.order - right.order);
assert.deepEqual(reordered.map((task) => task.ticketNumber), [2, 1], "manual order must not renumber tickets");

const currentFirstCard = [...todoWindow.document.querySelectorAll("#todo-screen-root .todoCard")]
  .find((card) => card.dataset.taskId === firstTicket.id);
currentFirstCard.click();
ticketTitle.value = "第1章を再推敲する";
ticketType.value = "scene";
ticketTarget.value = "第1章・冒頭";
ticketDetails.value = "視点と語尾の流れを確認する";
todoWindow.document.querySelector('[name="ticketStatus"]').value = "doing";
todoWindow.document.querySelector(".ticketModalSave").click();
await new Promise((resolve) => setTimeout(resolve, 20));
const editedFirst = todoStorage.get("todoBoard.v1").find((task) => task.id === firstTicket.id);
assert.equal(editedFirst.ticketNumber, 1, "editing must preserve the auto-numbered ID");
assert.equal(editedFirst.title, "第1章を再推敲する");
assert.equal(editedFirst.type, "scene");
assert.equal(editedFirst.status, "doing");
assert.equal(todoStatusItems.get("current-ticket")?.text, "#001 第1章を再推敲する");
assert.equal(todoWindow.document.querySelectorAll("#todo-tool-root-ticket-doing .todoQuickItem").length, 1);

const doingStatus = todoWindow.document.querySelector("#todo-tool-root-ticket-doing .todoQuickStatus");
doingStatus.value = "done";
doingStatus.dispatchEvent(new todoWindow.Event("change", { bubbles: true }));
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(todoStorage.get("todoBoard.v1").find((task) => task.id === firstTicket.id).status, "done", "the sidebar view must persist status changes");
assert.equal(todoWindow.document.querySelectorAll("#todo-tool-root-ticket-doing .todoQuickItem").length, 0);

const currentCommand = todoCommands.find(({ definition }) => definition.id === "open-current-ticket");
await currentCommand.handler();
assert.equal(todoOpenedModals.at(-1), "ticket-detail", "current-ticket status action must keep the editor screen open");
assert.equal(todoWindow.document.querySelector(".ticketGlobalId").textContent, "#001");
todoWindow.document.querySelector(".ticketGlobalCancel").click();

const currentSecondCard = [...todoWindow.document.querySelectorAll("#todo-screen-root .todoCard")]
  .find((card) => card.dataset.taskId === secondTicket.id);
currentSecondCard.click();
const deleteTicket = todoWindow.document.querySelector(".ticketModalDelete");
deleteTicket.click();
deleteTicket.click();
await new Promise((resolve) => setTimeout(resolve, 20));
assert.ok(todoStorage.get("todoBoard.v1").find((task) => task.id === secondTicket.id).deletedAt, "delete must move a ticket into the trash");
assert.equal(todoWindow.document.querySelectorAll("#todo-screen-root .todoCard").length, 1);
assert.equal(todoWindow.document.querySelector(".todoTrashCount").textContent, "1");
todoWindow.document.querySelector(".todoTrashButton").click();
assert.equal(todoWindow.document.querySelectorAll(".todoTrashList .todoTrashItem").length, 1);
todoWindow.document.querySelector(".todoTrashList .todoTrashActions .todoButton").click();
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(todoStorage.get("todoBoard.v1").find((task) => task.id === secondTicket.id).deletedAt, null, "trash items must be restorable");
assert.equal(todoWindow.document.querySelectorAll("#todo-screen-root .todoCard").length, 2);
todoWindow.document.querySelector(".todoTrashClose").click();

const restoredSecondCard = [...todoWindow.document.querySelectorAll("#todo-screen-root .todoCard")]
  .find((card) => card.dataset.taskId === secondTicket.id);
restoredSecondCard.click();
deleteTicket.click();
deleteTicket.click();
await new Promise((resolve) => setTimeout(resolve, 20));
todoWindow.document.querySelector(".todoTrashButton").click();
const permanentDelete = todoWindow.document.querySelector(".todoTrashPermanent");
permanentDelete.click();
permanentDelete.click();
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(todoStorage.get("todoBoard.v1").some((task) => task.id === secondTicket.id), false, "trash must support confirmed permanent deletion");
todoWindow.document.querySelector(".todoTrashClose").click();

backlogColumn.querySelector(".todoAddCardTrigger").click();
assert.equal(todoWindow.document.querySelector(".ticketModalId").textContent, "#003", "deleted ticket numbers must not be reused");
ticketTitle.value = "伏線を確認する";
ticketType.value = "research";
ticketTarget.value = "全章";
ticketDetails.value = "回収漏れを確認する";
todoWindow.document.querySelector(".ticketModalSave").click();
await new Promise((resolve) => setTimeout(resolve, 20));
assert.ok(todoStorage.get("todoBoard.v1").some((task) => task.ticketNumber === 3));
assert.equal(todoStorage.get("ticket.next-number.v1"), 4);

const switchedTicket = {
  id: "second-project-ticket",
  title: "別プロジェクトを確認する",
  details: "切り替え後に自動で表示される",
  ticketNumber: 12,
  type: "issue",
  target: "第2章",
  status: "backlog",
  order: 0,
  deletedAt: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
todoStorage.clear();
todoStorage.set("todoBoard.v1", [switchedTicket]);
todoStorage.set("ticket.next-number.v1", 13);
todoStorage.set("ticket.current.v1", switchedTicket.id);
todoWorkspaceChangeListener({ name: "Second project", hasProject: true });
await new Promise((resolve) => setTimeout(resolve, 30));
assert.equal(todoClosedModals.at(-1), "ticket-detail", "switching projects must close a stale ticket editor");
assert.equal(
  todoWindow.document.querySelectorAll("#todo-screen-root .todoCard").length,
  1,
  "switching projects must replace the board without a manual reload",
);
assert.match(todoWindow.document.querySelector("#todo-screen-root .todoCard").textContent, /#012 別プロジェクトを確認する/);
assert.equal(todoStatusItems.get("current-ticket")?.text, "#012 別プロジェクトを確認する");
todoDom.window.close();

console.log("v0.6.1 plugin platform tests passed");
