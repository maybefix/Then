export type LatestFrameScheduler<T> = {
  schedule: (value: T) => void;
  flush: () => void;
  cancel: () => void;
};

/** Coalesces high-frequency input and guarantees that flush applies the latest value. */
export function createLatestFrameScheduler<T>(
  requestFrame: (callback: () => void) => number,
  cancelFrame: (id: number) => void,
  apply: (value: T) => void,
): LatestFrameScheduler<T> {
  let frameId: number | null = null;
  let pending: T | null = null;

  const applyPending = () => {
    const value = pending;
    pending = null;
    if (value !== null) apply(value);
  };

  return {
    schedule(value) {
      pending = value;
      if (frameId !== null) return;
      frameId = requestFrame(() => {
        frameId = null;
        applyPending();
      });
    },
    flush() {
      if (frameId !== null) {
        cancelFrame(frameId);
        frameId = null;
      }
      applyPending();
    },
    cancel() {
      if (frameId !== null) cancelFrame(frameId);
      frameId = null;
      pending = null;
    },
  };
}
