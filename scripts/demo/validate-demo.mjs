import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const rawPath = path.resolve(process.argv[2] ?? "artifacts/demo/then-demo-raw.mkv");
const timelinePath = path.resolve(process.argv[3] ?? "artifacts/demo/timeline.json");
const finalPath = path.resolve(process.argv[4] ?? "artifacts/demo/then-demo.mp4");
const workspacePath = path.resolve(process.argv[5] ?? "artifacts/demo/workspace");
const ffmpeg = process.env.THEN_FFMPEG || "ffmpeg";
const ffprobe = process.env.THEN_FFPROBE || (path.isAbsolute(ffmpeg) ? path.join(path.dirname(ffmpeg), "ffprobe.exe") : "ffprobe");

function execute(executable, args, options = {}) {
  const result = spawnSync(executable, args, { encoding: "utf8", ...options });
  if (result.error) throw new Error(`${path.basename(executable)} を起動できません: ${result.error.message}`);
  if (result.status !== 0) throw new Error(result.stderr || `${path.basename(executable)} が終了コード ${result.status} で失敗しました。`);
  return result.stdout;
}

function inspectVideo(file) {
  return JSON.parse(execute(ffprobe, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,r_frame_rate,nb_frames:format=duration,size",
    "-of", "json",
    file,
  ]));
}

function assert(condition, message) {
  if (!condition) throw new Error(`動画検証に失敗しました: ${message}`);
}

const raw = inspectVideo(rawPath);
const final = inspectVideo(finalPath);
const rawStream = raw.streams?.[0];
const finalStream = final.streams?.[0];
const rawDuration = Number(raw.format?.duration);
const finalDuration = Number(final.format?.duration);
const finalFrames = Number(finalStream?.nb_frames);
const timeline = JSON.parse(await readFile(timelinePath, "utf8"));
const project = JSON.parse(await readFile(path.join(workspacePath, ".then", "project.json"), "utf8"));

assert(rawStream && finalStream, "映像ストリームがありません。臨時録画または完成MP4が壊れています。");
assert(finalStream.codec_name === "h264", `完成動画のコーデックがH.264ではありません: ${finalStream.codec_name}`);
assert(finalStream.width === rawStream.width && finalStream.height === rawStream.height,
  `解像度が素材 ${rawStream.width}x${rawStream.height} から ${finalStream.width}x${finalStream.height} に変わっています。`);
assert(timeline.capture?.width > 0 && timeline.capture?.height > 0,
  "録画時の物理解像度がタイムラインに記録されていません。");
assert(finalStream.width === timeline.capture.width && finalStream.height === timeline.capture.height,
  `物理解像度 ${timeline.capture.width}x${timeline.capture.height} と録画 ${finalStream.width}x${finalStream.height} が一致しません。`);
assert(finalStream.r_frame_rate === "30/1", `フレームレートが30fpsではありません: ${finalStream.r_frame_rate}`);
assert(Math.abs(finalDuration - rawDuration) <= 0.1,
  `素材と完成動画の尺が一致しません: raw=${rawDuration}s final=${finalDuration}s`);
assert(finalFrames >= Math.floor(finalDuration * 30) - 1,
  `ドロップフレーム補間後のフレーム数が不足しています: ${finalFrames}`);
assert(Array.isArray(timeline.zooms) && timeline.zooms.length === 3,
  `ズームイベントは3件である必要があります: ${timeline.zooms?.length ?? 0}`);
assert(timeline.zooms.every((zoom) => zoom.x >= 0 && zoom.x <= 1 && zoom.y >= 0 && zoom.y <= 1),
  "画面外を指すズーム座標があります。");
assert(timeline.zooms.every((zoom) => zoom.scale >= 1.05 && zoom.scale <= 1.08),
  "ズーム倍率が控えめな1.05〜1.08倍の範囲に収まっていません。");
const zoomWindows = timeline.zooms
  .map((zoom) => ({ start: zoom.at - zoom.lead, end: zoom.at + zoom.hold + zoom.tail }))
  .sort((left, right) => left.start - right.start);
assert(zoomWindows.every((window, index) => index === 0 || window.start >= zoomWindows[index - 1].end),
  "ズーム演出が重複しています。");
const lastZoomEnd = Math.max(...timeline.zooms.map((zoom) => zoom.at + zoom.hold + zoom.tail));
assert(lastZoomEnd <= finalDuration,
  `最終ズームが完成動画から欠けています: zoomEnd=${lastZoomEnd}s final=${finalDuration}s`);

const fragments = (project.ideaThreads ?? []).flatMap((thread) => thread.fragments ?? []);
assert(fragments.some((fragment) => fragment.body === "駅員は手紙の差出人を知っている。"),
  "Ideaへのメモ追加がプロジェクトデータへ反映されていません。");
assert((project.plotCards ?? []).some((card) => card.kind === "chapter" && card.title === "第一章　雨の駅"),
  "Plotへの章追加または章タイトルが反映されていません。");
assert((project.plotCards ?? []).some((card) => card.kind === "section" && card.title === "旅人の到着" && card.body.includes("終電後のホーム")),
  "Plotへのセクションタイトルまたは本文が反映されていません。");
const editedMarkdown = await readFile(path.join(workspacePath, "01-雨の駅.md"), "utf8");
const firstSceneAt = editedMarkdown.indexOf("## 第一景");
const secondSceneAt = editedMarkdown.indexOf("## 第二景");
const thirdSceneAt = editedMarkdown.indexOf("## 第三景");
const appendedSentenceAt = editedMarkdown.indexOf("列車の窓に、朝の光が差し込んだ。");
assert(
  editedMarkdown.startsWith("# 雨の駅") &&
    firstSceneAt >= 0 && secondSceneAt > firstSceneAt && thirdSceneAt > secondSceneAt &&
    appendedSentenceAt > thirdSceneAt,
  "本文の第三景が第二景の後へ正しく追加されていません。",
);

execute(ffmpeg, ["-v", "error", "-i", finalPath, "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null"]);

process.stdout.write([
  "デモ動画の自動検証に成功しました。",
  `  ${finalStream.width}x${finalStream.height} / 30fps / ${finalFrames} frames`,
  `  duration ${finalDuration.toFixed(2)}s / zooms ${timeline.zooms.length}`,
  "  H.264全フレーム復号、本文、Idea、Plotの反映を確認",
].join("\n") + "\n");
