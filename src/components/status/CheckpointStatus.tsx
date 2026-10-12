import { useEffect, useState } from "react";
import { formatSnapshotAge } from "../checkpoints/snapshotAge";

export type CheckpointStatusInfo = {
  /** 最後の手動保存点。まだなければ null。 */
  latest: { label: string; createdAt: number; visibleTextLength: number } | null;
  /** 現在のプロジェクトの表示文字数。索引が揃っていなければ null。 */
  currentVisibleTextLength: number | null;
  onOpen: () => void;
  onCreate: () => void;
};

const signed = (value: number) =>
  value === 0 ? "±0" : `${value > 0 ? "+" : "−"}${Math.abs(value).toLocaleString("ja-JP")}`;

/** 「保存点 2時間前 · +1,240字」。経過表示は1分ごとに更新する。 */
export function CheckpointStatus({ latest, currentVisibleTextLength, onOpen, onCreate }: CheckpointStatusInfo) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!latest) {
    return (
      <button type="button" className="statusCheckpoint" title="今の状態を保存点にする（Ctrl+Shift+S）" onClick={onCreate}>
        保存点なし
      </button>
    );
  }
  const delta = currentVisibleTextLength === null ? null : currentVisibleTextLength - latest.visibleTextLength;
  return (
    <button
      type="button"
      className="statusCheckpoint"
      title={`最後の保存点「${latest.label}」との差分を見る`}
      onClick={onOpen}
    >
      保存点 {formatSnapshotAge(latest.createdAt)}
      {delta !== null && <span className="statusCheckpointDelta"> · {signed(delta)}字</span>}
    </button>
  );
}
