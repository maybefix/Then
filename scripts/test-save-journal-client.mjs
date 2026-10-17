// The editor side of the recovery journal (src/editor/saveJournal.ts) against
// a model of the backend that follows the same rules (generations in order,
// whole-text replacements may skip ahead, a save leaves later changes alone).
//
// Spec checked here:
// - a save writes exactly the text fixed when it was requested, as the
//   generation fixed with it, and the journal vouches for that pairing;
// - changes made while a save waits or runs keep reaching the journal
//   (nothing is held back for the save);
// - a save never winds the journal back; at the end the journal holds the
//   editor's latest text.
import assert from "node:assert/strict";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const bundle = await build({
  entryPoints: [path.join(root, "src/editor/saveJournal.ts")],
  bundle: true,
  format: "esm",
  write: false,
  platform: "neutral",
  define: { "import.meta.env.DEV": "true" },
  plugins: [{
    name: "fake-tauri",
    setup(b) {
      b.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: "fake-tauri", namespace: "fake" }));
      b.onLoad({ filter: /.*/, namespace: "fake" }, () => ({
        contents: "export const invoke = (command, args) => globalThis.__fakeInvoke(command, args);",
        loader: "js",
      }));
    },
  }],
});
const client = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

let seed = 7;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = (n) => Math.floor(random() * n);
const tick = () => new Promise((resolve) => setTimeout(resolve, pick(3)));
const alphabet = ["あ", "い", "漢", "字", "。", "a", "\n", "𠮷", "「", "」"];

function makeBackend({ failRate }) {
  const journals = new Map();
  const disk = new Map();
  const calls = { edits: 0, editsDuringSave: 0, saves: 0, unvouched: 0, failures: 0 };
  let savesRunning = 0;
  globalThis.__fakeInvoke = async (command, args) => {
    if (command === "journal_edits") {
      calls.edits += 1;
      if (savesRunning > 0) calls.editsDuringSave += 1;
      await tick();
      if (random() < failRate) {
        calls.failures += 1;
        // Lost on the way: the backend never saw this batch.
        throw new Error("send failed");
      }
      if (!journals.has(args.key)) {
        if (args.base === null) throw new Error("journal is not open");
        journals.set(args.key, { gen: 0, text: args.base, byGen: new Map([[0, args.base]]) });
      }
      const journal = journals.get(args.key);
      for (const edit of args.edits) {
        if (edit.replace) {
          if (edit.gen <= journal.gen) throw new Error("replacement does not move forward");
          journal.text = edit.insert;
        } else {
          if (edit.gen !== journal.gen + 1) throw new Error("journal is out of step with the editor");
          if (journal.text.length !== edit.length) throw new Error("journal is out of step with the editor");
          journal.text = journal.text.slice(0, edit.from) + edit.insert + journal.text.slice(edit.to);
        }
        journal.gen = edit.gen;
        journal.byGen.set(edit.gen, journal.text);
      }
      return null;
    }
    if (command === "journal_save") {
      calls.saves += 1;
      savesRunning += 1;
      try {
        await tick();
        const journal = journals.get(args.key);
        if (journal && args.gen > journal.gen) throw new Error("generation not received yet");
        const latestBefore = journal?.text;
        if (!journal || journal.byGen.get(args.gen) !== args.content) calls.unvouched += 1;
        disk.set(args.path, args.content);
        await tick();
        if (journal) assert.equal(journal.gen >= args.gen, true);
        // A save leaves the journal's latest text alone (only edits move it).
        if (journal && journal.text !== latestBefore) {
          // Edits arrived during the save: fine, they moved it forward.
          assert.ok(journal.gen > args.gen);
        }
        return { path: args.path, name: "x.md", content: args.content, fileId: "id", contentHash: "h" };
      } finally {
        savesRunning -= 1;
      }
    }
    if (command === "journal_forget") return null;
    throw new Error(`unexpected ${command}`);
  };
  return { journals, disk, calls };
}

async function run({ name, failRate, reloadRate, steps }) {
  const backend = makeBackend({ failRate });
  const key = `tab-${name}`;
  const file = `C:/novel/${name}.md`;
  let text = "第一章\n\nはじめ。";
  // Like the app's per-tab save queue: one save at a time, typing goes on.
  let saveChain = Promise.resolve();
  let reloads = 0;
  let savesChecked = 0;
  const pendingSaves = [];
  for (let step = 0; step < steps; step += 1) {
    const roll = random();
    if (roll < reloadRate) {
      // The tab's text replaced outside setActiveMarkdown (a reload).
      text = `再読み込み${step}\n${text.slice(0, pick(text.length))}`;
      reloads += 1;
      continue;
    }
    if (roll < reloadRate + 0.08) {
      // Fixed at request time, as the app's autosave timer does.
      const content = text;
      const gen = client.journalPositionOf(key, content);
      saveChain = saveChain
        .then(() => client.saveThroughJournal(key, file, content, gen))
        .then(
          (doc) => {
            assert.equal(doc.content, content, "the save writes the text fixed at request time");
            assert.equal(backend.disk.get(file), content, "the file holds that text");
            savesChecked += 1;
          },
          (error) => {
            // Only a lost batch may make a save fail; autosave tries again.
            assert.ok(failRate > 0, `save failed: ${error}`);
          },
        );
      pendingSaves.push(saveChain);
      continue;
    }
    // Typing goes on while sends and saves are in flight.
    const at = pick(text.length + 1);
    const del = Math.min(pick(3), text.length - at);
    const insert = Array.from({ length: pick(4) }, () => alphabet[pick(alphabet.length)]).join("");
    let next = text.slice(0, at) + insert + text.slice(at + del);
    // Never split a surrogate pair, as the editor would not.
    if (/[\uD800-\uDBFF]$/.test(next.slice(0, at)) || /^[\uDC00-\uDFFF]/.test(next.slice(at + insert.length))) {
      next = text + "x";
    }
    if (next === text) next += "y";
    client.recordDocumentChange(key, file, text, next);
    text = next;
    if (random() < 0.3) await tick();
  }
  await Promise.all(pendingSaves);
  const gen = client.journalPositionOf(key, text);
  const last = await client.saveThroughJournal(key, file, text, gen);
  assert.equal(last.content, text);
  assert.equal(backend.journals.get(key).text, text, `${name}: the journal holds the editor's latest text`);
  assert.equal(backend.disk.get(file), text);
  client.forgetDocumentJournal(key);
  const { calls } = backend;
  assert.ok(calls.editsDuringSave > 0, `${name}: changes kept reaching the journal during saves`);
  // The journal vouches for every save's text unless a batch was lost.
  if (failRate === 0) assert.equal(calls.unvouched, 0, `${name}: ${calls.unvouched} saves the journal could not vouch for`);
  else assert.ok(calls.unvouched <= calls.failures, `${name}: ${calls.unvouched} unvouched saves for ${calls.failures} lost batches`);
  return { ...calls, reloads, savesChecked };
}

const cases = [
  { name: "typing", failRate: 0, reloadRate: 0, steps: 3000 },
  { name: "reloads", failRate: 0, reloadRate: 0.01, steps: 3000 },
  { name: "lost-batches", failRate: 0.05, reloadRate: 0.005, steps: 3000 },
];
for (const c of cases) {
  for (let round = 0; round < 5; round += 1) {
    seed = 7 + round * 101 + c.steps;
    const calls = await run({ ...c, name: `${c.name}-${round}` });
    if (round === 0) {
      console.log(
        `${c.name}: ${calls.savesChecked} saves of the requested text, ${calls.edits} batches ` +
          `(${calls.editsDuringSave} sent while a save ran), ${calls.unvouched} unvouched, ` +
          `${calls.failures} lost, ${calls.reloads} reloads`,
      );
    }
  }
}
console.log("save journal client tests passed");
