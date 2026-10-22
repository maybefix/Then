// Reads benchmark-typing.mjs output on stdin and prints one compact line.
//   node scripts/benchmark-typing.mjs ... | node scripts/summarize-bench-line.mjs <label>
let input = "";
process.stdin.on("data", (chunk) => (input += chunk)).on("end", () => {
  const line = input.split(/\r?\n/).reverse().find((text) => text.startsWith("{"));
  if (!line) {
    console.log(`${process.argv[2] ?? ""} FAILED\n${input.slice(-1500)}`);
    return;
  }
  const r = JSON.parse(line);
  console.log(`${(process.argv[2] ?? r.label).padEnd(24)} task ${r.cpuPerKey.task} script ${r.cpuPerKey.script} style ${r.cpuPerKey.style} layout ${r.cpuPerKey.layout} frameGap p95 ${r.frameGap?.p95} >25ms ${r.framesOver25ms}${r.editorElements ? ` elements ${r.editorElements}` : ""}${r.follow ? ` follow start p50 ${r.follow.startDelay.p50} settle p50 ${r.follow.settle.p50} p95 ${r.follow.settle.p95} (moved ${r.follow.moved})` : ""}`);
});
