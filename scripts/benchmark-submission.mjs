import { build } from "esbuild";
const built = await build({ stdin: { contents: `export * from './src/export/submission/createSubmissionDocument';
export * from './src/export/submission/serializeSubmission';
export * from './src/export/submission/types';`, resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "esm", write: false });
const { createSubmissionDocument, serializeSubmission, DEFAULT_SUBMISSION_OPTIONS } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const rows = [];
for (const lines of [100, 1000, 10000]) {
  const source = { id: "fixture", path: "fixture.txt", displayName: "fixture.txt", extension: "txt", enabled: true,
    order: 0, startMode: "continue", markupMode: "then-markup", content: "本文[重要(em,goma)]と[東京(rb,とうきょう)]。\n".repeat(lines) };
  const parses = [], serializes = [];
  for (let run = 0; run < 6; run++) {
    const start = performance.now();
    const doc = createSubmissionDocument([source]);
    const parsed = performance.now();
    serializeSubmission(doc, { ...DEFAULT_SUBMISSION_OPTIONS, target: "narou" });
    const end = performance.now();
    if (run) { parses.push(parsed - start); serializes.push(end - parsed); }
  }
  rows.push({ lines, inputCodeUnits: source.content.length, astMedianMs: +median(parses).toFixed(1), serializeMedianMs: +median(serializes).toFixed(1) });
}
console.log(JSON.stringify({ runtime: process.version, warmup: 1, samples: 5, rows }, null, 2));
