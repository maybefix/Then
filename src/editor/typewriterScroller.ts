type Options = {
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
  now: () => number;
  enabled: () => boolean;
  read: () => number;
  write: (position: number) => void;
  measureTarget: () => number | null;
  pixelSize: () => number;
  onSettled: () => void;
};

/** Retarget one animation instead of restarting it on every input. Geometry is
 * read when the caret/layout changes and at settlement, never on every frame. */
export function createTypewriterScroller(options: Options) {
  let frame: number | null = null;
  let target: number | null = null;
  let dirty = true;
  let verified = false;
  let lastTime = 0;
  let deadline = 0;

  const stop = () => {
    if (frame !== null) options.cancelFrame(frame);
    frame = null;
    target = null;
  };
  const settle = () => {
    stop();
    options.onSettled();
  };
  const step = (now: number) => {
    frame = null;
    if (!options.enabled()) { stop(); return; }
    if (dirty) {
      target = options.measureTarget();
      dirty = false;
      verified = false;
    }
    if (target === null) { stop(); return; }
    const current = options.read();
    const pixel = options.pixelSize();
    const snap = (value: number) => Math.round(value / pixel) * pixel;
    let delta = target - current;
    // Decorations/font layout can settle after the first measurement. Check
    // once at the end without paying for a Range measurement every frame.
    if (Math.abs(delta) <= pixel && !verified) {
      target = options.measureTarget();
      verified = true;
      if (target === null) { stop(); return; }
      delta = target - current;
    }
    if (Math.abs(delta) < pixel / 2) { settle(); return; }
    const dt = Math.min(64, Math.max(0, now - lastTime));
    lastTime = now;
    const final = Math.abs(delta) <= pixel || now >= deadline;
    const move = Math.sign(delta) * Math.min(Math.abs(delta), Math.max(Math.abs(delta) * (1 - Math.exp(-dt / 55)), pixel));
    options.write(snap(final ? target : current + move));
    // Browser scroll limits may clamp a target. Always terminate, including
    // at document edges, instead of scheduling an unreachable target forever.
    if (final || Math.abs(options.read() - current) < pixel / 2) { settle(); return; }
    frame = options.requestFrame(step);
  };
  return {
    request() {
      dirty = true;
      deadline = options.now() + 400;
      if (frame !== null) return;
      lastTime = options.now();
      frame = options.requestFrame(step);
    },
    invalidate() { dirty = true; },
    stop,
    isRunning: () => frame !== null,
  };
}
