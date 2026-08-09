import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { DocumentLineDiff } from "./documentIndex";

type ChangedRange = {
  oldFrom: number;
  oldTo: number;
  newFrom: number;
  newTo: number;
};

const rangeDescribesSelectionEdit = (
  from: number,
  to: number,
  selectionFrom: number,
  selectionTo: number,
) => (
  from <= selectionTo &&
  to >= selectionFrom &&
  !(from < selectionFrom && to > selectionTo)
);

const selectedTopLevelRange = (state: EditorState) => {
  const from = state.selection.$from.index(0);
  const to = state.selection.$to.index(0);
  return {
    from: Math.min(from, to),
    to: Math.max(from, to) + 1,
  };
};

const singleChangedRange = (transaction: Transaction): ChangedRange | null => {
  if (transaction.mapping.maps.length !== 1) return null;

  const ranges: ChangedRange[] = [];
  transaction.mapping.maps[0].forEach((oldFrom, oldTo, newFrom, newTo) => {
    ranges.push({ oldFrom, oldTo, newFrom, newTo });
  });
  return ranges.length === 1 ? ranges[0] : null;
};

/**
 * Uses the already-resolved selections around a single ProseMirror StepMap to
 * locate the changed top-level line window without comparing every document
 * child. Transactions that do not describe an ordinary selection edit return
 * null so callers can retain their exhaustive compatibility fallback.
 */
export function lineDiffFromSelectionTransaction(
  transaction: Transaction,
  oldState: EditorState,
  newState: EditorState,
): DocumentLineDiff | null {
  if (!transaction.docChanged) return null;

  const changed = singleChangedRange(transaction);
  if (!changed) return null;
  if (
    !rangeDescribesSelectionEdit(
      changed.oldFrom,
      changed.oldTo,
      oldState.selection.from,
      oldState.selection.to,
    ) ||
    !rangeDescribesSelectionEdit(
      changed.newFrom,
      changed.newTo,
      newState.selection.from,
      newState.selection.to,
    )
  ) {
    return null;
  }

  const oldCount = oldState.doc.childCount;
  const newCount = newState.doc.childCount;
  const oldSelection = selectedTopLevelRange(oldState);
  const newSelection = selectedTopLevelRange(newState);
  const from = Math.min(oldSelection.from, newSelection.from);
  const unchangedSuffixCount = Math.min(
    oldCount - oldSelection.to,
    newCount - newSelection.to,
  );
  const toOld = oldCount - unchangedSuffixCount;
  const toNew = newCount - unchangedSuffixCount;

  if (
    from < 0 ||
    from > toOld ||
    from > toNew ||
    toOld > oldCount ||
    toNew > newCount ||
    oldCount - toOld !== newCount - toNew
  ) {
    return null;
  }

  return { from, toOld, toNew };
}
