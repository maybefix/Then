/**
 * 投稿（BINDER 2-1、docs/BINDER_POST_STREAM_PLAN.md）の形と、絞り込み・並べ方。
 * 読み書きは Rust（src-tauri/src/post_stream.rs）だけが行い、ここは届いた一覧を見せる形にするだけ。
 */

export type PostWork = { id: string; name: string };

export type Post = {
  id: string;
  /** 書いた時刻。時差つきの ISO 8601。 */
  at: string;
  work?: PostWork;
  body: string;
  replyTo?: string;
  edited?: string;
  /** 受信箱から外したか。 */
  filed: boolean;
  /** 「ノートにする」（2-3）で作ったノートがあるか。 */
  noted: boolean;
  /** ファイルのこの行のハッシュ。本文を直す・消すときに返す。 */
  hash: string;
};

export type PostsSnapshot = {
  posts: Post[];
  /** いま開いている作品。ライブラリ直下ではない。ID は最初の投稿まで空のことがある。 */
  work?: PostWork;
  signature: string;
  imported: number;
};

export type DeletedPost = {
  snapshot: PostsSnapshot;
  line: string;
  index: number;
};

export const postFilters = ["inbox", "all", "work"] as const;
export type PostFilter = (typeof postFilters)[number];

export const postFilterLabels: Record<PostFilter, string> = {
  inbox: "受信箱",
  all: "すべて",
  work: "この作品",
};

export function normalizePostFilter(value: unknown): PostFilter {
  return postFilters.includes(value as PostFilter) ? (value as PostFilter) : "inbox";
}

/** 外で直された・消された投稿を書き換えようとしたときに、Rust が返すエラーの印。 */
export const POST_CONFLICT = "POST_CONFLICT";

export function isPostConflict(error: unknown): boolean {
  return String(error).includes(POST_CONFLICT);
}

export function isInInbox(post: Post): boolean {
  return !post.filed && !post.noted;
}

/**
 * 「この作品」の投稿か。ID で見て、ID のない投稿や、作品の ID が付く前の作品では名前で見る
 * （古い版の Then が project.json の workId を落としたときも、名前が同じなら同じ作品とみなす）。
 */
export function isFromWork(post: Post, work: PostWork | undefined): boolean {
  if (!work || !post.work) return false;
  if (work.id && post.work.id === work.id) return true;
  return post.work.name === work.name;
}

export function countInbox(posts: Post[]): number {
  return posts.filter(isInInbox).length;
}

function matchesFilter(post: Post, filter: PostFilter, work: PostWork | undefined): boolean {
  if (filter === "inbox") return isInInbox(post);
  if (filter === "work") return isFromWork(post, work);
  return true;
}

/** 新しい順。時刻が同じなら ID（時刻の順に付く）で。 */
function newestFirst(a: Post, b: Post): number {
  const byTime = Date.parse(b.at) - Date.parse(a.at);
  if (Number.isFinite(byTime) && byTime !== 0) return byTime;
  return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
}

export type PostRow = {
  post: Post;
  /** 返信の深さ。0 が流れの先頭。 */
  depth: number;
  /** 絞り込みでは外れるが、返信の流れを切らないために出している投稿。 */
  context: boolean;
};

export type PostDay = { key: string; rows: PostRow[] };

/**
 * 絞り込んだ投稿を、返信を返信先の下に並べた行にする。流れの先頭は新しい順、返信は古い順（会話の順）。
 * 返信が絞り込みに残っていれば、返信先も薄く出す。返信先がファイルにない返信は、先頭として出す。
 */
export function arrangePosts(posts: Post[], filter: PostFilter, work: PostWork | undefined): PostRow[] {
  const byId = new Map(posts.map((post) => [post.id, post]));
  const parentOf = (post: Post) => (post.replyTo && post.replyTo !== post.id ? byId.get(post.replyTo) : undefined);
  const matched = new Set(posts.filter((post) => matchesFilter(post, filter, work)).map((post) => post.id));
  const shown = new Set<string>();
  for (const post of posts) {
    if (!matched.has(post.id)) continue;
    // 返信の流れの全部を出す（先頭から、残っている返信までの道）。
    let current: Post | undefined = post;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      shown.add(current.id);
      current = parentOf(current);
    }
  }
  const children = new Map<string, Post[]>();
  const roots: Post[] = [];
  for (const post of posts) {
    if (!shown.has(post.id)) continue;
    const parent = parentOf(post);
    if (parent && shown.has(parent.id)) {
      children.set(parent.id, [...(children.get(parent.id) ?? []), post]);
    } else {
      roots.push(post);
    }
  }
  const rows: PostRow[] = [];
  const visit = (post: Post, depth: number, seen: Set<string>) => {
    if (seen.has(post.id)) return;
    seen.add(post.id);
    rows.push({ post, depth, context: !matched.has(post.id) });
    for (const child of [...(children.get(post.id) ?? [])].sort((a, b) => -newestFirst(a, b))) {
      visit(child, depth + 1, seen);
    }
  };
  const seen = new Set<string>();
  for (const root of roots.sort(newestFirst)) visit(root, 0, seen);
  // 返信先がたがいを指し合う（外で書き換えられた）投稿は、先頭がないので、先頭として出す。
  for (const post of posts.filter((entry) => shown.has(entry.id)).sort(newestFirst)) visit(post, 0, seen);
  return rows;
}

function dayKey(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** 流れの先頭の投稿の日で区切る（返信は、先頭と同じ日の区切りに入れる）。 */
export function groupByDay(rows: PostRow[]): PostDay[] {
  const days: PostDay[] = [];
  for (const row of rows) {
    const last = days[days.length - 1];
    const key = row.depth === 0 ? dayKey(row.post.at) : last?.key ?? dayKey(row.post.at);
    if (last && last.key === key) last.rows.push(row);
    else days.push({ key, rows: [row] });
  }
  return days;
}

/** 日の区切りの見出し。今日・昨日、今年なら「11月12日」、それより前は年も付ける。 */
export function dayLabel(key: string, now = new Date()): string {
  const [year, month, day] = key.split("-").map(Number);
  if (!year) return "";
  const date = new Date(year, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (diff === 0) return "今日";
  if (diff === 1) return "昨日";
  return year === now.getFullYear() ? `${month}月${day}日` : `${year}年${month}月${day}日`;
}

export function timeLabel(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** いまの時刻を、時差つきの ISO 8601（秒まで）で。ファイルを開いて読めるように地方時で書く。 */
export function localIsoNow(now = new Date()): string {
  const pad = (value: number) => String(Math.abs(value)).padStart(2, "0");
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
}
