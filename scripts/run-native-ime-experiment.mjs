// Starts an isolated Then instance with the real editor and synthetic test text.
// The usual Then app/data and all manuscript files remain outside this instance.
import { createServer } from "vite";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const server = await createServer({ server: { host: "127.0.0.1", port: 1431, strictPort: true } });
await server.listen();
const url = "http://127.0.0.1:1431/?view=native-ime-qa&native-ime=1";
const config = {
  productName: "Then TSF Experiment", identifier: "local.then.native-tsf-experiment",
  build: { beforeDevCommand: null, devUrl: url },
  app: { windows: [{ label: "main", title: "Then TSF Input Experiment", url,
    width: 1180, height: 820, minWidth: 900, minHeight: 600, decorations: true, dragDropEnabled: false }] },
};
const configPath = path.resolve(".tmp/native-ime-experiment/tauri.json");
await mkdir(path.dirname(configPath), { recursive: true });
await writeFile(configPath, JSON.stringify(config, null, 2));
console.log(`Native TSF experiment: ${url}`);
const child = spawn(process.execPath, ["node_modules/@tauri-apps/cli/tauri.js", "dev", "--no-watch", "--config", configPath], {
  stdio: "inherit", windowsHide: true,
});
child.on("error", error => { console.error(error); void server.close(); process.exitCode = 1; });
child.on("exit", async code => { await server.close(); process.exitCode = code ?? 1; });
process.on("SIGINT", () => { child.kill(); void server.close(); });
