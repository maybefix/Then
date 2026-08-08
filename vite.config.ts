import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: Number(process.env.PORT) || 1420,
    strictPort: true,
    watch: {
      ignored: ["**/.edge-ui-check*/**", "**/src-tauri/target/**"],
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
