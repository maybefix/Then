const TODO_STORAGE_KEY = "todoBoard.v1";
const CURRENT_TICKET_STORAGE_KEY = "ticket.current.v1";
const NEXT_TICKET_NUMBER_STORAGE_KEY = "ticket.next-number.v1";
const TODO_STATUSES = ["backlog", "doing", "done"];
const TODO_STATUS_LABELS = {
  backlog: "未着手",
  doing: "進行中",
  done: "完了",
};
const TICKET_TYPES = ["want", "issue", "scene", "research", "other"];
const TICKET_TYPE_LABELS = {
  want: "Want",
  issue: "課題",
  scene: "シーン",
  research: "調査",
  other: "その他",
};

let todoTasks = [];
let todoSaveQueue = Promise.resolve();
let todoIdSequence = 0;
let todoMutationVersion = 0;
let workspaceVersion = 0;
let nextTicketNumber = 1;
let currentTicketId = null;
let ticketDetailOpenEditor = null;
let pendingTicketEditor = null;
const todoListeners = new Set();

const createTodoTaskId = () => {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  } catch {
    // Opaque sandbox origins may expose Web Crypto while rejecting randomUUID.
  }
  todoIdSequence += 1;
  return `todo-${Date.now().toString(36)}-${todoIdSequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

const normalizeTask = (value, index = 0) => {
  if (!value || typeof value !== "object" || typeof value.id !== "string") return null;
  const title = typeof value.title === "string" ? value.title.trim() : "";
  if (!title) return null;
  return {
    id: value.id,
    title,
    details: typeof value.details === "string" ? value.details : "",
    ticketNumber: Number.isInteger(value.ticketNumber) && value.ticketNumber > 0
      ? value.ticketNumber
      : null,
    type: TICKET_TYPES.includes(value.type) ? value.type : "want",
    target: typeof value.target === "string" ? value.target : "",
    status: TODO_STATUSES.includes(value.status) ? value.status : "backlog",
    order: Number.isFinite(value.order) ? value.order : index,
    deletedAt: Number.isFinite(value.deletedAt) ? value.deletedAt : null,
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
  };
};

const assignMissingTicketNumbers = (tasks) => {
  let nextNumber = tasks.reduce(
    (maximum, task) => Math.max(maximum, task.ticketNumber || 0),
    0,
  ) + 1;
  return tasks.map((task) => task.ticketNumber
    ? task
    : { ...task, ticketNumber: nextNumber++ });
};

const ticketLabel = (task) => `#${String(task.ticketNumber || 0).padStart(3, "0")}`;

const notifyTodoListeners = () => {
  const snapshot = todoTasks.map((task) => ({ ...task }));
  for (const listener of todoListeners) listener(snapshot);
};

const loadTodoTasks = async () => {
  const workspaceAtStart = workspaceVersion;
  const versionAtStart = todoMutationVersion;
  const [stored, storedNextNumber] = await Promise.all([
    then.storage.get(TODO_STORAGE_KEY),
    then.storage.get(NEXT_TICKET_NUMBER_STORAGE_KEY),
  ]);
  if (workspaceVersion === workspaceAtStart && todoMutationVersion === versionAtStart) {
    todoTasks = assignMissingTicketNumbers(
      Array.isArray(stored) ? stored.map(normalizeTask).filter(Boolean) : [],
    );
    const minimumNextNumber = todoTasks.reduce(
      (maximum, task) => Math.max(maximum, task.ticketNumber || 0),
      0,
    ) + 1;
    nextTicketNumber = Math.max(
      Number.isInteger(storedNextNumber) && storedNextNumber > 0 ? storedNextNumber : 1,
      minimumNextNumber,
    );
    if (storedNextNumber !== nextTicketNumber) {
      await then.storage.set(NEXT_TICKET_NUMBER_STORAGE_KEY, nextTicketNumber);
    }
    notifyTodoListeners();
  }
  return todoTasks;
};

const updateTodoTasks = (updater) => {
  const workspaceAtStart = workspaceVersion;
  const previous = todoTasks.map((task) => ({ ...task }));
  const next = assignMissingTicketNumbers(updater(previous).map(normalizeTask).filter(Boolean));
  const mutationVersion = ++todoMutationVersion;
  todoTasks = next;
  notifyTodoListeners();
  const snapshot = next.map((task) => ({ ...task }));
  const pending = todoSaveQueue.catch(() => undefined).then(
    () => then.storage.set(TODO_STORAGE_KEY, snapshot),
  );
  todoSaveQueue = pending;
  return pending.then(async (value) => {
    if (workspaceVersion !== workspaceAtStart) return value;
    if (currentTicketId) {
      if (todoTasks.some((task) => task.id === currentTicketId && !task.deletedAt)) {
        await syncCurrentTicketStatus();
      } else {
        await setCurrentTicket(null);
      }
    }
    return value;
  }).catch((error) => {
    if (workspaceVersion === workspaceAtStart && todoMutationVersion === mutationVersion) {
      todoTasks = previous;
      notifyTodoListeners();
    }
    throw error;
  });
};

const createTodoTask = (input, legacyDetails = "", legacyStatus = "backlog") => {
  const definition = input && typeof input === "object"
    ? input
    : { title: input, details: legacyDetails, status: legacyStatus };
  const normalizedTitle = String(definition.title || "").trim();
  if (!normalizedTitle) return Promise.reject(new Error("チケット名を入力してください。"));
  const now = Date.now();
  let createdId = null;
  return updateTodoTasks((tasks) => {
    const status = TODO_STATUSES.includes(definition.status) ? definition.status : "backlog";
    const ticketNumber = nextTicketNumber++;
    const order = tasks
      .filter((task) => task.status === status && !task.deletedAt)
      .reduce((maximum, task) => Math.max(maximum, task.order), -1) + 1;
    createdId = createTodoTaskId();
    return [{
      id: createdId,
      title: normalizedTitle,
      details: String(definition.details || "").trim(),
      ticketNumber,
      type: TICKET_TYPES.includes(definition.type) ? definition.type : "want",
      target: String(definition.target || "").trim(),
      status,
      order,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    }, ...tasks];
  }).then(async () => {
    await then.storage.set(NEXT_TICKET_NUMBER_STORAGE_KEY, nextTicketNumber);
    return todoTasks.find((task) => task.id === createdId) ?? null;
  });
};

const updateTicket = (taskId, changes) => updateTodoTasks((tasks) => {
  const current = tasks.find((task) => task.id === taskId);
  if (!current) return tasks;
  const nextStatus = TODO_STATUSES.includes(changes.status) ? changes.status : current.status;
  const statusChanged = nextStatus !== current.status;
  const nextOrder = statusChanged
    ? tasks
        .filter((task) => task.id !== taskId && task.status === nextStatus && !task.deletedAt)
        .reduce((maximum, task) => Math.max(maximum, task.order), -1) + 1
    : current.order;
  return tasks.map((task) => task.id === taskId
    ? {
        ...task,
        ...changes,
        id: task.id,
        ticketNumber: task.ticketNumber,
        status: nextStatus,
        order: nextOrder,
        updatedAt: Date.now(),
      }
    : task);
});

const moveTodoTask = (taskId, status) => reorderTodoTask(taskId, status);

const removeTodoTask = (taskId) => updateTodoTasks((tasks) => tasks.map((task) =>
  task.id === taskId
    ? { ...task, deletedAt: Date.now(), updatedAt: Date.now() }
    : task,
));

const restoreTodoTask = (taskId) => updateTodoTasks((tasks) => {
  const restoring = tasks.find((task) => task.id === taskId && task.deletedAt);
  if (!restoring) return tasks;
  const order = tasks
    .filter((task) => task.id !== taskId && task.status === restoring.status && !task.deletedAt)
    .reduce((maximum, task) => Math.max(maximum, task.order), -1) + 1;
  return tasks.map((task) => task.id === taskId
    ? { ...task, order, deletedAt: null, updatedAt: Date.now() }
    : task);
});

const permanentlyDeleteTodoTask = (taskId) => updateTodoTasks(
  (tasks) => tasks.filter((task) => task.id !== taskId),
);

const reorderTodoTask = (taskId, status, beforeTaskId = null) => updateTodoTasks((tasks) => {
  const moving = tasks.find((task) => task.id === taskId);
  if (!moving || moving.deletedAt) return tasks;
  const remaining = tasks.filter((task) => task.id !== taskId);
  const destination = remaining
    .filter((task) => task.status === status && !task.deletedAt)
    .sort((left, right) => left.order - right.order);
  const beforeIndex = beforeTaskId
    ? destination.findIndex((task) => task.id === beforeTaskId)
    : -1;
  const insertIndex = beforeIndex >= 0 ? beforeIndex : destination.length;
  destination.splice(insertIndex, 0, {
    ...moving,
    status,
    updatedAt: Date.now(),
  });
  const destinationIds = new Set(destination.map((task) => task.id));
  return [
    ...remaining.filter((task) => task.status !== status || task.deletedAt),
    ...destination.map((task, order) => ({ ...task, order })),
    ...remaining.filter((task) => task.status === status && !task.deletedAt && !destinationIds.has(task.id)),
  ];
});

const subscribeTodoTasks = (listener) => {
  todoListeners.add(listener);
  listener(todoTasks.map((task) => ({ ...task })));
  return () => todoListeners.delete(listener);
};

const syncCurrentTicketStatus = async () => {
  const current = todoTasks.find((task) => task.id === currentTicketId && !task.deletedAt) ?? null;
  if (!current) {
    currentTicketId = null;
    await then.statusBar.removeItem("current-ticket");
    return;
  }
  await then.statusBar.setItem({
    id: "current-ticket",
    text: `${ticketLabel(current)} ${current.title}`,
    tooltip: "現在のチケット。クリックして詳細を開く",
    commandId: "open-current-ticket",
  });
};

const loadCurrentTicket = async () => {
  const workspaceAtStart = workspaceVersion;
  const stored = await then.storage.get(CURRENT_TICKET_STORAGE_KEY);
  if (workspaceVersion !== workspaceAtStart) return;
  currentTicketId = typeof stored === "string" ? stored : null;
  await syncCurrentTicketStatus();
};

const reloadWorkspaceTickets = async (hasProject) => {
  workspaceVersion += 1;
  currentTicketId = null;
  pendingTicketEditor = null;
  todoTasks = [];
  notifyTodoListeners();
  await then.views.closeModal("ticket-detail");
  await then.statusBar.removeItem("current-ticket");
  if (!hasProject) return;
  await loadTodoTasks();
  await loadCurrentTicket();
};

const setCurrentTicket = async (taskId) => {
  currentTicketId = taskId;
  if (taskId) await then.storage.set(CURRENT_TICKET_STORAGE_KEY, taskId);
  else await then.storage.delete(CURRENT_TICKET_STORAGE_KEY);
  await syncCurrentTicketStatus();
};

const requestTicketEditor = async (request = {}) => {
  pendingTicketEditor = request;
  ticketDetailOpenEditor?.(request);
  await then.views.openModal("ticket-detail");
};

const formatTodoDate = (timestamp) => new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
}).format(new Date(timestamp));

const renderTicketDetailModal = async (container) => {
  container.innerHTML = `
    <style>
      * { box-sizing: border-box; }
      .ticketGlobalBackdrop { display: grid; width: 100%; height: 100%; place-items: center; padding: 24px; background: color-mix(in srgb, var(--then-background) 72%, transparent); color: var(--then-text); font-family: var(--then-font-family, inherit); backdrop-filter: blur(1.5px); }
      .ticketGlobalModal { display: flex; width: min(900px, 100%); max-height: min(760px, 100%); flex-direction: column; overflow: hidden; border: 1px solid var(--then-border-strong); border-radius: 10px; background: var(--then-surface); box-shadow: 0 24px 64px rgba(0,0,0,.34); }
      .ticketGlobalHeader { display: flex; min-height: 54px; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 12px; padding: 0 20px; border-bottom: 1px solid var(--then-border); }
      .ticketGlobalHeader h1 { margin: 0; color: var(--then-text); font-size: 15px; }
      .ticketGlobalId { color: var(--then-accent-strong); font: 700 13px/1 ui-monospace, Consolas, monospace; }
      .ticketGlobalBody { display: grid; min-height: 0; gap: 14px; overflow-y: auto; padding: 18px 20px; }
      .ticketGlobalField { display: grid; gap: 6px; }
      .ticketGlobalField > span { color: var(--then-text-muted); font-size: 12px; font-weight: 650; }
      .ticketGlobalField input, .ticketGlobalField select, .ticketGlobalField textarea { width: 100%; border: 1px solid var(--then-border); border-radius: var(--then-radius-control); outline: none; background: var(--then-input-background); color: var(--then-text); font: inherit; font-size: 13px; }
      .ticketGlobalField input, .ticketGlobalField select { height: 40px; padding: 0 11px; }
      .ticketGlobalField textarea { min-height: 260px; resize: vertical; padding: 11px; line-height: 1.65; }
      .ticketGlobalField input:focus, .ticketGlobalField select:focus, .ticketGlobalField textarea:focus { border-color: var(--then-accent); box-shadow: 0 0 0 2px var(--then-accent-soft); }
      .ticketGlobalRow { display: grid; grid-template-columns: 1fr 1fr 1.5fr; gap: 12px; }
      .ticketGlobalCurrent { display: flex; align-items: center; gap: 8px; color: var(--then-text-secondary); font-size: 13px; }
      .ticketGlobalCurrent input { accent-color: var(--then-accent); }
      .ticketGlobalMessage { min-height: 17px; margin: 0; color: var(--then-text-muted); font-size: 12px; }
      .ticketGlobalFooter { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--then-border); }
      .ticketGlobalButton { min-height: 34px; padding: 0 13px; border: 1px solid var(--then-border-strong); border-radius: var(--then-radius-button); background: transparent; color: var(--then-text-secondary); cursor: pointer; font: inherit; font-size: 13px; }
      .ticketGlobalButton:hover { background: var(--then-control-hover); color: var(--then-text); }
      .ticketGlobalSave { border-color: var(--then-accent); background: var(--then-accent); color: var(--then-on-accent); font-weight: 700; }
      .ticketGlobalSave:hover { border-color: var(--then-accent-strong); background: var(--then-accent-strong); color: var(--then-on-accent); }
      .ticketGlobalDelete { margin-right: auto; color: var(--then-danger); }
      .ticketGlobalDelete[data-confirming="true"] { border-color: var(--then-danger); background: var(--then-danger-soft); }
      @media (max-width: 700px) { .ticketGlobalBackdrop { padding: 10px; } .ticketGlobalRow { grid-template-columns: 1fr; } .ticketGlobalField textarea { min-height: 180px; } }
    </style>
    <main class="ticketGlobalBackdrop">
      <section class="ticketGlobalModal" role="dialog" aria-modal="true" aria-label="チケット詳細">
        <header class="ticketGlobalHeader"><h1>チケット詳細</h1><span class="ticketGlobalId">#---</span></header>
        <div class="ticketGlobalBody">
          <label class="ticketGlobalField"><span>タイトル</span><input name="globalTicketTitle" autocomplete="off"></label>
          <div class="ticketGlobalRow">
            <label class="ticketGlobalField"><span>種別</span><select name="globalTicketType">${TICKET_TYPES.map((type) => `<option value="${type}">${TICKET_TYPE_LABELS[type]}</option>`).join("")}</select></label>
            <label class="ticketGlobalField"><span>状態</span><select name="globalTicketStatus">${TODO_STATUSES.map((status) => `<option value="${status}">${TODO_STATUS_LABELS[status]}</option>`).join("")}</select></label>
            <label class="ticketGlobalField"><span>対象</span><input name="globalTicketTarget" placeholder="章・人物・テーマなど"></label>
          </div>
          <label class="ticketGlobalField"><span>詳細</span><textarea name="globalTicketDetails" placeholder="Want、課題、検討内容、選択した本文など"></textarea></label>
          <label class="ticketGlobalCurrent"><input name="globalTicketCurrent" type="checkbox">このチケットを「現在のチケット」にする</label>
          <p class="ticketGlobalMessage" role="status" aria-live="polite"></p>
        </div>
        <footer class="ticketGlobalFooter"><button class="ticketGlobalButton ticketGlobalDelete" type="button">削除</button><button class="ticketGlobalButton ticketGlobalCancel" type="button">キャンセル</button><button class="ticketGlobalButton ticketGlobalSave" type="button">保存</button></footer>
      </section>
    </main>
  `;

  const backdrop = container.querySelector(".ticketGlobalBackdrop");
  const modalId = container.querySelector(".ticketGlobalId");
  const modalTitle = container.querySelector('[name="globalTicketTitle"]');
  const modalType = container.querySelector('[name="globalTicketType"]');
  const modalStatus = container.querySelector('[name="globalTicketStatus"]');
  const modalTarget = container.querySelector('[name="globalTicketTarget"]');
  const modalDetails = container.querySelector('[name="globalTicketDetails"]');
  const modalCurrent = container.querySelector('[name="globalTicketCurrent"]');
  const modalMessage = container.querySelector(".ticketGlobalMessage");
  const modalDelete = container.querySelector(".ticketGlobalDelete");
  const modalSave = container.querySelector(".ticketGlobalSave");
  let editingTicketId = null;

  const closeEditor = () => {
    editingTicketId = null;
    modalMessage.textContent = "";
    delete modalDelete.dataset.confirming;
    modalDelete.textContent = "削除";
    then.views.closeModal("ticket-detail").catch(() => undefined);
  };

  const openEditor = (request = {}) => {
    const task = request.taskId
      ? todoTasks.find((candidate) => candidate.id === request.taskId && !candidate.deletedAt) ?? null
      : null;
    editingTicketId = task?.id ?? null;
    modalId.textContent = task
      ? ticketLabel(task)
      : `#${String(nextTicketNumber).padStart(3, "0")}`;
    modalTitle.value = task?.title ?? request.title ?? "";
    modalType.value = task?.type ?? request.type ?? "want";
    modalStatus.value = task?.status ?? request.status ?? "backlog";
    modalTarget.value = task?.target ?? request.target ?? "";
    modalDetails.value = task?.details ?? request.details ?? "";
    modalCurrent.checked = Boolean(task && task.id === currentTicketId) || Boolean(request.makeCurrent);
    modalDelete.hidden = !task;
    modalMessage.textContent = "";
    delete modalDelete.dataset.confirming;
    modalDelete.textContent = "削除";
    const focusTitle = () => modalTitle.focus();
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(focusTitle);
    else focusTitle();
    pendingTicketEditor = null;
  };

  ticketDetailOpenEditor = openEditor;
  if (pendingTicketEditor) openEditor(pendingTicketEditor);

  backdrop.onclick = (event) => {
    if (event.target === backdrop) closeEditor();
  };
  container.querySelector(".ticketGlobalCancel").onclick = closeEditor;
  modalSave.onclick = async () => {
    const title = modalTitle.value.trim();
    if (!title) {
      modalMessage.textContent = "タイトルを入力してください。";
      modalTitle.focus();
      return;
    }
    modalSave.disabled = true;
    modalMessage.textContent = "保存しています…";
    try {
      let saved;
      if (editingTicketId) {
        await updateTicket(editingTicketId, {
          title,
          type: modalType.value,
          status: modalStatus.value,
          target: modalTarget.value,
          details: modalDetails.value,
        });
        saved = todoTasks.find((task) => task.id === editingTicketId) ?? null;
      } else {
        saved = await createTodoTask({
          title,
          type: modalType.value,
          status: modalStatus.value,
          target: modalTarget.value,
          details: modalDetails.value,
        });
      }
      if (saved && modalCurrent.checked) await setCurrentTicket(saved.id);
      else if (saved && currentTicketId === saved.id && !modalCurrent.checked) await setCurrentTicket(null);
      closeEditor();
    } catch (error) {
      modalMessage.textContent = String(error);
    } finally {
      modalSave.disabled = false;
    }
  };
  modalDelete.onclick = async () => {
    if (!editingTicketId) return;
    if (modalDelete.dataset.confirming !== "true") {
      modalDelete.dataset.confirming = "true";
      modalDelete.textContent = "もう一度押して削除";
      return;
    }
    try {
      await removeTodoTask(editingTicketId);
      closeEditor();
    } catch (error) {
      modalMessage.textContent = String(error);
    }
  };
};

const renderTodoBoard = async (container) => {
  container.innerHTML = `
    <style>
      * { box-sizing: border-box; }
      .todoBoardApp { position: relative; height: 100%; min-height: 100%; overflow: hidden; background: var(--then-background); color: var(--then-text); font-family: var(--then-font-family, inherit); font-size: 13px; }
      .todoBoardContent { display: flex; height: 100%; min-height: 0; flex-direction: column; gap: 10px; padding: 10px 12px 12px; }
      .todoBoardSearch { min-width: 0; width: min(320px, 45vw); height: 34px; padding: 0 10px; border: 1px solid var(--then-border); border-radius: var(--then-radius-control); outline: none; background: var(--then-input-background); color: var(--then-text); font: inherit; font-size: 13px; }
      .todoBoardSearch:focus { border-color: var(--then-accent); box-shadow: 0 0 0 2px var(--then-accent-soft); }
      .todoButton { min-height: 34px; padding: 0 12px; border: 1px solid var(--then-border-strong); border-radius: var(--then-radius-button); background: transparent; color: var(--then-text-secondary); cursor: pointer; font: inherit; font-size: 13px; }
      .todoButton:hover { background: var(--then-control-hover); color: var(--then-text); }
      .todoPrimaryButton { border-color: var(--then-accent); background: var(--then-accent); color: var(--then-on-accent); font-weight: 700; }
      .todoPrimaryButton:hover { border-color: var(--then-accent-strong); background: var(--then-accent-strong); color: var(--then-on-accent); }
      .todoBoardToolbar { display: flex; min-height: 34px; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 10px; }
      .todoBoardToolbarActions { display: flex; min-width: 0; align-items: center; gap: 8px; }
      .todoBoardMessage { min-width: 0; margin: 0; overflow: hidden; color: var(--then-text-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      .todoTrashButton { position: relative; display: inline-grid; width: 32px; min-width: 32px; padding: 0; place-items: center; }
      .todoTrashButton svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
      .todoTrashCount { position: absolute; top: -5px; right: -5px; display: grid; min-width: 17px; height: 17px; place-items: center; padding: 0 4px; border-radius: 999px; background: var(--then-danger); color: var(--then-background); font-size: 10px; font-weight: 700; }
      .todoTrashCount:empty { display: none; }
      .todoColumns { display: flex; min-height: 0; flex: 1; align-items: flex-start; gap: 10px; overflow-x: auto; overflow-y: hidden; padding: 1px 1px 8px; }
      .todoColumn { display: flex; width: 292px; min-width: 292px; max-height: 100%; flex: 0 0 292px; flex-direction: column; overflow: hidden; border: 1px solid var(--then-border); border-radius: var(--then-radius-card); background: color-mix(in srgb, var(--then-surface) 82%, var(--then-background)); transition: border-color 120ms ease, background 120ms ease; }
      .todoColumn[data-drag-over="true"] { border-color: var(--then-accent); background: var(--then-accent-soft); }
      .todoColumnHeader { display: flex; min-height: 45px; align-items: center; justify-content: space-between; gap: 10px; padding: 0 12px; border-bottom: 1px solid var(--then-border); }
      .todoColumnHeader h2 { margin: 0; color: var(--then-text); font-size: 14px; }
      .todoColumnCount { display: inline-grid; min-width: 24px; height: 21px; place-items: center; padding: 0 6px; border-radius: 999px; background: var(--then-background); color: var(--then-text-muted); font-size: 12px; }
      .todoColumnList { display: grid; min-height: 44px; flex: 1 1 auto; align-content: start; gap: 7px; overflow-y: auto; padding: 8px; margin: 0; list-style: none; }
      .todoCard { display: grid; gap: 7px; padding: 9px 10px; border: 1px solid var(--then-border); border-radius: 6px; background: var(--then-background); box-shadow: 0 1px 1px rgba(0,0,0,.08); cursor: grab; }
      .todoCard:hover { border-color: var(--then-border-strong); background: var(--then-surface-hover); }
      .todoCard[data-dragging="true"] { opacity: .45; }
      .todoCardTitle { margin: 0; color: var(--then-text); font-size: 14px; font-weight: 680; line-height: 1.5; overflow-wrap: anywhere; }
      .todoCardDetails { margin: 0; color: var(--then-text-muted); font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
      .todoCardMeta { color: var(--then-text-faint); font-size: 11px; }
      .todoCardActions { display: flex; flex-wrap: wrap; gap: 5px; }
      .todoCardActions .todoButton { min-height: 29px; padding: 0 9px; font-size: 12px; }
      .todoDeleteButton { margin-left: auto; color: var(--then-danger); }
      .todoDeleteButton[data-confirming="true"] { border-color: var(--then-danger); background: var(--then-danger-soft); }
      .todoColumnEmpty { padding: 14px 8px; color: var(--then-text-faint); font-size: 12px; line-height: 1.5; text-align: center; }
      .todoColumnFooter { flex: 0 0 auto; padding: 0 8px 8px; }
      .todoAddCardTrigger { width: 100%; min-height: 30px; border-color: transparent; text-align: left; }
      .ticketModalBackdrop { position: absolute; z-index: 20; inset: 0; display: grid; place-items: center; padding: 20px; background: color-mix(in srgb, var(--then-background) 72%, transparent); }
      .ticketModalBackdrop[hidden] { display: none; }
      .ticketModal { display: flex; width: min(680px, 100%); max-height: min(760px, 100%); flex-direction: column; overflow: hidden; border: 1px solid var(--then-border-strong); border-radius: 10px; background: var(--then-surface); box-shadow: 0 18px 48px rgba(0,0,0,.28); }
      .ticketModalHeader { display: flex; min-height: 50px; align-items: center; justify-content: space-between; gap: 12px; padding: 0 16px; border-bottom: 1px solid var(--then-border); }
      .ticketModalHeader strong { color: var(--then-text); font-size: 15px; }
      .ticketModalId { color: var(--then-accent-strong); font: 700 13px/1 ui-monospace, Consolas, monospace; }
      .ticketModalBody { display: grid; min-height: 0; gap: 12px; overflow-y: auto; padding: 16px; }
      .ticketField { display: grid; gap: 5px; }
      .ticketField > span { color: var(--then-text-muted); font-size: 12px; font-weight: 650; }
      .ticketField input, .ticketField select, .ticketField textarea { width: 100%; border: 1px solid var(--then-border); border-radius: var(--then-radius-control); outline: none; background: var(--then-input-background); color: var(--then-text); font: inherit; font-size: 13px; }
      .ticketField input, .ticketField select { height: 34px; padding: 0 9px; }
      .ticketField textarea { min-height: 190px; resize: vertical; padding: 9px; line-height: 1.6; }
      .ticketField input:focus, .ticketField select:focus, .ticketField textarea:focus { border-color: var(--then-accent); box-shadow: 0 0 0 2px var(--then-accent-soft); }
      .ticketFieldRow { display: grid; grid-template-columns: 1fr 1fr 1.5fr; gap: 10px; }
      .ticketCurrentChoice { display: flex; align-items: center; gap: 7px; color: var(--then-text-secondary); font-size: 13px; }
      .ticketCurrentChoice input { accent-color: var(--then-accent); }
      .ticketModalMessage { min-height: 17px; margin: 0; color: var(--then-text-muted); font-size: 12px; }
      .ticketModalFooter { display: flex; align-items: center; gap: 7px; padding: 11px 16px; border-top: 1px solid var(--then-border); }
      .ticketModalDelete { margin-right: auto; color: var(--then-danger); }
      .ticketModalDelete[data-confirming="true"] { border-color: var(--then-danger); background: var(--then-danger-soft); }
      .todoTrashModal { width: min(560px, 100%); }
      .todoTrashList { display: grid; gap: 8px; padding: 0; margin: 0; list-style: none; }
      .todoTrashItem { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 10px; align-items: center; padding: 10px; border: 1px solid var(--then-border); border-radius: var(--then-radius-card); background: var(--then-background); }
      .todoTrashItem strong { min-width: 0; color: var(--then-text); font-size: 13px; overflow-wrap: anywhere; }
      .todoTrashItem small { color: var(--then-text-muted); font-size: 11px; }
      .todoTrashActions { display: flex; grid-row: 1 / span 2; grid-column: 2; gap: 6px; }
      .todoTrashActions .todoButton { min-height: 29px; padding: 0 9px; }
      .todoTrashPermanent { color: var(--then-danger); }
      .todoTrashEmpty { padding: 28px 12px; color: var(--then-text-muted); font-size: 13px; text-align: center; }
      @media (max-width: 620px) { .todoBoardContent { padding-inline: 8px; } .todoColumn { width: min(292px, calc(100vw - 34px)); min-width: min(292px, calc(100vw - 34px)); flex-basis: min(292px, calc(100vw - 34px)); } }
    </style>
    <main class="todoBoardApp">
      <div class="todoBoardContent">
        <div class="todoBoardToolbar">
          <input class="todoBoardSearch" type="search" aria-label="チケットを検索" placeholder="チケット名・詳細を検索">
          <div class="todoBoardToolbarActions">
            <p class="todoBoardMessage" role="status" aria-live="polite"></p>
            <button class="todoButton todoTrashButton" type="button" title="ゴミ箱" aria-label="ゴミ箱"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg><span class="todoTrashCount"></span></button>
            <button class="todoButton todoReloadButton" type="button">再読込</button>
          </div>
        </div>
        <div class="todoColumns">
          ${TODO_STATUSES.map((status) => `<section class="todoColumn" data-status="${status}"><header class="todoColumnHeader"><h2>${TODO_STATUS_LABELS[status]}</h2><span class="todoColumnCount">0</span></header><ol class="todoColumnList"></ol><footer class="todoColumnFooter"><button class="todoButton todoAddCardTrigger" type="button">＋ カードを追加</button></footer></section>`).join("")}
        </div>
      </div>
      <div class="ticketModalBackdrop" hidden>
        <section class="ticketModal" role="dialog" aria-modal="true" aria-label="チケット詳細">
          <header class="ticketModalHeader"><strong>チケット詳細</strong><span class="ticketModalId">#---</span></header>
          <div class="ticketModalBody">
            <label class="ticketField"><span>タイトル</span><input name="ticketTitle" autocomplete="off"></label>
            <div class="ticketFieldRow">
              <label class="ticketField"><span>種別</span><select name="ticketType">${TICKET_TYPES.map((type) => `<option value="${type}">${TICKET_TYPE_LABELS[type]}</option>`).join("")}</select></label>
              <label class="ticketField"><span>状態</span><select name="ticketStatus">${TODO_STATUSES.map((status) => `<option value="${status}">${TODO_STATUS_LABELS[status]}</option>`).join("")}</select></label>
              <label class="ticketField"><span>対象</span><input name="ticketTarget" placeholder="章・人物・テーマなど"></label>
            </div>
            <label class="ticketField"><span>詳細</span><textarea name="ticketDetails" placeholder="Want、課題、検討内容、選択した本文など"></textarea></label>
            <label class="ticketCurrentChoice"><input name="ticketCurrent" type="checkbox">このチケットを「現在のチケット」にする</label>
            <p class="ticketModalMessage" role="status" aria-live="polite"></p>
          </div>
          <footer class="ticketModalFooter"><button class="todoButton ticketModalDelete" type="button">削除</button><button class="todoButton ticketModalCancel" type="button">キャンセル</button><button class="todoButton todoPrimaryButton ticketModalSave" type="button">保存</button></footer>
        </section>
      </div>
      <div class="ticketModalBackdrop todoTrashBackdrop" hidden>
        <section class="ticketModal todoTrashModal" role="dialog" aria-modal="true" aria-label="削除したチケット">
          <header class="ticketModalHeader"><strong>ゴミ箱</strong><button class="todoButton todoTrashClose" type="button">閉じる</button></header>
          <div class="ticketModalBody"><ol class="todoTrashList"></ol><div class="todoTrashEmpty">削除したチケットはありません。</div></div>
        </section>
      </div>
    </main>
  `;

  const search = container.querySelector(".todoBoardSearch");
  const message = container.querySelector(".todoBoardMessage");
  const columns = new Map(TODO_STATUSES.map((status) => [
    status,
    container.querySelector(`.todoColumn[data-status="${status}"]`),
  ]));
  let currentTasks = [];
  let draggedTaskId = null;
  let editingTicketId = null;
  const modalBackdrop = container.querySelector(".ticketModalBackdrop");
  const modalId = container.querySelector(".ticketModalId");
  const modalTitle = container.querySelector('[name="ticketTitle"]');
  const modalType = container.querySelector('[name="ticketType"]');
  const modalStatus = container.querySelector('[name="ticketStatus"]');
  const modalTarget = container.querySelector('[name="ticketTarget"]');
  const modalDetails = container.querySelector('[name="ticketDetails"]');
  const modalCurrent = container.querySelector('[name="ticketCurrent"]');
  const modalMessage = container.querySelector(".ticketModalMessage");
  const modalDelete = container.querySelector(".ticketModalDelete");
  const modalSave = container.querySelector(".ticketModalSave");
  const trashBackdrop = container.querySelector(".todoTrashBackdrop");
  const trashList = container.querySelector(".todoTrashList");
  const trashEmpty = container.querySelector(".todoTrashEmpty");
  const trashCount = container.querySelector(".todoTrashCount");

  const closeEditor = () => {
    modalBackdrop.hidden = true;
    editingTicketId = null;
    modalMessage.textContent = "";
    delete modalDelete.dataset.confirming;
    modalDelete.textContent = "削除";
  };

  const openEditor = (request = {}) => {
    const task = request.taskId
      ? todoTasks.find((candidate) => candidate.id === request.taskId) ?? null
      : null;
    editingTicketId = task?.id ?? null;
    modalId.textContent = task
      ? ticketLabel(task)
      : `#${String(nextTicketNumber).padStart(3, "0")}`;
    modalTitle.value = task?.title ?? request.title ?? "";
    modalType.value = task?.type ?? request.type ?? "want";
    modalStatus.value = task?.status ?? request.status ?? "backlog";
    modalTarget.value = task?.target ?? request.target ?? "";
    modalDetails.value = task?.details ?? request.details ?? "";
    modalCurrent.checked = Boolean(task && task.id === currentTicketId) || Boolean(request.makeCurrent);
    modalDelete.hidden = !task;
    modalBackdrop.hidden = false;
    const focusTitle = () => modalTitle.focus();
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(focusTitle);
    else focusTitle();
    pendingTicketEditor = null;
  };

  container.querySelector(".ticketModalCancel").onclick = closeEditor;
  modalBackdrop.onclick = (event) => {
    if (event.target === modalBackdrop) closeEditor();
  };
  modalSave.onclick = async () => {
    const title = modalTitle.value.trim();
    if (!title) {
      modalMessage.textContent = "タイトルを入力してください。";
      modalTitle.focus();
      return;
    }
    modalSave.disabled = true;
    modalMessage.textContent = "保存しています…";
    try {
      let saved;
      if (editingTicketId) {
        await updateTicket(editingTicketId, {
          title,
          type: modalType.value,
          status: modalStatus.value,
          target: modalTarget.value,
          details: modalDetails.value,
        });
        saved = todoTasks.find((task) => task.id === editingTicketId) ?? null;
      } else {
        saved = await createTodoTask({
          title,
          type: modalType.value,
          status: modalStatus.value,
          target: modalTarget.value,
          details: modalDetails.value,
        });
      }
      if (saved && modalCurrent.checked) await setCurrentTicket(saved.id);
      else if (saved && currentTicketId === saved.id && !modalCurrent.checked) await setCurrentTicket(null);
      setMessage(`${saved ? ticketLabel(saved) : "チケット"}を保存しました。`);
      closeEditor();
    } catch (error) {
      modalMessage.textContent = String(error);
    } finally {
      modalSave.disabled = false;
    }
  };
  modalDelete.onclick = async () => {
    if (!editingTicketId) return;
    if (modalDelete.dataset.confirming !== "true") {
      modalDelete.dataset.confirming = "true";
      modalDelete.textContent = "もう一度押して削除";
      return;
    }
    try {
      await removeTodoTask(editingTicketId);
      setMessage("チケットをゴミ箱へ移動しました。");
      closeEditor();
    } catch (error) {
      modalMessage.textContent = String(error);
    }
  };

  const setMessage = (text) => { message.textContent = text; };
  const closeTrash = () => { trashBackdrop.hidden = true; };
  const renderTrash = () => {
    const deletedTasks = currentTasks
      .filter((task) => task.deletedAt)
      .sort((left, right) => right.deletedAt - left.deletedAt);
    trashCount.textContent = deletedTasks.length > 0 ? String(deletedTasks.length) : "";
    trashList.replaceChildren();
    trashEmpty.hidden = deletedTasks.length > 0;
    for (const task of deletedTasks) {
      const item = document.createElement("li");
      item.className = "todoTrashItem";
      const title = document.createElement("strong");
      title.textContent = `${ticketLabel(task)} ${task.title}`;
      const deletedAt = document.createElement("small");
      deletedAt.textContent = `削除 ${formatTodoDate(task.deletedAt)}`;
      const actions = document.createElement("div");
      actions.className = "todoTrashActions";
      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "todoButton";
      restore.textContent = "復旧";
      restore.onclick = () => {
        restore.disabled = true;
        restoreTodoTask(task.id).then(
          () => setMessage(`${ticketLabel(task)}を復旧しました。`),
          (error) => { setMessage(String(error)); restore.disabled = false; },
        );
      };
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "todoButton todoTrashPermanent";
      remove.textContent = "完全削除";
      remove.onclick = () => {
        if (remove.dataset.confirming !== "true") {
          remove.dataset.confirming = "true";
          remove.textContent = "もう一度押す";
          return;
        }
        remove.disabled = true;
        permanentlyDeleteTodoTask(task.id).then(
          () => setMessage(`${ticketLabel(task)}を完全に削除しました。`),
          (error) => { setMessage(String(error)); remove.disabled = false; },
        );
      };
      actions.append(restore, remove);
      item.append(title, deletedAt, actions);
      trashList.append(item);
    }
  };
  const render = () => {
    const query = search.value.trim().toLocaleLowerCase();
    for (const status of TODO_STATUSES) {
      const column = columns.get(status);
      const list = column.querySelector(".todoColumnList");
      const tasks = currentTasks.filter((task) => !task.deletedAt && task.status === status &&
        [task.title, task.details, task.target, TICKET_TYPE_LABELS[task.type]]
          .join("\n")
          .toLocaleLowerCase()
          .includes(query))
        .sort((left, right) => left.order - right.order);
      column.querySelector(".todoColumnCount").textContent = String(tasks.length);
      list.replaceChildren();
      if (tasks.length === 0) {
        const empty = document.createElement("li");
        empty.className = "todoColumnEmpty";
        empty.textContent = query ? "一致するカードはありません" : "カードはありません";
        list.append(empty);
      }
      for (const task of tasks) {
        const card = document.createElement("li");
        card.className = "todoCard";
        card.draggable = true;
        card.dataset.taskId = task.id;
        card.onclick = () => openEditor({ taskId: task.id });
        const title = document.createElement("h3");
        title.className = "todoCardTitle";
        title.textContent = `${ticketLabel(task)} ${task.title}`;
        card.append(title);
        if (task.details) {
          const details = document.createElement("p");
          details.className = "todoCardDetails";
          details.textContent = task.details;
          card.append(details);
        }
        const meta = document.createElement("span");
        meta.className = "todoCardMeta";
        meta.textContent = [
          TICKET_TYPE_LABELS[task.type],
          task.target,
          `更新 ${formatTodoDate(task.updatedAt)}`,
        ].filter(Boolean).join(" · ");
        const actions = document.createElement("div");
        actions.className = "todoCardActions";
        const statusIndex = TODO_STATUSES.indexOf(status);
        if (statusIndex > 0) {
          const previous = document.createElement("button");
          previous.type = "button";
          previous.className = "todoButton";
          previous.textContent = "←";
          previous.title = `${TODO_STATUS_LABELS[TODO_STATUSES[statusIndex - 1]]}へ移動`;
          previous.onclick = (event) => {
            event.stopPropagation();
            moveTodoTask(task.id, TODO_STATUSES[statusIndex - 1]).catch((error) => setMessage(String(error)));
          };
          actions.append(previous);
        }
        if (statusIndex < TODO_STATUSES.length - 1) {
          const next = document.createElement("button");
          next.type = "button";
          next.className = "todoButton";
          next.textContent = status === "doing" ? "完了" : "次へ →";
          next.onclick = (event) => {
            event.stopPropagation();
            moveTodoTask(task.id, TODO_STATUSES[statusIndex + 1]).catch((error) => setMessage(String(error)));
          };
          actions.append(next);
        }
        card.append(meta, actions);
        card.ondragstart = (event) => {
          draggedTaskId = task.id;
          card.dataset.dragging = "true";
          event.dataTransfer?.setData("text/plain", task.id);
        };
        card.ondragend = () => {
          draggedTaskId = null;
          delete card.dataset.dragging;
          for (const target of columns.values()) delete target.dataset.dragOver;
        };
        card.ondragover = (event) => {
          if (draggedTaskId && draggedTaskId !== task.id) {
            event.preventDefault();
            event.stopPropagation();
          }
        };
        card.ondrop = (event) => {
          event.preventDefault();
          event.stopPropagation();
          const taskId = draggedTaskId || event.dataTransfer?.getData("text/plain");
          if (taskId && taskId !== task.id) {
            reorderTodoTask(taskId, status, task.id).catch((error) => setMessage(String(error)));
          }
        };
        list.append(card);
      }
    }
    renderTrash();
  };

  for (const [status, column] of columns) {
    const trigger = column.querySelector(".todoAddCardTrigger");
    trigger.onclick = () => openEditor({ status });
    column.ondragover = (event) => {
      event.preventDefault();
      column.dataset.dragOver = "true";
    };
    column.ondragleave = (event) => {
      if (!column.contains(event.relatedTarget)) delete column.dataset.dragOver;
    };
    column.ondrop = (event) => {
      event.preventDefault();
      delete column.dataset.dragOver;
      const taskId = draggedTaskId || event.dataTransfer?.getData("text/plain");
      if (taskId) reorderTodoTask(taskId, status).catch((error) => setMessage(String(error)));
    };
  }
  search.oninput = render;
  container.querySelector(".todoTrashButton").onclick = () => {
    renderTrash();
    trashBackdrop.hidden = false;
  };
  container.querySelector(".todoTrashClose").onclick = closeTrash;
  trashBackdrop.onclick = (event) => {
    if (event.target === trashBackdrop) closeTrash();
  };
  container.querySelector(".todoReloadButton").onclick = () => loadTodoTasks()
    .then(() => setMessage("プロジェクトのチケットを再読み込みしました。"))
    .catch((error) => setMessage(String(error)));
  subscribeTodoTasks((tasks) => {
    currentTasks = tasks;
    render();
  });
  await loadTodoTasks();
};

const renderTicketToolView = async (container, { status, allowCreate }) => {
  container.innerHTML = `
    <style>
      * { box-sizing: border-box; }
      .todoQuickApp { display: flex; min-height: 100%; flex-direction: column; gap: 10px; color: var(--then-text); font-family: var(--then-font-family, inherit); font-size: 13px; }
      .todoQuickHeader { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .todoQuickHeader h1 { margin: 0; color: var(--then-text); font-size: 14px; }
      .todoQuickCount { min-width: 28px; padding: 3px 7px; border: 1px solid var(--then-border); border-radius: 999px; background: var(--then-surface); color: var(--then-text-muted); font-size: 12px; text-align: center; }
      .todoQuickForm { display: grid; gap: 7px; padding: 10px; border: 1px solid var(--then-border); border-radius: var(--then-radius-card); background: var(--then-surface); }
      .todoQuickForm input { width: 100%; height: 32px; padding: 0 9px; border: 1px solid var(--then-border); border-radius: var(--then-radius-control); outline: none; background: var(--then-input-background); color: var(--then-text); font: inherit; font-size: 13px; }
      .todoQuickForm input:focus { border-color: var(--then-accent); box-shadow: 0 0 0 2px var(--then-accent-soft); }
      .todoQuickButton { min-height: 29px; border: 1px solid var(--then-border-strong); border-radius: var(--then-radius-button); background: transparent; color: var(--then-text-secondary); cursor: pointer; font: inherit; font-size: 13px; }
      .todoQuickButton:hover { background: var(--then-control-hover); color: var(--then-text); }
      .todoQuickPrimary { border-color: var(--then-accent); background: var(--then-accent); color: var(--then-on-accent); font-weight: 700; }
      .todoQuickMessage { min-height: 16px; margin: 0; color: var(--then-text-muted); font-size: 12px; }
      .todoQuickList { display: grid; gap: 7px; padding: 0; margin: 0; list-style: none; }
      .todoQuickItem { display: grid; gap: 7px; padding: 9px; border: 1px solid var(--then-border); border-radius: var(--then-radius-card); background: var(--then-surface); }
      .todoQuickItem strong { color: var(--then-text); font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
      .todoQuickDetails { margin: 0; color: var(--then-text-muted); font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
      .todoQuickMeta { color: var(--then-text-faint); font-size: 11px; }
      .todoQuickStatus { width: 100%; height: 29px; padding: 0 7px; border: 1px solid var(--then-border-strong); border-radius: var(--then-radius-button); outline: none; background: var(--then-input-background); color: var(--then-text-secondary); font: inherit; font-size: 12px; }
      .todoQuickStatus:focus { border-color: var(--then-accent); }
      .todoQuickEmpty { padding: 24px 10px; border: 1px dashed var(--then-border); border-radius: var(--then-radius-card); color: var(--then-text-muted); font-size: 12px; line-height: 1.6; text-align: center; }
    </style>
    <main class="todoQuickApp">
      <header class="todoQuickHeader"><h1>${TODO_STATUS_LABELS[status]}</h1><span class="todoQuickCount">0</span></header>
      ${allowCreate ? '<div class="todoQuickForm"><button class="todoQuickButton todoQuickPrimary todoQuickCreate" type="button">チケットを作成</button></div>' : ""}
      <p class="todoQuickMessage" role="status" aria-live="polite"></p>
      <ol class="todoQuickList"></ol>
      <div class="todoQuickEmpty" hidden>${TODO_STATUS_LABELS[status]}のチケットはありません。</div>
    </main>
  `;
  const form = container.querySelector(".todoQuickForm");
  const count = container.querySelector(".todoQuickCount");
  const list = container.querySelector(".todoQuickList");
  const empty = container.querySelector(".todoQuickEmpty");
  const message = container.querySelector(".todoQuickMessage");

  const render = (tasks) => {
    const visible = tasks.filter((task) => !task.deletedAt && task.status === status).slice(0, 20);
    count.textContent = String(tasks.filter((task) => !task.deletedAt && task.status === status).length);
    list.replaceChildren();
    empty.hidden = visible.length > 0;
    for (const task of visible) {
      const item = document.createElement("li");
      item.className = "todoQuickItem";
      item.onclick = () => requestTicketEditor({ taskId: task.id }).catch((error) => {
        message.textContent = String(error);
      });
      const title = document.createElement("strong");
      title.textContent = `${ticketLabel(task)} ${task.title}`;
      item.append(title);
      if (task.details) {
        const details = document.createElement("p");
        details.className = "todoQuickDetails";
        details.textContent = task.details;
        item.append(details);
      }
      const meta = document.createElement("span");
      meta.className = "todoQuickMeta";
      meta.textContent = `更新 ${formatTodoDate(task.updatedAt)}`;
      const statusSelect = document.createElement("select");
      statusSelect.className = "todoQuickStatus";
      statusSelect.setAttribute("aria-label", `${task.title}の状態`);
      for (const candidate of TODO_STATUSES) {
        const option = document.createElement("option");
        option.value = candidate;
        option.textContent = TODO_STATUS_LABELS[candidate];
        option.selected = candidate === task.status;
        statusSelect.append(option);
      }
      statusSelect.onchange = () => {
        statusSelect.disabled = true;
        message.textContent = "状態を保存しています…";
        moveTodoTask(task.id, statusSelect.value).then(
          () => { message.textContent = `「${task.title}」の状態を変更しました。`; },
          (error) => { message.textContent = String(error); statusSelect.disabled = false; },
        );
      };
      statusSelect.onclick = (event) => event.stopPropagation();
      item.append(meta, statusSelect);
      list.append(item);
    }
  };
  subscribeTodoTasks(render);
  if (form) form.querySelector(".todoQuickCreate").onclick = () =>
    requestTicketEditor({ status }).catch((error) => {
      message.textContent = String(error);
    });
  await loadTodoTasks();
};

then.views.registerModal(
  { id: "ticket-detail", title: "チケット詳細" },
  renderTicketDetailModal,
);

then.views.registerToolView(
  {
    id: "ticket-unstarted",
    title: "未着手チケット",
    icon: { paths: ["M5 4h14v16H5z", "M8 8h8M8 12h5"] },
  },
  (container) => renderTicketToolView(container, { status: "backlog", allowCreate: true }),
);

then.views.registerToolView(
  {
    id: "ticket-doing",
    title: "進行中チケット",
    icon: { paths: ["M12 3a9 9 0 1 0 9 9", "M12 7v5l3 2"] },
  },
  (container) => renderTicketToolView(container, { status: "doing", allowCreate: false }),
);

then.views.registerScreen(
  { id: "ticket-board", title: "Ticket" },
  renderTodoBoard,
);

then.commands.registerCommand(
  {
    id: "create-from-selection",
    title: "選択範囲からチケットを作成…",
    keybinding: "Mod+Alt+T",
    menus: ["editor.selection"],
  },
  async () => {
    const selection = await then.editor.getSelection();
    if (!selection?.documentPath || !selection.text.trim()) return;
    await requestTicketEditor({
      title: "",
      details: selection.text,
      target: selection.documentPath,
      type: "issue",
      status: "backlog",
    });
  },
);

then.commands.registerCommand(
  { id: "open-current-ticket", title: "Ticket: 現在のチケットを開く" },
  () => currentTicketId
    ? requestTicketEditor({ taskId: currentTicketId })
    : then.views.open("ticket-board"),
);

then.commands.registerCommand(
  { id: "create-ticket", title: "Ticket: 新しいチケットを作成" },
  () => requestTicketEditor({ status: "backlog" }),
);

then.workspace.onDidChangeWorkspace(({ hasProject }) => {
  reloadWorkspaceTickets(hasProject).catch(() => undefined);
});

loadTodoTasks().then(() => loadCurrentTicket()).catch(() => undefined);
