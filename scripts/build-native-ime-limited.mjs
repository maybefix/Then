// Build the normal Then app with an opt-in native TSF switch, in release mode.
// No dev server, QA view, installation, signing or publishing is involved.
import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const output = path.resolve("artifacts/native-tsf-limited");
const dist = path.join(output, "frontend");
await mkdir(output, { recursive: true });
async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit", windowsHide: true,
      env: { ...process.env, CARGO_NET_OFFLINE: "true", VITE_NATIVE_TSF_LIMITED: "1" } });
    child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Build exited ${code}`)));
  });
}
const packageOnly = process.argv.includes("--package-only");
if (!packageOnly) {
  await run(["node_modules/typescript/bin/tsc"]);
  await run(["node_modules/vite/bin/vite.js", "build", "--outDir", dist]);
}
const base = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
const config = {
  productName: "Then TSF Limited", identifier: "local.then.native-tsf-limited",
  build: { beforeBuildCommand: "", frontendDist: path.relative(path.resolve("src-tauri"), dist).replaceAll("\\", "/") },
  app: { windows: base.app.windows.map(window => ({ ...window, title: "Then TSF Limited" })) },
  bundle: { active: false },
};
const configPath = path.join(output, "tauri.limited.json");
await writeFile(configPath, JSON.stringify(config, null, 2));
if (!packageOnly) await run(["node_modules/@tauri-apps/cli/tauri.js", "build", "--no-bundle", "--config", configPath]);
const executable = path.join(output, "Then-TSF-Limited-r2.exe");
await copyFile("src-tauri/target/release/Then.exe", executable);
const binary = await readFile(executable);
const html = await readFile(path.join(dist, "index.html"), "utf8");
const entryAsset = html.match(/src="\/assets\/([^"]+\.js)"/)?.[1];
if (!entryAsset || !binary.includes(Buffer.from(entryAsset)) || !binary.includes(Buffer.from("index.html"))) {
  throw new Error("The normal index.html/assets were not embedded in the executable");
}
const digest = createHash("sha256").update(binary).digest("hex");
await writeFile(path.join(output, "build-info.json"), JSON.stringify({ builtAt: new Date().toISOString(),
  executable, sha256: digest, profile: "release", application: "normal Then App", nativeTsfSwitch: true,
  identifier: config.identifier, defaultInput: "standard", embeddedEntryAsset: entryAsset }, null, 2));
await writeFile(path.join(output, "README.txt"), [
  "Then TSF Limited", "",
  "通常のThen画面を使うリリースビルドです。EXEを直接起動できます。開発サーバーは不要です。",
  "以前の限定版が起動している場合は閉じてから、Then-TSF-Limited-r2.exe を起動してください。",
  "右下の「入力：標準」を押すとTSF入力へ切り替わります。同じ文書・表示設定・位置で比較してください。",
  "キー / IME / 編集 は実際にRustの入力経路で処理した回数です。切り替えただけでは高速化の判定はできません。",
  "通常版とは別のアプリ識別子・設定領域を使います。実ファイルの保存操作は通常どおり有効です。",
  "必要なWebView2ランタイムは普段のThenと同じです。", "",
  `SHA256: ${digest}`, "",
].join("\r\n"));
console.log(`Limited release build: ${executable}\nSHA256: ${digest}`);
