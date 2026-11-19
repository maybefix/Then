// BINDER 3-4: what the 「つながり」 pane shows for the shown document
// (docs/BINDER_CONNECTIONS_PLAN.md). Only puts together what others hold:
// the link index (3-1) for the files that link to it and where, the posts
// (2-3) for the posts the note was made from, and the boards' reference
// cards for the boards it is placed on. Reads nothing and writes nothing.
import { propertyLabel } from "../properties/propertyLabels";
import type { Post } from "../posts/postModel";
import { type LinkIndex, type PlaceCount, relativeTo } from "./linkIndex";

/** A board's reference cards, as `list_board_references` returns them. */
export type BoardReferences = {
  id: string;
  name: string;
  references: Array<{ nodeId: string; sourcePath: string }>;
};

/** A file that links to the shown document. */
export type ConnectionFile = {
  path: string;
  /** The file name without the text extension, as the binder shows it. */
  name: string;
  /** Whether it is a note (role material). */
  isNote: boolean;
  /** Path from the work's folder, `/` separated. */
  relative: string;
  count: number;
  places: PlaceCount[];
  /**
   * Only name links that could mean this document and another one (4A). Shown
   * faint and not counted (確認1の決定6).
   */
  undecided: boolean;
  undecidedNames: string[];
};

export type ConnectionBoard = { id: string; name: string; nodeId: string; cards: number };

export type Connections = {
  /** A note shows all four sections; a manuscript only the files that link to it and the boards (決定4). */
  kind: "note" | "manuscript";
  /** Manuscripts that link to the note (「原稿に登場」). Empty for a manuscript. */
  manuscripts: ConnectionFile[];
  /** Notes that link to the note; for a manuscript, every file that links to it (「リンク元」). */
  sources: ConnectionFile[];
  /** Posts the note was made from, oldest first (「元の投稿」). Empty for a manuscript. */
  posts: Post[];
  /** Boards with a reference card to it (「置かれているボード」). */
  boards: ConnectionBoard[];
};

const comparable = (path: string) => path.replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLocaleLowerCase();

function fileName(relative: string): string {
  return (relative.split("/").pop() ?? relative).replace(/\.(md|txt)$/i, "");
}

const byPath = (left: ConnectionFile, right: ConnectionFile) =>
  left.relative.localeCompare(right.relative, "ja", { numeric: true });

/** Decided links first, then the faint ones; each by path. */
const decidedFirst = (left: ConnectionFile, right: ConnectionFile) =>
  Number(left.undecided) - Number(right.undecided) || byPath(left, right);

export function buildConnections({
  index,
  path,
  isNote,
  posts,
  boards,
}: {
  index: LinkIndex;
  path: string;
  isNote: boolean;
  posts: readonly Post[];
  boards: readonly BoardReferences[];
}): Connections {
  const relative = relativeTo(index.rootPath, path);
  const key = relative === null ? null : comparable(relative);
  const manuscripts: ConnectionFile[] = [];
  const sources: ConnectionFile[] = [];
  for (const detail of index.backlinkDetails(path)) {
    if (comparable(detail.path) === comparable(path)) continue;
    const from = (relativeTo(index.rootPath, detail.path) ?? detail.path).replace(/\\/g, "/");
    const file: ConnectionFile = {
      path: detail.path,
      name: fileName(from),
      isNote: index.isNote(detail.path),
      relative: from,
      count: detail.count,
      places: detail.places,
      undecided: detail.count === 0,
      undecidedNames: detail.undecidedNames,
    };
    if (isNote && !file.isNote) manuscripts.push(file);
    else sources.push(file);
  }
  manuscripts.sort(decidedFirst);
  sources.sort(decidedFirst);

  const madeFrom = !isNote || key === null
    ? []
    : posts
      .filter((post) =>
        post.note?.workRoot && comparable(post.note.workRoot) === comparable(index.rootPath) &&
        comparable(post.note.path) === key)
      .sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.id.localeCompare(right.id));

  const placed: ConnectionBoard[] = [];
  if (key !== null) {
    for (const board of boards) {
      const cards = board.references.filter((reference) => comparable(reference.sourcePath) === key);
      if (cards.length) placed.push({ id: board.id, name: board.name, nodeId: cards[0].nodeId, cards: cards.length });
    }
  }

  return { kind: isNote ? "note" : "manuscript", manuscripts: isNote ? manuscripts : [], sources, posts: madeFrom, boards: placed };
}

/**
 * Where a file links from, for the line under its name: 「素材 · コメント 2か所」.
 * Properties go by their shown name (`materials` is 「素材」); comment lines and
 * the body by how many.
 */
export function placeSummary(places: readonly PlaceCount[]): string {
  return places
    .map(({ place, count }) => {
      if (place.in === "property") {
        const label = place.key === null ? "プロパティ" : propertyLabel(place.key) ?? place.key;
        return count > 1 ? `${label} ${count}か所` : label;
      }
      return `${place.in === "comment" ? "コメント" : "本文"} ${count}か所`;
    })
    .join(" · ");
}

/** The number a section's heading shows: decided links only (決定6). */
export function decidedCount(files: readonly ConnectionFile[]): number {
  return files.filter((file) => !file.undecided).length;
}
