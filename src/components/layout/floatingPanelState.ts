import { useCallback, useEffect, useState } from "react";

export type PanelStatus = "open" | "minimized" | "closed";
export type PanelFrame = { x: number; y: number; width: number; height: number };
export type PanelRecord = { status: PanelStatus; frame?: PanelFrame };
type PanelLayout = {
  entries: Record<string, PanelRecord>;
  order: string[];
  restore: string[];
  outline: "all" | "current";
};

const STORAGE_KEY = "then:floating-panels:v1";
const emptyLayout: PanelLayout = { entries: {}, order: [], restore: [], outline: "all" };

function loadLayout(): PanelLayout | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<PanelLayout> | null;
    if (!saved?.entries || !Array.isArray(saved.order)) return null;
    const entries = Object.fromEntries(Object.entries(saved.entries).flatMap(([id, record]) => {
      if (!record || !["open", "minimized", "closed"].includes(record.status)) return [];
      const frame = record.frame;
      return [[id, {
        status: record.status,
        frame: frame && [frame.x, frame.y, frame.width, frame.height].every(Number.isFinite)
          ? frame
          : undefined,
      }]];
    }));
    const validIds = (list: unknown[]) => [...new Set(list.filter(
      (id): id is string => typeof id === "string" && Object.prototype.hasOwnProperty.call(entries, id),
    ))];
    return {
      entries,
      order: validIds(saved.order),
      restore: validIds(Array.isArray(saved.restore) ? saved.restore : []),
      outline: saved.outline === "current" ? "current" : "all",
    };
  } catch {
    return null;
  }
}

export function referencePanelId(id: string) {
  return `reference:${id}`;
}

export function panelStatus(layout: PanelLayout, id: string): PanelStatus {
  return layout.entries[id]?.status ?? (id.startsWith("reference:") ? "open" : "closed");
}

export function useFloatingPanels() {
  const [stored, setStored] = useState(loadLayout);
  const layout = stored ?? emptyLayout;

  useEffect(() => {
    if (!stored) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // A restricted webview can still use panels for the current session.
    }
  }, [stored]);

  const migrate = useCallback((left: string | null, right: string | null, rightWide: boolean, wasSearch: boolean) => {
    setStored((current) => {
      if (current) {
        if (!wasSearch || current.entries.search) return current;
        const files = current.entries.files ?? { status: "closed" as const };
        const replaceFiles = (id: string) => id === "files" ? "search" : id;
        return {
          ...current,
          entries: { ...current.entries, files: { ...files, status: "closed" }, search: files },
          order: current.order.map(replaceFiles),
          restore: current.restore.map(replaceFiles),
        };
      }
      const entries: PanelLayout["entries"] = {};
      const order: string[] = [];
      if (left) {
        const id = wasSearch ? "search" : left;
        entries[id] = { status: "open" };
        order.push(id);
      } else if (wasSearch) {
        entries.search = { status: "closed" };
      }
      if (right) {
        entries[right] = {
          status: "open",
          frame: rightWide ? { x: -1, y: 16, width: 480, height: 460 } : undefined,
        };
        order.push(right);
      }
      return { ...emptyLayout, entries, order };
    });
  }, []);

  const setStatus = useCallback((id: string, status: PanelStatus) => {
    setStored((stored) => {
      const current = stored ?? emptyLayout;
      if (status === "open" && panelStatus(current, id) === "open" && current.order[current.order.length - 1] === id) return current;
      const entries = { ...current.entries };
      // The plugin runtime presents one registered view at a time.
      if (status === "open" && id.startsWith("plugin:")) {
        for (const other of current.order) {
          if (other !== id && other.startsWith("plugin:") && entries[other]?.status === "open") {
            entries[other] = { ...entries[other], status: "minimized" };
          }
        }
      }
      entries[id] = { ...entries[id], status };
      return {
        ...current,
        entries,
        order: status === "open" ? [...current.order.filter((key) => key !== id), id] : current.order,
        restore: current.restore.filter((key) => key !== id),
      };
    });
  }, []);

  const open = useCallback((id: string) => setStatus(id, "open"), [setStatus]);
  const minimize = useCallback((id: string) => setStatus(id, "minimized"), [setStatus]);
  const close = useCallback((id: string) => setStatus(id, "closed"), [setStatus]);

  const forgetReference = useCallback((id: string) => {
    setStored((stored) => {
      if (!stored?.entries[id]) return stored;
      const entries = { ...stored.entries };
      delete entries[id];
      return {
        ...stored,
        entries,
        order: stored.order.filter((key) => key !== id),
        restore: stored.restore.filter((key) => key !== id),
      };
    });
  }, []);

  const setFrame = useCallback((id: string, frame: PanelFrame) => {
    setStored((stored) => {
      const current = stored ?? emptyLayout;
      return { ...current, entries: { ...current.entries, [id]: { ...current.entries[id], frame } } };
    });
  }, []);

  const setOutline = useCallback((outline: PanelLayout["outline"]) => {
    setStored((stored) => ({ ...(stored ?? emptyLayout), outline }));
  }, []);

  const toggleAll = useCallback((ids: readonly string[]) => {
    setStored((stored) => {
      const current = stored ?? emptyLayout;
      const visible = ids.filter((id) => panelStatus(current, id) === "open");
      const restore = current.restore.filter((id) => ids.includes(id));
      const changed = restore.length ? restore : visible;
      const status = restore.length ? "open" : "minimized";
      const entries = { ...current.entries };
      for (const id of changed) entries[id] = { ...entries[id], status };
      const previousPlugin = restore.find((id) => id.startsWith("plugin:"));
      if (previousPlugin) {
        for (const id of visible) {
          if (id.startsWith("plugin:") && id !== previousPlugin) entries[id] = { ...entries[id], status: "minimized" };
        }
      }
      return {
        ...current,
        entries,
        restore: [...current.restore.filter((id) => !ids.includes(id)), ...(restore.length ? [] : visible)],
      };
    });
  }, []);

  return { layout, migrate, setFrame, setOutline, open, minimize, close, forgetReference, toggleAll };
}
