import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

/**
 * DEV-only recorder for IME sessions in the editor (docs/KNOWN_ISSUES.md,
 * 2026-10-13). From compositionstart until the IME has been quiet for a
 * second it records input events, transactions, DOM selection, every DOM
 * mutation inside the editor and, for mutations made by script, the stack of
 * the code that made them. Mutations without a stack are the browser's own
 * IME edits. Each session is posted to the Vite dev server, which writes it
 * under tmp/ime-trace/. It replaces DOM write methods while installed, so it
 * runs only on a dev server started with VITE_QA_IME_TRACE=1.
 */

type Entry = Record<string, unknown> & { t: number; kind: string };

const QUIET_MS = 1000;
const MAX_ENTRIES = 6000;

export function installImeTrace(editor: Editor): () => void {
  const view = editor.view;
  const root = view.dom;
  let entries: Entry[] | null = null;
  let startedAt = 0;
  let quietTimer: number | null = null;
  let scriptDepth = 0;
  const nodeIds = new WeakMap<Node, number>();
  let nextNodeId = 1;
  const nodeId = (node: Node | null) => {
    if (!node) return null;
    let id = nodeIds.get(node);
    if (id === undefined) nodeIds.set(node, (id = nextNodeId++));
    return id;
  };
  const describe = (node: Node | null): string | null => {
    if (!node) return null;
    if (node.nodeType === Node.TEXT_NODE) return `#${nodeId(node)}"${(node as Text).data.slice(0, 40)}"`;
    const element = node as Element;
    const block = element.parentElement === root ? `[${Array.prototype.indexOf.call(root.children, element)}]` : "";
    return `#${nodeId(node)}<${element.nodeName.toLowerCase()}${block}${element.className ? "." + String(element.className).replace(/\s+/g, ".") : ""}>`;
  };
  const record = (kind: string, data: Record<string, unknown> = {}) => {
    if (!entries || entries.length >= MAX_ENTRIES) return;
    entries.push({ t: Math.round((performance.now() - startedAt) * 10) / 10, kind, ...data });
  };
  const domSelection = () => {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    return {
      anchor: describe(selection.anchorNode), anchorOffset: selection.anchorOffset,
      focus: describe(selection.focusNode), focusOffset: selection.focusOffset,
    };
  };
  const pmSelection = () => {
    const { from, to } = view.state.selection;
    const $from = view.state.doc.resolve(from);
    return { from, to, block: $from.index(0), text: $from.parent.textContent.slice(0, 80) };
  };
  const stack = () => (new Error().stack ?? "")
    .split("\n")
    .slice(3)
    .map((line) => line.trim().replace(/^at /, "").replace(/https?:\/\/[^/]+\//, "").replace(/\?[^:)]*/, ""))
    .filter((line) => !line.includes("imeTrace"))
    .slice(0, 12);

  // Script-made DOM writes inside the editor, with the caller's stack.
  const restores: Array<() => void> = [];
  const inEditor = (node: unknown) => node instanceof Node && root.contains(node);
  const wrapMethod = (proto: object, name: string) => {
    const original = (proto as Record<string, unknown>)[name] as ((...args: unknown[]) => unknown) | undefined;
    if (typeof original !== "function") return;
    (proto as Record<string, unknown>)[name] = function (this: Node, ...args: unknown[]) {
      if (entries && scriptDepth === 0 && (inEditor(this) || args.some(inEditor))) {
        scriptDepth++;
        try {
          record("write", {
            op: name, target: describe(this),
            args: args.map((arg) => (arg instanceof Node ? describe(arg) : typeof arg === "string" ? arg.slice(0, 40) : typeof arg)),
            stack: stack(),
          });
        } finally { scriptDepth--; }
      }
      return original.apply(this, args);
    };
    restores.push(() => { (proto as Record<string, unknown>)[name] = original; });
  };
  const wrapSetter = (proto: object, name: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (!descriptor?.set) return;
    const set = descriptor.set;
    Object.defineProperty(proto, name, {
      ...descriptor,
      set(this: Node, value: unknown) {
        if (entries && scriptDepth === 0 && inEditor(this)) {
          scriptDepth++;
          try {
            record("write", { op: `set ${name}`, target: describe(this), value: String(value).slice(0, 40), stack: stack() });
          } finally { scriptDepth--; }
        }
        set.call(this, value);
      },
    });
    restores.push(() => Object.defineProperty(proto, name, descriptor));
  };
  for (const name of ["insertBefore", "appendChild", "removeChild", "replaceChild"]) wrapMethod(Node.prototype, name);
  for (const name of ["remove", "replaceWith", "before", "after", "append", "prepend", "replaceChildren",
    "setAttribute", "removeAttribute", "toggleAttribute", "insertAdjacentElement", "insertAdjacentText"]) {
    wrapMethod(Element.prototype, name);
  }
  for (const name of ["replaceData", "insertData", "deleteData", "appendData", "remove", "before", "after", "replaceWith"]) {
    wrapMethod(CharacterData.prototype, name);
  }
  wrapMethod(Text.prototype, "splitText");
  wrapSetter(Node.prototype, "textContent");
  wrapSetter(Node.prototype, "nodeValue");
  wrapSetter(CharacterData.prototype, "data");
  wrapSetter(Element.prototype, "innerHTML");
  wrapSetter(Element.prototype, "className");
  // DOMTokenList methods run on the list, not the element; record them by owner.
  const tokenListOwner = new WeakMap<DOMTokenList, Element>();
  const classList = Object.getOwnPropertyDescriptor(Element.prototype, "classList");
  if (classList?.get) {
    const get = classList.get;
    Object.defineProperty(Element.prototype, "classList", {
      ...classList,
      get(this: Element) {
        const list = get.call(this) as DOMTokenList;
        if (entries) tokenListOwner.set(list, this);
        return list;
      },
    });
    restores.push(() => Object.defineProperty(Element.prototype, "classList", classList));
  }
  const tokenWrites: Array<() => void> = [];
  for (const name of ["add", "remove", "toggle", "replace"]) {
    const original = (DOMTokenList.prototype as unknown as Record<string, (...args: unknown[]) => unknown>)[name];
    (DOMTokenList.prototype as unknown as Record<string, unknown>)[name] = function (this: DOMTokenList, ...args: unknown[]) {
      const owner = tokenListOwner.get(this);
      if (entries && scriptDepth === 0 && owner && inEditor(owner)) {
        scriptDepth++;
        try {
          record("write", { op: `classList.${name}`, target: describe(owner), args: args.map(String), stack: stack() });
        } finally { scriptDepth--; }
      }
      return original.apply(this, args);
    };
    tokenWrites.push(() => { (DOMTokenList.prototype as unknown as Record<string, unknown>)[name] = original; });
  }

  // Every mutation, including the browser's own IME edits.
  const observer = new MutationObserver((records) => {
    for (const mutation of records) {
      record("mutation", {
        type: mutation.type,
        target: describe(mutation.target),
        added: mutation.addedNodes.length ? [...mutation.addedNodes].map(describe) : undefined,
        removed: mutation.removedNodes.length ? [...mutation.removedNodes].map(describe) : undefined,
        attribute: mutation.attributeName ?? undefined,
        oldValue: mutation.oldValue?.slice(0, 40) ?? undefined,
      });
    }
  });

  const finish = () => {
    quietTimer = null;
    if (!entries) return;
    for (const mutation of observer.takeRecords()) record("mutation", { type: mutation.type, target: describe(mutation.target) });
    observer.disconnect();
    const session = { startedAt: new Date(Date.now() - (performance.now() - startedAt)).toISOString(), userAgent: navigator.userAgent, entries };
    entries = null;
    const traces = ((window as unknown as { __thenImeTraces?: unknown[] }).__thenImeTraces ??= []);
    traces.push(session);
    if (traces.length > 5) traces.shift();
    fetch("/__dev/ime-trace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(session) })
      .catch(() => {});
  };
  const touch = () => {
    if (quietTimer !== null) window.clearTimeout(quietTimer);
    quietTimer = window.setTimeout(() => {
      if (view.composing) touch();
      else finish();
    }, QUIET_MS);
  };
  const begin = () => {
    if (entries) return;
    entries = [];
    startedAt = performance.now();
    observer.observe(root, { subtree: true, childList: true, characterData: true, characterDataOldValue: true, attributes: true, attributeOldValue: true });
    record("begin", { pm: pmSelection(), dom: domSelection() });
  };

  const onEvent = (event: Event) => {
    if (event.type === "compositionstart") begin();
    if (!entries) return;
    touch();
    const data: Record<string, unknown> = { type: event.type, dom: domSelection(), pm: pmSelection(), composing: view.composing };
    if ("data" in event) data.data = (event as CompositionEvent).data;
    if (event instanceof InputEvent) {
      data.inputType = event.inputType;
      data.isComposing = event.isComposing;
      if (event.type === "beforeinput") {
        data.targetRanges = event.getTargetRanges().map((range) => ({
          start: describe(range.startContainer), startOffset: range.startOffset,
          end: describe(range.endContainer), endOffset: range.endOffset,
        }));
      }
    }
    if (event instanceof KeyboardEvent) Object.assign(data, { key: event.key, code: event.code, keyCode: event.keyCode, isComposing: event.isComposing });
    record("event", data);
  };
  const eventTypes = ["compositionstart", "compositionupdate", "compositionend", "beforeinput", "input", "keydown", "keyup"];
  for (const type of eventTypes) root.addEventListener(type, onEvent, true);
  const onSelectionChange = () => { if (entries) record("selectionchange", { dom: domSelection() }); };
  document.addEventListener("selectionchange", onSelectionChange);

  const onTransaction = ({ transaction }: { transaction: Transaction }) => {
    if (!entries) return;
    touch();
    record("transaction", {
      docChanged: transaction.docChanged,
      steps: transaction.steps.map((step) => {
        const json = step.toJSON() as { stepType: string; from?: number; to?: number; slice?: unknown };
        return { type: json.stepType, from: json.from, to: json.to, text: JSON.stringify(json.slice ?? null).slice(0, 120) };
      }),
      composition: transaction.getMeta("composition"),
      metas: Object.keys((transaction as unknown as { meta: Record<string, unknown> }).meta ?? {}),
      pm: pmSelection(),
      dom: domSelection(),
      stack: stack(),
    });
  };
  editor.on("transaction", onTransaction);

  return () => {
    if (quietTimer !== null) window.clearTimeout(quietTimer);
    finish();
    observer.disconnect();
    for (const type of eventTypes) root.removeEventListener(type, onEvent, true);
    document.removeEventListener("selectionchange", onSelectionChange);
    editor.off("transaction", onTransaction);
    for (const restore of [...tokenWrites, ...restores].reverse()) restore();
  };
}
