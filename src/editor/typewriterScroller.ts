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

/** How quickly the scroll closes in on the caret (exponential time constant).
 * 55 ms took ~165 ms to catch up after each new column on a long manuscript,
 * which read as the caret dragging the view behind it. */
const FOLLOW_TIME_CONSTANT_MS = 30;
/** After this, the animation jumps to the target instead of easing further. */
const FOLLOW_DEADLINE_MS = 250;
/** One frame at 60 Hz: the first step of an animation advances by this much. */
const NOMINAL_FRAME_MS = 1000 / 60;

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
    const move = Math.sign(delta) * Math.min(Math.abs(delta), Math.max(Math.abs(delta) * (1 - Math.exp(-dt / FOLLOW_TIME_CONSTANT_MS)), pixel));
    options.write(snap(final ? target : current + move));
    // Browser scroll limits may clamp a target. Always terminate, including
    // at document edges, instead of scheduling an unreachable target forever.
    if (final || Math.abs(options.read() - current) < pixel / 2) { settle(); return; }
    frame = options.requestFrame(step);
  };
  return {
    /**
     * Start following the caret. `inFrame` means the caller already runs in an
     * animation frame (after the caret moved), so the first step happens now
     * instead of one frame later.
     */
    request(inFrame = false) {
      dirty = true;
      deadline = options.now() + FOLLOW_DEADLINE_MS;
      if (frame !== null) return;
      if (inFrame) {
        // Step now, by one frame's worth rather than the ~0 ms since "now".
        lastTime = options.now() - NOMINAL_FRAME_MS;
        step(options.now());
      } else {
        lastTime = options.now();
        frame = options.requestFrame(step);
      }
    },
    invalidate() { dirty = true; },
    stop,
    isRunning: () => frame !== null,
  };
}
