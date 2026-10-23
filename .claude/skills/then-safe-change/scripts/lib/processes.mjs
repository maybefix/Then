// テストや QA アプリが残したプロセスを数える・止める（Windows）。
// ふだんの Then や利用者の Edge には触れない: QA の Then は ExecutablePath、WebView2 は識別子、
// テスト用の Edge は %TEMP% の then- で始まるプロファイル名、テストの node はコマンドラインで見分ける。
import { spawnSync } from "node:child_process";

export const RELEASE_EXE = "src-tauri\\target\\release\\Then.exe";

function powershell(command) {
  const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" });
  return result.stdout.trim();
}

const quote = (text) => text.replace(/'/g, "''");

function filters({ exe, identifier } = {}) {
  return {
    qaThen: exe ? `$_.ExecutablePath -eq '${quote(exe)}'` : "$false",
    qaWebView: identifier ? `$_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like '*${quote(identifier)}*'` : "$false",
    testEdge: "($_.Name -eq 'msedge.exe' -or $_.Name -eq 'chrome.exe') -and ($_.CommandLine -like '*\\then-*' -or $_.CommandLine -like '*remote-debugging-port*')",
    testNode: "$_.Name -eq 'node.exe' -and ($_.CommandLine -like '*scripts*test-*' -or $_.CommandLine -like '*qa-session*' -or $_.CommandLine -like '*verify-export*' -or $_.CommandLine -like '*investigate-*')",
  };
}

/** { qaThen, qaWebView, testEdge, testNode } の数。exclude には呼び出し元自身の pid を入れる。 */
export function countLeftovers(options = {}, exclude = [process.pid, process.ppid]) {
  const found = {};
  for (const [key, filter] of Object.entries(filters(options))) {
    const skip = exclude.length ? ` -and (${exclude.map((pid) => `$_.ProcessId -ne ${pid}`).join(" -and ")})` : "";
    found[key] = Number(powershell(`@(Get-CimInstance Win32_Process | Where-Object { (${filter})${skip} }).Count`)) || 0;
  }
  return found;
}

/** 指定した種類（既定は4種類すべて）を止める。止めた数を返す。 */
export function stopLeftovers(options = {}, exclude = [process.pid, process.ppid], kinds = null) {
  const all = Object.entries(filters(options))
    .filter(([key]) => !kinds || kinds.includes(key))
    .map(([, filter]) => `(${filter})`).join(" -or ");
  const skip = exclude.map((pid) => `$_.ProcessId -ne ${pid}`).join(" -and ");
  return Number(powershell(
    `$p = @(Get-CimInstance Win32_Process | Where-Object { (${all}) -and (${skip}) }); ` +
    "$p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; $p.Count",
  )) || 0;
}

export function formatLeftovers(found) {
  return `QA Then ${found.qaThen}, QA WebView2 ${found.qaWebView}, test Edge ${found.testEdge}, test node ${found.testNode}`;
}
