/** 一覧やステータスバー用の短い時刻。1日以内は「N分前」「N時間前」、それ以降は日付。 */
export function formatSnapshotAge(value: number, now = Date.now()): string {
  const minutes = Math.floor((now - value) / 60_000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}時間前`;
  const date = new Date(value);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
