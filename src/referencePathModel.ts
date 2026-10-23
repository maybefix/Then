import {
  isReferenceBinderCard,
  type BinderCardState,
  type ReferenceFileInfo,
  type ReferenceKind,
} from "./types";

export function referenceKindFromPath(path: string): ReferenceKind {
  const extension = path.split(".").pop()?.toLocaleLowerCase();
  if (extension === "txt") return "text";
  if (extension === "md") return "markdown";
  if (extension === "png" || extension === "jpg" || extension === "jpeg" || extension === "webp") {
    return "image";
  }
  if (extension === "pdf") return "pdf";
  return "unknown";
}

export function referenceNameFromPath(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? sourcePath;
}

function retargetReferenceSourcePath(
  sourcePath: string,
  oldSourcePath: string,
  newSourcePath: string,
): string | null {
  const normalizedSourcePath = sourcePath.replace(/\\/g, "/");
  const normalizedOldPath = oldSourcePath.replace(/\\/g, "/");
  const normalizedNewPath = newSourcePath.replace(/\\/g, "/");
  if (!normalizedOldPath || !normalizedNewPath) return null;
  if (normalizedSourcePath === normalizedOldPath) return normalizedNewPath;
  if (normalizedSourcePath.startsWith(`${normalizedOldPath}/`)) {
    return `${normalizedNewPath}${normalizedSourcePath.slice(normalizedOldPath.length)}`;
  }
  return null;
}

export function retargetReferenceFileInfo(
  file: ReferenceFileInfo,
  oldSourcePath: string,
  newSourcePath: string,
): ReferenceFileInfo {
  if (file.scope !== "project") return file;
  const sourcePath = retargetReferenceSourcePath(file.sourcePath, oldSourcePath, newSourcePath);
  if (!sourcePath) return file;
  return {
    ...file,
    sourcePath,
    name: referenceNameFromPath(sourcePath),
    kind: referenceKindFromPath(sourcePath),
  };
}

export function retargetReferenceCard(
  card: BinderCardState,
  oldSourcePath: string,
  newSourcePath: string,
): BinderCardState {
  if (!isReferenceBinderCard(card)) return card;
  if (card.scope !== "project") return card;
  const sourcePath = retargetReferenceSourcePath(card.sourcePath, oldSourcePath, newSourcePath);
  if (!sourcePath) return card;
  return {
    ...card,
    sourcePath,
    kind: referenceKindFromPath(sourcePath),
  };
}
