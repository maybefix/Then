// Stop a headless browser started by a test/benchmark script and delete its
// throwaway profile. On Windows, ChildProcess.kill() ends only the parent
// msedge.exe; its renderer/GPU children keep the profile open, the delete
// fails silently, and each run leaves ~460 MB behind in %TEMP%.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function stopBrowser(browser, profileDir) {
  const exited = browser.exitCode !== null ? Promise.resolve() : new Promise((resolve) => browser.once("exit", resolve));
  if (process.platform === "win32" && browser.pid) {
    spawnSync("taskkill", ["/pid", String(browser.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    browser.kill();
  }
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
