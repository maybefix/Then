// BINDER 3-1: the link index of one work (docs/BINDER_LINK_INDEX_PLAN.md).
//
// Each text file keeps the links it writes. Where a link goes is decided from
// the files that exist now, every time, so deleting a file leaves its links
// with no destination and restoring it brings them back. What is kept on disk
// between runs (the cache) holds only each file's stamp and its links; a file
// whose modification time or size changed is read again.
import { type FoundLink, type LinkKind, type LinkPlace, findLinks, rewriteLinks } from "./linkSyntax";

export type LinkStamp = {
  path: string;
  kind: "text" | "asset";
  modifiedAt: number | null;
  size: number;
  role?: "material" | null;
};

export type IndexedLink = { kind: LinkKind; target: string };

/** A link as the index keeps it: also where it was written (BINDER 3-4). */
export type StoredLink = IndexedLink & { place: LinkPlace };

type IndexedFile = {
  path: string;
  /** Stamp the links were read at; null after a save (read again next time). */
  modifiedAt: number | null;
  size: number | null;
  links: StoredLink[];
};

/** How many links of one file were written in one place (BINDER 3-4). */
export type PlaceCount = { place: LinkPlace; count: number };

/** A file that links to a file, with where (BINDER 3-4). */
export type BacklinkDetail = {
  path: string;
  /** Links that go to the file. */
  count: number;
  /** `count` by place, in the order they first appear in the file. */
  places: PlaceCount[];
  /**
   * Name links that could mean the file but also another one (4A: not decided,
   * so not in `count`), with the names as written.
   */
  undecided: number;
  undecidedNames: string[];
};

export type LinkPathChange = { oldPath: string; newPath: string };

/** What each link says after a rename or move, and which files (by their new path) are notes. */
export type LinkRewritePlan = {
  rewrite: (link: FoundLink) => string | null;
  isNote: (path: string) => boolean;
};

// 2 (BINDER 3-4): each link also keeps its place. A cache of version 1 is
// dropped, so every file is read once again.
const CACHE_VERSION = 2;

/** Place codes in the cache: 0 body, 1 comment, 2 property (its key follows; "" for none). */
type CachedLink = [0 | 1, string, 0 | 1 | 2, string?];

type CacheFile = {
  version: number;
  files: Record<string, { m: number | null; s: number | null; l: CachedLink[] }>;
};

function placeToCache(place: LinkPlace): [0 | 1 | 2, string?] {
  if (place.in === "property") return [2, place.key ?? ""];
  return [place.in === "comment" ? 1 : 0];
}

function placeFromCache(code: unknown, key: unknown): LinkPlace {
  if (code === 2) return { in: "property", key: typeof key === "string" && key ? key : null };
  return code === 1 ? { in: "comment" } : { in: "body" };
}

function samePlace(left: LinkPlace, right: LinkPlace): boolean {
  if (left.in !== right.in) return false;
  return left.in !== "property" || left.key === (right as { key: string | null }).key;
}

function normalizeSlashes(path: string): string {
  return path.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
}

function comparable(path: string): string {
  return normalizeSlashes(path).toLocaleLowerCase();
}

export function relativeTo(rootPath: string, path: string): string | null {
  const root = normalizeSlashes(rootPath);
  const normalized = normalizeSlashes(path);
  if (!normalized.toLocaleLowerCase().startsWith(`${root.toLocaleLowerCase()}/`)) return null;
  return normalized.slice(root.length + 1);
}

function joinRoot(rootPath: string, relative: string): string {
  const separator = rootPath.includes("\\") ? "\\" : "/";
  return `${rootPath.replace(/[\\/]+$/, "")}${separator}${relative.split("/").join(separator)}`;
}

/** Retargets `path` under `oldPath` to under `newPath`; null when outside. */
function retarget(path: string, oldPath: string, newPath: string): string | null {
  const target = comparable(path);
  const old = comparable(oldPath);
  if (target === old) return newPath;
  if (!target.startsWith(`${old}/`)) return null;
  const separator = newPath.includes("\\") ? "\\" : "/";
  const suffix = normalizeSlashes(path).slice(normalizeSlashes(oldPath).length + 1);
  return `${newPath.replace(/[\\/]+$/, "")}${separator}${suffix.split("/").join(separator)}`;
}

function applyChanges(path: string, changes: readonly LinkPathChange[], reverse = false): string {
  let next = path;
  for (const change of reverse ? [...changes].reverse() : changes) {
    const moved = reverse ? retarget(next, change.newPath, change.oldPath) : retarget(next, change.oldPath, change.newPath);
    if (moved) next = moved;
  }
  return next;
}

const TEXT_EXTENSION = /\.(md|txt)$/i;

function stem(relative: string): string {
  return relative.replace(TEXT_EXTENSION, "");
}

/** Where links go, for one set of files. */
class TargetTable {
  private readonly byRelative = new Map<string, string>();
  /** Relative paths, lower-cased, with and without the text extension. */
  private readonly entries: Array<{ path: string; withExtension: string; withoutExtension: string }> = [];

  constructor(rootPath: string, paths: readonly string[]) {
    for (const path of paths) {
      const relative = relativeTo(rootPath, path);
      if (!relative) continue;
      const lower = relative.toLocaleLowerCase();
      this.byRelative.set(lower, path);
      this.entries.push({ path, withExtension: lower, withoutExtension: stem(lower) });
    }
  }

  resolvePath(target: string): string | null {
    const key = normalizeSlashes(target.trim()).replace(/^\.\//, "").toLocaleLowerCase();
    return this.byRelative.get(key) ?? null;
  }

  /** Files a name link could mean. Plain names match the file name; `a/b` matches the end of the path. */
  candidates(target: string): string[] {
    const key = normalizeSlashes(target.trim()).toLocaleLowerCase();
    if (!key) return [];
    const found: string[] = [];
    for (const entry of this.entries) {
      for (const form of [entry.withoutExtension, entry.withExtension]) {
        if (form === key || form.endsWith(`/${key}`)) {
          found.push(entry.path);
          break;
        }
      }
    }
    return found;
  }

  /** The file a name link goes to, or null when there is none or more than one (4A). */
  resolveName(target: string): string | null {
    const found = this.candidates(target);
    return found.length === 1 ? found[0] : null;
  }

  resolve(link: IndexedLink): string | null {
    return link.kind === "path" ? this.resolvePath(link.target) : this.resolveName(link.target);
  }
}

export class LinkIndex {
  readonly rootPath: string;
  private files = new Map<string, IndexedFile>();
  private stamps: LinkStamp[] = [];
  private roles = new Map<string, "material" | null>();
  private table: TargetTable;
  private changes = 0;
  /**
   * How many times each file's text was taken in (BINDER 3-5). A refresh notes
   * it before reading a file from disk and drops what it read when a save took
   * in newer text meanwhile.
   */
  private generations = new Map<string, number>();

  /**
   * Goes up whenever what the index holds (links or destinations) changes, by
   * any path: a refresh, a save, or a rename's rewrite calling setFileText
   * directly (BINDER 3-4). The screen compares it to tell when to draw again.
   */
  get revision(): number {
    return this.changes;
  }

  constructor(rootPath: string) {
    this.rootPath = rootPath;
    this.table = new TargetTable(rootPath, []);
  }

  isNote(path: string): boolean {
    return this.roles.get(comparable(path)) === "material";
  }

  /** Reads what the cache holds; files are checked against their stamps in `refresh`. */
  loadCache(json: string | null): void {
    this.files = new Map();
    if (!json) return;
    try {
      const cache = JSON.parse(json) as CacheFile;
      if (cache?.version !== CACHE_VERSION || typeof cache.files !== "object") return;
      for (const [relative, entry] of Object.entries(cache.files)) {
        const path = joinRoot(this.rootPath, relative);
        this.files.set(comparable(path), {
          path,
          modifiedAt: entry.m,
          size: entry.s,
          links: entry.l.map(([kind, target, place, key]) => ({
            kind: kind === 0 ? "path" : "name",
            target,
            place: placeFromCache(place, key),
          })),
        });
      }
    } catch {
      this.files = new Map();
    }
  }

  toCache(): string {
    const files: CacheFile["files"] = {};
    for (const file of this.files.values()) {
      const relative = relativeTo(this.rootPath, file.path);
      if (!relative) continue;
      files[relative] = {
        m: file.modifiedAt,
        s: file.size,
        l: file.links.map((link): CachedLink => [link.kind === "path" ? 0 : 1, link.target, ...placeToCache(link.place)]),
      };
    }
    return JSON.stringify({ version: CACHE_VERSION, files } satisfies CacheFile);
  }

  /**
   * Brings the index up to the files as they are: drops files that are gone and
   * reads only the text files whose stamp changed. Returns how many were read
   * and whether anything (links or destinations) may have changed.
   */
  async refresh(
    stamps: readonly LinkStamp[],
    readText: (path: string) => Promise<string | null>,
    override?: (path: string) => string | null,
  ): Promise<{ read: number; changed: boolean }> {
    // A file whose role alone changed (moved into or out of the materials
    // folder) changes the notes, so it is a change too (BINDER 3-5).
    let changed = this.stamps.length !== stamps.length ||
      stamps.some((stamp, index) =>
        comparable(stamp.path) !== comparable(this.stamps[index]?.path ?? "") ||
        (stamp.role ?? null) !== (this.stamps[index]?.role ?? null));
    this.stamps = [...stamps];
    this.roles = new Map(stamps.map((stamp) => [comparable(stamp.path), stamp.role ?? null]));
    this.table = new TargetTable(this.rootPath, stamps.map((stamp) => stamp.path));
    const textKeys = new Set<string>();
    let read = 0;
    for (const stamp of stamps) {
      if (stamp.kind !== "text") continue;
      const key = comparable(stamp.path);
      textKeys.add(key);
      const known = this.files.get(key);
      const open = override?.(stamp.path) ?? null;
      if (open !== null) {
        if (this.setFileText(stamp.path, open, null, null)) changed = true;
        continue;
      }
      if (known && known.modifiedAt !== null && known.modifiedAt === stamp.modifiedAt && known.size === stamp.size) continue;
      const generation = this.generations.get(key) ?? 0;
      const text = await readText(stamp.path);
      read += 1;
      if (text === null) continue;
      // A save finished while this was read: its text is newer than the disk's.
      if ((this.generations.get(key) ?? 0) !== generation) continue;
      if (this.setFileText(stamp.path, text, stamp.modifiedAt, stamp.size)) changed = true;
    }
    for (const key of [...this.files.keys()]) {
      if (!textKeys.has(key)) {
        this.files.delete(key);
        changed = true;
      }
    }
    if (changed) this.changes += 1;
    return { read, changed };
  }

  /**
   * Reads the links of one file from its text (after a save). Returns whether
   * they changed. The stamp is forgotten, so the next refresh reads the file.
   */
  setFileText(path: string, text: string, modifiedAt: number | null = null, size: number | null = null): boolean {
    const key = comparable(path);
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    const links = findLinks(text, this.isNote(path)).map(({ kind, target, place }) => ({ kind, target, place }));
    const known = this.files.get(key);
    const same = !!known && known.links.length === links.length &&
      known.links.every((link, index) =>
        link.kind === links[index].kind && link.target === links[index].target && samePlace(link.place, links[index].place));
    this.files.set(key, { path: known?.path ?? path, modifiedAt, size, links: same ? known!.links : links });
    if (!same) this.changes += 1;
    return !same;
  }

  /** The links `path` writes, with where each goes (null: nowhere, or more than one file). */
  linksFrom(path: string): Array<StoredLink & { resolved: string | null }> {
    const file = this.files.get(comparable(path));
    return (file?.links ?? []).map((link) => ({ ...link, resolved: this.table.resolve(link) }));
  }

  /** Files that link to `path`, each with how many times. */
  backlinksTo(path: string): Array<{ path: string; count: number }> {
    const key = comparable(path);
    const result: Array<{ path: string; count: number }> = [];
    for (const file of this.files.values()) {
      let count = 0;
      for (const link of file.links) {
        const resolved = this.table.resolve(link);
        if (resolved && comparable(resolved) === key) count += 1;
      }
      if (count) result.push({ path: file.path, count });
    }
    return result;
  }

  /**
   * Files that link to `path`, with where the links were written and the name
   * links that could mean `path` but are not decided (BINDER 3-4). Files with
   * neither are left out. Same order as `backlinksTo`.
   */
  backlinkDetails(path: string): BacklinkDetail[] {
    const key = comparable(path);
    const result: BacklinkDetail[] = [];
    // A name is looked up once per call, however many files write it.
    const undecidedByName = new Map<string, boolean>();
    const undecided = (target: string) => {
      const name = normalizeSlashes(target.trim()).toLocaleLowerCase();
      let known = undecidedByName.get(name);
      if (known === undefined) {
        const found = this.table.candidates(target);
        known = found.length > 1 && found.some((candidate) => comparable(candidate) === key);
        undecidedByName.set(name, known);
      }
      return known;
    };
    for (const file of this.files.values()) {
      let count = 0;
      const places: PlaceCount[] = [];
      let undecidedCount = 0;
      const undecidedNames: string[] = [];
      for (const link of file.links) {
        const resolved = this.table.resolve(link);
        if (resolved) {
          if (comparable(resolved) !== key) continue;
          count += 1;
          const known = places.find((entry) => samePlace(entry.place, link.place));
          if (known) known.count += 1;
          else places.push({ place: link.place, count: 1 });
        } else if (link.kind === "name" && undecided(link.target)) {
          undecidedCount += 1;
          if (!undecidedNames.includes(link.target)) undecidedNames.push(link.target);
        }
      }
      if (count || undecidedCount) {
        result.push({ path: file.path, count, places, undecided: undecidedCount, undecidedNames });
      }
    }
    return result;
  }

  /** Whether a link would go to a file now (for drawing links with no destination, 3-2). */
  resolve(link: IndexedLink): string | null {
    return this.table.resolve(link);
  }

  /**
   * Every file a link could mean (3-2). None: nowhere. More than one: not
   * decided (4A), and the editor asks which one.
   */
  candidatesFor(link: IndexedLink): string[] {
    if (link.kind === "path") {
      const path = this.table.resolvePath(link.target);
      return path ? [path] : [];
    }
    return this.table.candidates(link.target);
  }

  /**
   * The shortest `[[name]]` that means `path` alone: the file name, else as
   * many folders as it takes (`人物/汐見`). Null when even the whole path
   * does not come back to it.
   */
  shortestName(path: string): string | null {
    const relative = relativeTo(this.rootPath, path);
    if (!relative) return null;
    const parts = stem(relative).split("/");
    for (let take = 1; take <= parts.length; take += 1) {
      const candidate = parts.slice(parts.length - take).join("/");
      const resolved = this.table.resolveName(candidate);
      if (resolved && comparable(resolved) === comparable(path)) return candidate;
    }
    return null;
  }

  /** The names to suggest while typing `[[` (3-2): the notes of this work. */
  noteNames(): Array<{ name: string; path: string }> {
    const names: Array<{ name: string; path: string }> = [];
    for (const stamp of this.stamps) {
      if (stamp.kind !== "text" || (stamp.role ?? null) !== "material") continue;
      const name = this.shortestName(stamp.path);
      if (name) names.push({ name, path: stamp.path });
    }
    names.sort((left, right) => left.name.localeCompare(right.name, "ja"));
    return names;
  }

  /**
   * Files that hold a link to something `changes` moved, decided on the files
   * as they were before. `stampsAfter` lists the files after the change.
   */
  filesLinkingTo(changes: readonly LinkPathChange[], stampsAfter: readonly LinkStamp[]): string[] {
    const { rewrite } = this.planRewrite(changes, stampsAfter);
    const result: string[] = [];
    for (const file of this.files.values()) {
      if (file.links.some((link) =>
        rewrite({ kind: link.kind, target: link.target, from: 0, to: 0, fullFrom: 0, fullTo: 0 }) !== null)) {
        result.push(applyChanges(file.path, changes));
      }
    }
    return result;
  }

  /**
   * What each link should say after `changes`, or null to leave it. Decided on
   * the files as they were before (the files after, mapped back), so `[[旧名]]`
   * still finds the renamed file.
   */
  planRewrite(changes: readonly LinkPathChange[], stampsAfter: readonly LinkStamp[]): LinkRewritePlan {
    const after = stampsAfter.map((stamp) => stamp.path);
    const roles = new Map(stampsAfter.map((stamp) => [comparable(stamp.path), stamp.role ?? null]));
    const before = new TargetTable(this.rootPath, after.map((path) => applyChanges(path, changes, true)));
    const afterTable = new TargetTable(this.rootPath, after);
    const rewrite = (link: FoundLink): string | null => {
      const oldPath = before.resolve(link);
      if (!oldPath) return null;
      const newPath = applyChanges(oldPath, changes);
      if (comparable(newPath) === comparable(oldPath)) return null;
      const relative = relativeTo(this.rootPath, newPath);
      if (!relative) return null;
      if (link.kind === "path") return relative;
      return nameFor(link.target, oldPath, relative, newPath, afterTable, this.rootPath);
    };
    return { rewrite, isNote: (path) => roles.get(comparable(path)) === "material" };
  }

  /** `text` of `path` (its path after the change) with the links the plan moves rewritten. */
  rewriteText(plan: LinkRewritePlan, path: string, text: string): { text: string; count: number } {
    return rewriteLinks(text, plan.isNote(path), plan.rewrite);
  }
}

/**
 * The name to write for a name link whose file moved to `relative`. Keeps the
 * form it had (with the extension or not, as many folders as it had) and adds
 * folders only when the plain name would mean more than one file.
 */
function nameFor(
  target: string,
  oldPath: string,
  relative: string,
  newPath: string,
  table: TargetTable,
  rootPath: string,
): string {
  const oldRelative = relativeTo(rootPath, oldPath) ?? "";
  const oldName = oldRelative.split("/").pop() ?? "";
  const trimmed = normalizeSlashes(target.trim());
  const withExtension = trimmed.split("/").pop()?.toLocaleLowerCase() === oldName.toLocaleLowerCase() &&
    TEXT_EXTENSION.test(oldName) || !TEXT_EXTENSION.test(oldName);
  const parts = (withExtension ? relative : stem(relative)).split("/");
  const depth = Math.min(trimmed.split("/").length, parts.length);
  for (let take = depth; take <= parts.length; take += 1) {
    const candidate = parts.slice(parts.length - take).join("/");
    const resolved = table.resolveName(candidate);
    if (resolved && comparable(resolved) === comparable(newPath)) return candidate;
  }
  return parts.join("/");
}
