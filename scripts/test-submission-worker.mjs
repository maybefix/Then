import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { Worker as NodeWorker } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import path from "node:path";

const dir = path.resolve("test-artifacts/submission-worker");
await mkdir(dir, { recursive: true });
await build({ entryPoints: ["src/export/submission/submissionWorker.ts"], outfile: path.join(dir, "worker.mjs"),
  bundle: true, platform: "node", format: "esm", banner: { js: `import { parentPort } from 'node:worker_threads';
globalThis.self = { addEventListener: (_, fn) => parentPort.on('message', data => fn({data})), postMessage: data => parentPort.postMessage(data) };` } });
await build({ stdin: { contents: `export * from './src/export/submission/submissionClient';
export * from './src/export/submission/createSubmissionDocument';
export * from './src/export/submission/serializeSubmission';
export * from './src/export/submission/types';`, resolveDir: process.cwd() },
  outfile: path.join(dir, "client.mjs"), bundle: true, platform: "node", format: "esm" });
const { SubmissionClient, createSubmissionDocument, serializeSubmission, DEFAULT_SUBMISSION_OPTIONS } = await import(pathToFileURL(path.join(dir, "client.mjs")));
const messages = [];
let stopped = 0;
globalThis.Worker = class {
  constructor() {
    this.worker = new NodeWorker(pathToFileURL(path.join(dir, "worker.mjs")));
    this.worker.on("message", data => this.onmessage?.({ data }));
    this.worker.on("error", error => this.onerror?.(error));
  }
  postMessage(request) { messages.push(request); this.worker.postMessage(request); }
  terminate() { stopped++; void this.worker.terminate(); }
};
const source = { id: "a", displayName: "a.txt", path: "a.txt", extension: "txt", enabled: true, order: 0,
  startMode: "continue", markupMode: "then-markup", content: "# 題\n[重要(em,goma)]\n".repeat(1000) };
const sources = [source];
const client = new SubmissionClient();
for (const target of ["kakuyomu", "narou", "plain"]) {
  const options = { ...DEFAULT_SUBMISSION_OPTIONS, target };
  assert.deepEqual(await client.convert(sources, "題", options), serializeSubmission(createSubmissionDocument(sources), options));
}
assert.equal(messages[0].sources, sources);
assert.equal(messages[1].sources, undefined, "option changes reuse worker AST");
await assert.rejects(client.convert([], "題", DEFAULT_SUBMISSION_OPTIONS), /出力対象/);
assert.equal((await client.convert(sources, "題", DEFAULT_SUBMISSION_OPTIONS)).sourceCount, 1);
const pending = client.convert(sources, "題", DEFAULT_SUBMISSION_OPTIONS);
client.dispose();
await assert.rejects(pending, /閉じられました/);
assert.equal(stopped, 1);
await assert.rejects(client.convert(sources, "題", DEFAULT_SUBMISSION_OPTIONS), /閉じられました/);
// Runtime failure must settle pending requests and permit a fresh worker.
let worker;
globalThis.Worker = class { constructor() { worker = this; } postMessage() {} terminate() {} };
const failed = new SubmissionClient();
const job = failed.convert(sources, "", DEFAULT_SUBMISSION_OPTIONS);
worker.onerror();
await assert.rejects(job, /再試行/);
const retry = failed.convert(sources, "", DEFAULT_SUBMISSION_OPTIONS);
worker.onmessage({ data: { id: 2, result: { text: "再試行\n" } } });
assert.equal((await retry).text, "再試行\n");
failed.dispose();
console.log("Submission worker passed: real worker output parity, AST reuse, errors, disposal and restart");
