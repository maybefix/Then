import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const rawPath = path.resolve(process.argv[2] ?? "artifacts/demo/then-demo-raw.mkv");
const timelinePath = path.resolve(process.argv[3] ?? "artifacts/demo/timeline.json");
const outputPath = path.resolve(process.argv[4] ?? "artifacts/demo/then-demo.mp4");
const ffmpeg = process.env.THEN_FFMPEG || "ffmpeg";
const ffprobe = process.env.THEN_FFPROBE || (path.isAbsolute(ffmpeg) ? path.join(path.dirname(ffmpeg), "ffprobe.exe") : "ffprobe");
const timeline = JSON.parse(await readFile(timelinePath, "utf8"));

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, { stdio: "inherit", ...options });
  if (result.error) throw new Error(`${path.basename(executable)} を起動できません: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${path.basename(executable)} が終了コード ${result.status} で失敗しました。`);
}

function probe(args) {
  const result = spawnSync(ffprobe, args, { encoding: "utf8" });
  if (result.error) throw new Error(`ffprobe を起動できません: ${result.error.message}`);
  if (result.status !== 0) throw new Error(result.stderr || "ffprobe に失敗しました。");
  return result.stdout.trim();
}

const [width, height] = probe([
  "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", rawPath,
]).split("x").map(Number);
const duration = Number(probe(["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", rawPath]));
const fps = 30;

const smooth = (value) => `((${value})*(${value})*(3-2*(${value})))`;
function pulse(zoom) {
  const start = Math.max(0, zoom.at - zoom.lead);
  const holdEnd = zoom.at + zoom.hold;
  const end = holdEnd + zoom.tail;
  const inProgress = `(it-${start.toFixed(3)})/${zoom.lead.toFixed(3)}`;
  const outProgress = `(it-${holdEnd.toFixed(3)})/${zoom.tail.toFixed(3)}`;
  return `if(between(it,${start.toFixed(3)},${zoom.at.toFixed(3)}),${smooth(inProgress)},if(between(it,${zoom.at.toFixed(3)},${holdEnd.toFixed(3)}),1,if(between(it,${holdEnd.toFixed(3)},${end.toFixed(3)}),1-${smooth(outProgress)},0)))`;
}

const zooms = timeline.zooms ?? [];
const pulses = zooms.map(pulse);
const zoomDeltas = zooms.map((zoom, index) => `${(zoom.scale - 1).toFixed(3)}*${pulses[index]}`);
const maxZoomDelta = zoomDeltas.reduce((current, value) => `max(${current},${value})`, "0");
const zoomExpression = zooms.length
  ? `1+${maxZoomDelta}`
  : "1";

function targetExpression(axis) {
  let expression = "0.5";
  for (let index = zooms.length - 1; index >= 0; index -= 1) {
    const zoom = zooms[index];
    const start = Math.max(0, zoom.at - zoom.lead);
    const end = zoom.at + zoom.hold + zoom.tail;
    expression = `if(between(it,${start.toFixed(3)},${end.toFixed(3)}),${Number(zoom[axis]).toFixed(5)},${expression})`;
  }
  return expression;
}

const targetX = targetExpression("x");
const targetY = targetExpression("y");
const fadeOutStart = Math.max(0, duration - 0.55);
const filter = [
  `[0:v]fps=${fps},zoompan=d=1:s=${width}x${height}:fps=${fps}`,
  `:z='${zoomExpression}'`,
  `:x='max(0,min(iw-iw/zoom,iw*(${targetX})-iw/zoom/2))'`,
  `:y='max(0,min(ih-ih/zoom,ih*(${targetY})-ih/zoom/2))'`,
  `,fade=t=in:st=0:d=0.4,fade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.5,format=yuv420p[v]`,
].join("");

const temp = await mkdtemp(path.join(os.tmpdir(), "then-demo-"));
const filterPath = path.join(temp, "filter.txt");
try {
  await writeFile(filterPath, filter, "utf8");
  run(ffmpeg, [
    "-y", "-i", rawPath,
    "-filter_complex_script", filterPath,
    "-map", "[v]", "-an",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-movflags", "+faststart", outputPath,
  ]);
  process.stdout.write(`編集済み動画を書き出しました: ${outputPath}\n`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
