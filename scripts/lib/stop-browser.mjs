// Stop a headless browser started by a test/benchmark script and delete its
// throwaway profile. On Windows, ChildProcess.kill() ends only the parent
// msedge.exe; its renderer/GPU children keep the profile open, the delete
// fails silently, and each run leaves ~460 MB behind in %TEMP%.
//
// The msedge.exe a script spawns can be only a launcher: it starts the real
// browser process and exits within seconds (seen with Edge 155, 2026-10-23).
// The browser is then no longer a descendant of any live process the script
// knows, so killing the spawned pid's tree stops nothing. Every process whose
// command line names the throwaway profile is stopped as well.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const blockFor = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function killTree(browser) {
  if (!browser.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(browser.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    browser.kill();
  }
}

/** The profile folder's own name: unique per run (mkdtemp) and safe to put in a filter. */
function profileNeedle(profileDir) {
  const name = profileDir ? path.basename(profileDir) : "";
  return /^[\w.-]{6,}$/.test(name) ? name : null;
}

/** Stops every msedge/chrome process started with this profile. Returns how many were still running. */
function killByProfile(profileDir) {
  const needle = profileNeedle(profileDir);
  if (!needle || process.platform !== "win32") return 0;
  const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
    "$p = @(Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' OR Name='chrome.exe'\" | " +
    `Where-Object { $_.CommandLine -like '*${needle}*' }); ` +
    "$p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; $p.Count"],
  { encoding: "utf8" });
  return Number.parseInt(result.stdout, 10) || 0;
}

function removeProfile(profileDir, wait) {
  for (let attempt = 0; profileDir && attempt < 15; attempt += 1) {
    try { rmSync(profileDir, { recursive: true, force: true }); return true; } catch { wait(300); }
  }
  return !profileDir;
}

// Call right after spawning the browser. However the script ends — a throw
// before its try block, process.exit(), Ctrl+C, or a parent killing it — the
// browser goes with it instead of piling up and eating the PC's memory.
export function guardBrowser(browser, profileDir) {
  process.once("exit", () => {
    killTree(browser);
    // Exit handlers must stay synchronous: stop by profile until nothing is
    // left, then delete the profile in short blocking steps.
    for (let attempt = 0; attempt < 10 && killByProfile(profileDir) > 0; attempt += 1) blockFor(300);
    if (!removeProfile(profileDir, blockFor)) console.error(`stop-browser: could not delete ${profileDir}`);
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
  for (let attempt = 0; attempt < 10 && killByProfile(profileDir) > 0; attempt += 1) await sleep(300);
  const left = killByProfile(profileDir);
  if (left > 0) console.error(`stop-browser: ${left} browser processes with ${profileDir} are still running`);
  if (profileDir && !removeProfile(profileDir, (ms) => blockFor(ms))) {
    console.error(`stop-browser: could not delete ${profileDir}`);
  }
}
