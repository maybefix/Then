import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Receives IME sessions recorded by src/editor/imeTrace.ts, which runs only
// on a dev server started with VITE_QA_IME_TRACE=1.
const imeTraceSink = (): Plugin => ({
  name: "then-ime-trace-sink",
  apply: (_config, { command }) => command === "serve" && process.env.VITE_QA_IME_TRACE === "1",
  configureServer(server) {
    server.middlewares.use("/__dev/ime-trace", (request, response) => {
      if (request.method !== "POST") {
        response.statusCode = 405;
        response.end();
        return;
      }
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => (body += chunk));
      request.on("end", async () => {
        const directory = path.resolve("tmp/ime-trace");
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`), body);
        response.statusCode = 204;
        response.end();
      });
    });
  },
});

export default defineConfig({
  plugins: [react(), imeTraceSink()],
  clearScreen: false,
  server: {
    port: Number(process.env.PORT) || 1420,
    strictPort: true,
    watch: {
      ignored: ["**/.edge-ui-check*/**", "**/src-tauri/target/**", "**/tmp/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2020",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: Boolean(process.env.TAURI_DEBUG),
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replaceAll("\\", "/");
          if (
            normalized.endsWith("/src/CanvasWindowApp.tsx") ||
            normalized.endsWith("/src/canvasTypes.ts")
          ) {
            return "canvas";
          }
          if (
            normalized.includes("/src/components/proofread/") ||
            normalized.includes("/src/proofread/")
          ) {
            return "proofread";
          }
          if (!normalized.includes("/node_modules/")) return undefined;
          if (
            normalized.includes("/node_modules/react/") ||
            normalized.includes("/node_modules/react-dom/") ||
            normalized.includes("/node_modules/scheduler/")
          ) {
            return "react-vendor";
          }
          if (
            normalized.includes("/node_modules/@tiptap/") ||
            normalized.includes("/node_modules/prosemirror-") ||
            normalized.includes("/node_modules/orderedmap/") ||
            normalized.includes("/node_modules/rope-sequence/") ||
            normalized.includes("/node_modules/w3c-keyname/") ||
            normalized.includes("/node_modules/crelt/")
          ) {
            return "editor-vendor";
          }
          if (normalized.includes("/node_modules/jszip/")) return "docx-vendor";
          if (normalized.includes("/node_modules/@tauri-apps/")) return "tauri-vendor";
          return undefined;
        },
      },
    },
  },
});
