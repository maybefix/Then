const STORAGE_KEY = "selectionNotes.v1";

const renderSelectionNotes = async (container) => {
  container.innerHTML = `
    <style>
      * { box-sizing: border-box; }
      .notesApp { display: flex; min-height: 100%; flex-direction: column; gap: 10px; color: var(--then-text); font-family: var(--then-font-family, inherit); }
      .notesHeader { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
      .notesHeader h1 { margin: 0; color: var(--then-text); font-size: 13px; letter-spacing: .01em; }
      .notesHeader p { margin: 3px 0 0; color: var(--then-text-muted); font-size: 10.5px; line-height: 1.5; }
      .notesCount { min-width: 32px; padding: 3px 8px; border: 1px solid var(--then-border); border-radius: 999px; background: var(--then-surface); color: var(--then-text-secondary); font-size: 10px; text-align: center; }
      .selectionCard, .composer, .noteCard { border: 1px solid var(--then-border); border-radius: var(--then-radius-card); background: var(--then-surface); }
      .selectionCard { display: grid; gap: 5px; padding: 10px 11px; }
      .eyebrow { color: var(--then-text-muted); font-size: 9.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      .selectionText { overflow: hidden; color: var(--then-text); font-size: 12px; line-height: 1.6; text-overflow: ellipsis; white-space: nowrap; }
      .selectionPath { overflow: hidden; color: var(--then-text-faint); font: 10px/1.4 ui-monospace, Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
      .composer { display: grid; gap: 8px; padding: 10px; }
      textarea, input[type="search"] { width: 100%; border: 1px solid var(--then-border); border-radius: var(--then-radius-control); outline: none; background: var(--then-input-background); color: var(--then-text); font: inherit; }
      textarea { min-height: 70px; resize: vertical; padding: 8px 9px; font-size: 12px; line-height: 1.55; }
      input[type="search"] { height: 32px; padding: 0 9px; font-size: 12px; }
      textarea:focus, input[type="search"]:focus { border-color: var(--then-accent); box-shadow: 0 0 0 2px var(--then-accent-soft); }
      button { min-height: 30px; border: 1px solid var(--then-border-strong); border-radius: var(--then-radius-button); background: transparent; color: var(--then-text-secondary); cursor: pointer; font: inherit; font-size: 11px; }
      button:hover:not(:disabled) { background: var(--then-control-hover); color: var(--then-text); }
      button:disabled { cursor: default; opacity: .45; }
      .primaryButton { border-color: var(--then-accent); background: var(--then-accent); color: var(--then-on-accent); font-weight: 700; }
      .primaryButton:hover:not(:disabled) { border-color: var(--then-accent-strong); background: var(--then-accent-strong); color: var(--then-on-accent); }
      .toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px; }
      .message { min-height: 18px; margin: 0; color: var(--then-text-muted); font-size: 10px; line-height: 1.5; }
      .message[data-kind="error"] { color: var(--then-danger); }
      .message[data-kind="success"] { color: var(--then-accent-strong); }
      .noteList { display: grid; gap: 8px; padding: 0; margin: 0; list-style: none; }
      .noteCard { display: grid; gap: 8px; padding: 10px; }
      .noteCard:hover { background: var(--then-surface-hover); }
      .noteBody { margin: 0; color: var(--then-text); font-size: 12px; font-weight: 650; line-height: 1.5; white-space: pre-wrap; }
      .noteExcerpt { padding-left: 8px; border-left: 2px solid var(--then-accent); color: var(--then-text-muted); font-size: 11px; line-height: 1.55; }
      .noteMeta { display: flex; min-width: 0; justify-content: space-between; gap: 8px; color: var(--then-text-faint); font-size: 9px; }
      .noteMeta span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .noteActions { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 6px; }
      .dangerButton { color: var(--then-danger); }
      .dangerButton[data-confirming="true"] { border-color: var(--then-danger); background: var(--then-danger-soft); color: var(--then-danger); }
      .emptyState { padding: 24px 10px; border: 1px dashed var(--then-border); border-radius: var(--then-radius-card); color: var(--then-text-muted); font-size: 11px; line-height: 1.7; text-align: center; }
    </style>
    <main class="notesApp">
      <header class="notesHeader">
        <div>
          <h1>Selection Notes</h1>
          <p>本文を変更せず、選択範囲へメモを結び付けます。</p>
        </div>
        <span class="notesCount" aria-label="ノート件数">0</span>
      </header>
      <section class="selectionCard" aria-label="現在の選択範囲">
        <span class="eyebrow">Current selection</span>
        <span class="selectionText">選択範囲を取得しています…</span>
        <span class="selectionPath"></span>
      </section>
      <section class="composer" aria-label="ノートを追加">
        <textarea aria-label="ノート本文" placeholder="この箇所について残すメモ（未入力なら選択文を使用）"></textarea>
        <button class="primaryButton captureButton" type="button">この範囲へノートを追加</button>
        <p class="message" role="status" aria-live="polite"></p>
      </section>
      <div class="toolbar">
        <input class="searchInput" type="search" aria-label="ノートを検索" placeholder="ノート・本文・ファイルを検索">
        <button class="refreshButton" type="button" title="保存データを再読み込み">再読込</button>
      </div>
      <ol class="noteList"></ol>
      <div class="emptyState" hidden></div>
    </main>
  `;

  const elements = {
    count: container.querySelector(".notesCount"),
    selectionText: container.querySelector(".selectionText"),
    selectionPath: container.querySelector(".selectionPath"),
    textarea: container.querySelector("textarea"),
    capture: container.querySelector(".captureButton"),
    message: container.querySelector(".message"),
    search: container.querySelector(".searchInput"),
    refresh: container.querySelector(".refreshButton"),
    list: container.querySelector(".noteList"),
    empty: container.querySelector(".emptyState"),
  };

  let notes = [];
  let selection = null;
  let busy = false;

  const formatDate = (timestamp) =>
    new Intl.DateTimeFormat("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp));

  const compactText = (value, fallback) => {
    const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!normalized) return fallback;
    return normalized.length > 100 ? `${normalized.slice(0, 100)}…` : normalized;
  };

  const setMessage = (text, kind = "info") => {
    elements.message.textContent = text;
    elements.message.dataset.kind = kind;
  };

  const setBusy = (value) => {
    busy = value;
    elements.capture.disabled = value || !selection?.documentPath;
    elements.refresh.disabled = value;
  };

  const renderSelection = () => {
    if (!selection?.documentPath) {
      elements.selectionText.textContent = "プロジェクト内の本文を選択してください";
      elements.selectionPath.textContent = "";
      elements.capture.disabled = true;
      return;
    }
    elements.selectionText.textContent = selection.text
      ? compactText(selection.text, "")
      : `カーソル位置（${selection.line}行）`;
    elements.selectionPath.textContent = `${selection.documentPath} · ${selection.from}–${selection.to}`;
    elements.capture.disabled = busy;
  };

  const saveNotes = async () => then.storage.set(STORAGE_KEY, notes);

  const revealNote = async (note) => {
    setMessage("アンカーを解決しています…");
    try {
      const resolved = await then.anchors.reveal(note.anchorId);
      if (!resolved) {
        setMessage("編集内容からノート位置を一意に特定できませんでした。", "error");
        return;
      }
      setMessage(`「${compactText(note.body, note.excerpt)}」へ移動しました。`, "success");
    } catch (error) {
      setMessage(String(error), "error");
    }
  };

  const removeNote = async (note) => {
    const nextNotes = notes.filter((candidate) => candidate.id !== note.id);
    await then.storage.set(STORAGE_KEY, nextNotes);
    await then.anchors.delete(note.anchorId);
    notes = nextNotes;
    renderNotes();
    setMessage("ノートを削除しました。", "success");
  };

  const renderNotes = () => {
    const query = elements.search.value.trim().toLocaleLowerCase();
    const visibleNotes = notes.filter((note) =>
      [note.body, note.excerpt, note.documentPath]
        .join("\n")
        .toLocaleLowerCase()
        .includes(query),
    );
    elements.count.textContent = String(notes.length);
    elements.list.replaceChildren();
    elements.empty.hidden = visibleNotes.length > 0;
    elements.empty.textContent = query
      ? "検索条件に一致するノートはありません。"
      : "ノートはまだありません。本文を選択して、最初のノートを追加してください。";

    for (const note of visibleNotes) {
      const item = document.createElement("li");
      item.className = "noteCard";
      const body = document.createElement("p");
      body.className = "noteBody";
      body.textContent = note.body || note.excerpt || "カーソル位置のノート";
      const excerpt = document.createElement("div");
      excerpt.className = "noteExcerpt";
      excerpt.textContent = note.excerpt || "（選択文字列なし）";
      const meta = document.createElement("div");
      meta.className = "noteMeta";
      const path = document.createElement("span");
      path.textContent = note.documentPath;
      path.title = note.documentPath;
      const date = document.createElement("span");
      date.textContent = formatDate(note.createdAt);
      meta.append(path, date);
      const actions = document.createElement("div");
      actions.className = "noteActions";
      const reveal = document.createElement("button");
      reveal.type = "button";
      reveal.textContent = "本文へ移動";
      reveal.onclick = () => revealNote(note);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "dangerButton";
      remove.textContent = "削除";
      remove.onclick = () => {
        if (remove.dataset.confirming === "true") {
          removeNote(note).catch((error) => setMessage(String(error), "error"));
          return;
        }
        remove.dataset.confirming = "true";
        remove.textContent = "もう一度押して削除";
        window.setTimeout(() => {
          if (!remove.isConnected) return;
          remove.dataset.confirming = "false";
          remove.textContent = "削除";
        }, 3000);
      };
      actions.append(reveal, remove);
      item.append(body, excerpt, meta, actions);
      elements.list.append(item);
    }
  };

  const refreshSelection = async () => {
    selection = await then.editor.getSelection();
    renderSelection();
  };

  const loadNotes = async () => {
    const stored = await then.storage.get(STORAGE_KEY);
    notes = Array.isArray(stored) ? stored : [];
    renderNotes();
  };

  const captureSelection = async ({ useComposer = true } = {}) => {
    if (busy) return;
    await refreshSelection();
    if (!selection?.documentPath) {
      setMessage("プロジェクト内の本文を選択してください。", "error");
      return;
    }
    const body = useComposer ? elements.textarea.value.trim() : "";
    const excerpt = compactText(selection.text, `カーソル位置（${selection.line}行）`);
    if (!body && !selection.text) {
      setMessage("範囲を選択するか、ノート本文を入力してください。", "error");
      elements.textarea.focus();
      return;
    }

    setBusy(true);
    setMessage("永続アンカーを作成しています…");
    let createdAnchor = null;
    try {
      createdAnchor = await then.anchors.create({ from: selection.from, to: selection.to });
      notes = [
        {
          id: crypto.randomUUID(),
          anchorId: createdAnchor.id,
          documentPath: selection.documentPath,
          body,
          excerpt,
          createdAt: Date.now(),
        },
        ...notes,
      ];
      await saveNotes();
      elements.textarea.value = "";
      renderNotes();
      setMessage("本文を変更せずにノートを追加しました。", "success");
    } catch (error) {
      if (createdAnchor) {
        try {
          await then.anchors.delete(createdAnchor.id);
        } catch {
          // 保存失敗後の後始末にも失敗した場合は、元のエラーを優先して表示する。
        }
      }
      setMessage(String(error), "error");
    } finally {
      setBusy(false);
      renderSelection();
    }
  };

  const jumpToNextNote = async () => {
    await refreshSelection();
    if (notes.length === 0) {
      setMessage("移動できるノートがありません。", "error");
      return;
    }
    const resolvedNotes = (await Promise.all(
      notes.map(async (note) => ({ note, anchor: await then.anchors.resolve(note.anchorId) })),
    )).filter((item) => item.anchor);
    if (resolvedNotes.length === 0) {
      setMessage("解決できるノート位置がありません。", "error");
      return;
    }
    const sameDocument = resolvedNotes
      .filter((item) => item.anchor.documentPath === selection?.documentPath)
      .sort((left, right) => left.anchor.from - right.anchor.from);
    const nextInDocument = sameDocument.find(
      (item) => item.anchor.from > (selection?.head ?? -1),
    );
    const wrapped = !nextInDocument && sameDocument.length > 0;
    const target = nextInDocument ?? sameDocument[0] ?? resolvedNotes[0];
    await then.editor.moveCursor({ anchorId: target.note.anchorId });
    setMessage(
      wrapped ? "先頭のノートへ戻りました。" : "次のノートへ移動しました。",
      "success",
    );
  };

  elements.capture.onclick = () => captureSelection();
  elements.refresh.onclick = () => {
    loadNotes()
      .then(() => setMessage("保存データを再読み込みしました。", "success"))
      .catch((error) => setMessage(String(error), "error"));
  };
  elements.search.oninput = renderNotes;
  then.workspace.onDidChangeSelection((nextSelection) => {
    selection = nextSelection;
    renderSelection();
  });
  then.workspace.onDidChangeTextDocument((event) => {
    if (notes.some((note) => note.documentPath === event.documentPath)) {
      setMessage("本文の変更を検知しました。アンカー位置を追従しています。");
    }
  });

  await then.commands.registerCommand(
    {
      id: "capture-selection",
      title: "Selection Notes: 選択範囲をすぐ記録",
      keybinding: "Mod+Alt+M",
    },
    () => captureSelection({ useComposer: false }),
  );
  await then.commands.registerCommand(
    {
      id: "next-note",
      title: "Selection Notes: 次のノートへ移動",
      keybinding: "Mod+Alt+J",
    },
    jumpToNextNote,
  );

  try {
    await Promise.all([loadNotes(), refreshSelection()]);
    setMessage("準備ができました。");
  } catch (error) {
    setMessage(String(error), "error");
  }
};

then.views.registerToolView(
  { id: "selection-notes", title: "Selection Notes" },
  renderSelectionNotes,
);

const renderNotesLibrary = async (container) => {
  container.innerHTML = `
    <style>
      .libraryApp { min-height: 100%; color: var(--then-text); background: var(--then-background); font-family: var(--then-font-family, inherit); }
      .libraryHeader { display: flex; min-height: 74px; align-items: center; justify-content: space-between; gap: 24px; padding: 14px 24px; border-bottom: 1px solid var(--then-border); background: var(--then-surface); }
      .libraryTitle h1 { margin: 0; color: var(--then-text); font-size: 19px; font-weight: 700; }
      .libraryTitle p { margin: 4px 0 0; color: var(--then-text-muted); font-size: 11px; }
      .libraryHeaderActions { display: flex; align-items: center; gap: 8px; }
      .libraryHeaderActions input { width: min(320px, 32vw); height: 34px; padding: 0 10px; border: 1px solid var(--then-border); border-radius: var(--then-radius-control); outline: none; background: var(--then-input-background); color: var(--then-text); }
      .libraryHeaderActions input:focus { border-color: var(--then-accent); box-shadow: 0 0 0 2px var(--then-accent-soft); }
      .libraryHeaderActions button, .libraryCard button { min-height: 32px; padding: 0 12px; border: 1px solid var(--then-border-strong); border-radius: var(--then-radius-button); background: transparent; color: var(--then-text-secondary); cursor: pointer; font: inherit; }
      .libraryHeaderActions button:hover, .libraryCard button:hover { background: var(--then-control-hover); color: var(--then-text); }
      .libraryContent { display: grid; gap: 18px; padding: 20px 24px 28px; }
      .librarySummary { display: grid; grid-template-columns: repeat(2, minmax(180px, 260px)); gap: 10px; }
      .libraryMetric { display: grid; gap: 4px; padding: 13px 15px; border: 1px solid var(--then-border); border-radius: var(--then-radius-card); background: var(--then-surface); }
      .libraryMetric strong { color: var(--then-text); font-size: 22px; }
      .libraryMetric span { color: var(--then-text-muted); font-size: 10px; }
      .libraryStatus { min-height: 18px; margin: 0; color: var(--then-text-muted); font-size: 11px; }
      .libraryGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
      .libraryCard { display: grid; min-height: 170px; align-content: start; gap: 10px; padding: 14px; border: 1px solid var(--then-border); border-radius: var(--then-radius-card); background: var(--then-surface); }
      .libraryCard:hover { border-color: var(--then-border-strong); background: var(--then-surface-hover); }
      .libraryCard h2 { margin: 0; color: var(--then-text); font-size: 13px; line-height: 1.5; }
      .libraryExcerpt { margin: 0; padding-left: 9px; border-left: 2px solid var(--then-accent); color: var(--then-text-muted); font-size: 11px; line-height: 1.6; }
      .libraryPath { overflow: hidden; color: var(--then-text-faint); font: 10px/1.4 ui-monospace, Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
      .libraryCard button { justify-self: start; margin-top: auto; }
      .libraryEmpty { padding: 50px 20px; border: 1px dashed var(--then-border); border-radius: var(--then-radius-card); color: var(--then-text-muted); text-align: center; }
      @media (max-width: 720px) { .libraryHeader { align-items: stretch; flex-direction: column; gap: 10px; } .libraryHeaderActions input { width: 100%; } .librarySummary { grid-template-columns: 1fr 1fr; } }
    </style>
    <main class="libraryApp">
      <header class="libraryHeader">
        <div class="libraryTitle"><h1>Selection Notes</h1><p>プロジェクト内のノートを横断して確認します。</p></div>
        <div class="libraryHeaderActions">
          <input class="librarySearch" type="search" aria-label="ノートを検索" placeholder="ノート・本文・ファイルを検索">
          <button class="libraryRefresh" type="button">再読込</button>
        </div>
      </header>
      <div class="libraryContent">
        <div class="librarySummary">
          <div class="libraryMetric"><strong class="libraryNoteCount">0</strong><span>保存済みノート</span></div>
          <div class="libraryMetric"><strong class="libraryFileCount">0</strong><span>関連ファイル</span></div>
        </div>
        <p class="libraryStatus" role="status" aria-live="polite"></p>
        <section class="libraryGrid" aria-label="ノート一覧"></section>
        <div class="libraryEmpty" hidden>右サイドバーのSelection Notesから、本文の選択範囲へノートを追加できます。</div>
      </div>
    </main>
  `;

  const elements = {
    search: container.querySelector(".librarySearch"),
    refresh: container.querySelector(".libraryRefresh"),
    noteCount: container.querySelector(".libraryNoteCount"),
    fileCount: container.querySelector(".libraryFileCount"),
    status: container.querySelector(".libraryStatus"),
    grid: container.querySelector(".libraryGrid"),
    empty: container.querySelector(".libraryEmpty"),
  };
  let notes = [];

  const render = () => {
    const query = elements.search.value.trim().toLocaleLowerCase();
    const visible = notes.filter((note) =>
      [note.body, note.excerpt, note.documentPath].join("\n").toLocaleLowerCase().includes(query),
    );
    elements.noteCount.textContent = String(notes.length);
    elements.fileCount.textContent = String(new Set(notes.map((note) => note.documentPath)).size);
    elements.grid.replaceChildren();
    elements.empty.hidden = visible.length > 0;
    elements.empty.textContent = notes.length === 0
      ? "右サイドバーのSelection Notesから、本文の選択範囲へノートを追加できます。"
      : "検索条件に一致するノートはありません。";
    for (const note of visible) {
      const card = document.createElement("article");
      card.className = "libraryCard";
      const title = document.createElement("h2");
      title.textContent = note.body || note.excerpt || "カーソル位置のノート";
      const excerpt = document.createElement("p");
      excerpt.className = "libraryExcerpt";
      excerpt.textContent = note.excerpt || "（選択文字列なし）";
      const path = document.createElement("span");
      path.className = "libraryPath";
      path.textContent = note.documentPath;
      path.title = note.documentPath;
      const reveal = document.createElement("button");
      reveal.type = "button";
      reveal.textContent = "本文で開く";
      reveal.onclick = async () => {
        elements.status.textContent = "アンカーを解決しています…";
        const resolved = await then.anchors.reveal(note.anchorId);
        elements.status.textContent = resolved
          ? "ノートを結び付けた本文へ移動しました。"
          : "編集内容から位置を一意に特定できませんでした。";
      };
      card.append(title, excerpt, path, reveal);
      elements.grid.append(card);
    }
  };

  const load = async () => {
    const stored = await then.storage.get(STORAGE_KEY);
    notes = Array.isArray(stored) ? stored : [];
    render();
    elements.status.textContent = "プロジェクト保存領域から最新のノートを読み込みました。";
  };
  elements.search.oninput = render;
  elements.refresh.onclick = () => load().catch((error) => {
    elements.status.textContent = String(error);
  });
  await load();
};

then.views.registerScreen(
  { id: "notes-library", title: "Selection Notes" },
  renderNotesLibrary,
);
