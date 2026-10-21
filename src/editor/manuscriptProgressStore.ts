import type { ManuscriptProgress } from "../types";

/** The editor publishes measurements after layout. Only the status label needs
 * to subscribe; forwarding them through App state re-renders the whole workspace. */
export function createManuscriptProgressStore() {
  let snapshot: ManuscriptProgress | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setSnapshot(next: ManuscriptProgress | null) {
      if (snapshot === next) return;
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
  };
}

export type ManuscriptProgressStore = ReturnType<typeof createManuscriptProgressStore>;
