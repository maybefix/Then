// Stop a headless browser started by a test/benchmark script and delete its
// throwaway profile. On Windows, ChildProcess.kill() ends only the parent
// msedge.exe; its renderer/GPU children keep the profile open, the delete
// fails silently, and each run leaves ~460 MB behind in %TEMP%.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function killTree(browser) {
  if (!browser.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(browser.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    browser.kill();
  }
}

// Call right after spawning the browser. However the script ends — a throw
// before its try block, process.exit(), Ctrl+C, or a parent killing it — the
// browser goes with it instead of piling up and eating the PC's memory.
export function guardBrowser(browser, profileDir) {
  process.once("exit", () => {
    killTree(browser);
    // Exit handlers must stay synchronous; the killed processes take a moment
    // to release the profile, so wait in short blocking steps.
    for (let attempt = 0; profileDir && attempt < 10; attempt += 1) {
      try { rmSync(profileDir, { recursive: true, force: true }); break; } catch {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
    process.once(signal, () => process.exit(130));
  }
  process.once("uncaughtException", (error) => { console.error(error); process.exit(1); });
  process.once("unhandledRejection", (error) => { console.error(error); process.exit(1); });
  return browser;
}

export async function stopBrowser(browser, profileDir) {
  const exited = browser.exitCode !== null ? Promise.resolve() : new Promise((resolve) => browser.once("exit", resolve));
  killTree(browser);
  await Promise.race([exited, sleep(5000)]);
  if (!profileDir) return;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(profileDir, { recursive: true, force: true });
      return;
    } catch {
      await sleep(300);
    }
  }
}
