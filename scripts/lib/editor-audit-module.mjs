import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { build } from "esbuild";

export async function loadEditorAuditModule(sourceFile = "src/VerticalTextEditor.tsx", importOverrides = {}) {
  const source = await readFile(sourceFile, "utf8");
  const exports = ["makeAstState", "applyAst", "astKey", "buildWindowDecos", "docTextLength", "textOffsetFromPmPos", "pmPosFromTextOffset"];
  if (source.includes('import { spliceRootDecorations }')) exports.push("spliceRootDecorations");
  if (source.includes("function replaceTextRangeTransaction(")) exports.push("replaceTextRangeTransaction");
  const bundle = await build({
    stdin: {
      contents: source.slice(0, source.indexOf("const LayoutAstExtension")) +
        source.slice(source.indexOf("function textOffsetFromPmPos("), source.indexOf("function getTextSelection(")) +
        `\nexport { ${exports.join(", ")} };`,
      resolveDir: fileURLToPath(new URL("../../src", import.meta.url)), loader: "tsx",
    },
    bundle: true, platform: "node", format: "cjs", write: false,
    external: ["@tiptap/*"], define: { "import.meta.env.DEV": "false" },
    plugins: [{name:"audit-import-overrides",setup(build){
      build.onResolve({filter:/.*/},args=>importOverrides[args.path] ? {path:resolve(importOverrides[args.path])} : undefined);
    }}],
  });
  const loaded = { exports: {} };
  new Function("module", "exports", "require", bundle.outputFiles[0].text)(loaded, loaded.exports, createRequire(import.meta.url));
  return loaded.exports;
}

export const decorationSignature = set => set.find().map(d =>
  `${d.from}:${d.to}:${d.type.constructor.name}:${JSON.stringify(d.type.attrs ?? d.spec ?? null)}`,
).sort();
