import { invoke } from "@tauri-apps/api/core";

let resetOnNextLog = true;
let writeQueue: Promise<unknown> = Promise.resolve();

export function logHeadingDnd(
  stage: string,
  details: Record<string, unknown> = {},
): void {
  const entry = { stage, ...details, loggedAt: new Date().toISOString() };
  console.info("[heading-dnd]", entry);
  if (!("__TAURI_INTERNALS__" in window)) return;

  const reset = resetOnNextLog;
  resetOnNextLog = false;
  writeQueue = writeQueue
    .then(() => invoke("log_heading_dnd", { stage, details, reset }))
    .catch((error) => {
      console.error("[heading-dnd] failed to persist diagnostic log", error);
    });
}
