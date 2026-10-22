// Interleaved A/B typing benchmark for manuscript (原稿用紙) mode.
//
//   node scripts/benchmark-manuscript-ab.mjs --base-dist <dir> [--dist <dir>] [--rounds 3]
//        [--samples 40] [--scenario typing|ime] [--at middle|end] [--writing-mode vertical-rl]
//        [--only normal,manuscript]
//
// Runs benchmark-typing.mjs (100k chars, --project --typewriter) round-robin
// over: the base build (e.g. main), this build, this build with manuscript
// mode on, and this build with line numbers on (the same full-decoration
// path manuscript mode uses). Absolute numbers swing between runs on one
// machine, so only the interleaved comparison is meaningful.
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const baseDist = option("base-dist", null);
const dist = option("dist", path.join(os.tmpdir(), "then-bench-dist"));
const rounds = Number(option("rounds", 3));
const common = ["--project", "--typewriter", "--no-build", "--samples", option("samples", "40"),
  "--at", option("at", "middle"), "--scenario", option("scenario", "typing"),
  "--writing-mode", option("writing-mode", "vertical-rl")];

const only = option("only", null)?.split(",");
const configs = [
  ...(baseDist ? [{ label: "base", args: ["--dist", baseDist] }] : []),
  ...(baseDist ? [{ label: "base-manuscript", args: ["--dist", baseDist, "--manuscript"] }] : []),
  { label: "normal", args: ["--dist", dist] },
  { label: "manuscript", args: ["--dist", dist, "--manuscript"] },
  { label: "line-numbers", args: ["--dist", dist, "--line-numbers"] },
].filter((config) => !only || only.includes(config.label));

const results = new Map(configs.map((config) => [config.label, []]));
for (let round = 0; round < rounds; round++) {
  for (const config of configs) {
    const run = spawnSync(process.execPath, ["scripts/benchmark-typing.mjs", ...common, ...config.args, "--label", config.label],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const line = run.stdout.split(/\r?\n/).reverse().find((text) => text.startsWith("{"));
    if (!line) {
      console.error(`[${config.label}] round ${round + 1} failed\n${run.stdout.slice(-2000)}\n${run.stderr.slice(-2000)}`);
      continue;
    }
    const result = JSON.parse(line);
    results.get(config.label).push(result);
    console.log(`[round ${round + 1}] ${config.label}: task ${result.cpuPerKey.task}ms script ${result.cpuPerKey.script}ms ` +
      `style ${result.cpuPerKey.style}ms layout ${result.cpuPerKey.layout}ms frameGap p95 ${result.frameGap?.p95} ` +
      `>25ms ${result.framesOver25ms} text ${result.textMatches} undo ${result.undoRestores}/${result.redoRestores}`);
  }
}

const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};
const minimum = (values) => {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.min(...finite) : null;
};
// The minimum is the least disturbed run; on a busy machine it is steadier than the median.
for (const [heading, reduce] of [["medians", median], ["minimums", minimum]]) {
  console.log(`\n-- ${heading} across rounds (cpu ms per keystroke) --`);
  for (const [label, list] of results) {
    const pick = (read) => reduce(list.map(read));
    console.log(`${label.padEnd(13)} task ${pick((r) => r.cpuPerKey.task)}  script ${pick((r) => r.cpuPerKey.script)}  ` +
      `style ${pick((r) => r.cpuPerKey.style)}  layout ${pick((r) => r.cpuPerKey.layout)}  ` +
      `frameGap p95 ${pick((r) => r.frameGap?.p95)}  framesOver25ms ${pick((r) => r.framesOver25ms)}  runs ${list.length}`);
  }
}
