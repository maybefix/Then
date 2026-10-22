// Per-keystroke rendering lifecycle cost from a benchmark-typing.mjs --trace-file.
//   node scripts/summarize-lifecycle.mjs <trace.json> <keystrokes> [label]
import { readFile } from "node:fs/promises";

const [file, keys = "1", label = ""] = process.argv.slice(2);
const events = JSON.parse(await readFile(file, "utf8")).traceEvents;
const layouts = new Map();
for (const event of events) if (event.name === "Layout") layouts.set(event.tid, (layouts.get(event.tid) ?? 0) + 1);
const main = [...layouts].sort((a, b) => b[1] - a[1])[0][0];
const totals = new Map();
for (const event of events) {
  if (event.tid !== main || event.ph !== "X" || !event.dur) continue;
  totals.set(event.name, (totals.get(event.name) ?? 0) + event.dur);
}
const per = (name) => ((totals.get(name) ?? 0) / 1000 / Number(keys)).toFixed(2);
console.log(`${label.padEnd(16)} lifecycle ${per("WebFrameWidgetImpl::UpdateLifecycle")} layerize ${per("Layerize")} paint ${per("Paint")} prepaint ${per("PrePaint")} layout ${per("Layout")} style ${per("UpdateLayoutTree")} rAF ${per("FireAnimationFrame")} react ${per("MessagePort::Accept")} runTask ${per("RunTask")}`);
