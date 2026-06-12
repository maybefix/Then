# CodeMirror Japanese IME Bullet Input Investigation

## Context

After migrating the editor to CodeMirror 6 + Silkdown, Japanese IME input inside a bullet list shows a severe cursor/input corruption:

- English input does not reproduce the issue.
- Japanese input reproduces it when typing the first character in a bullet list item.
- The second character can be inserted at the end of the document instead of the current list item.
- The issue is not resolved by merely suppressing typewriter scroll during composition.

This document summarizes the investigation and the recommended approach for a future fix. It intentionally does not prescribe a completed implementation.

## Changes Rolled Back During Investigation

The following attempted fixes were rolled back because they did not resolve the root issue or were too speculative:

- Suppressing `onMarkdownChange` during IME composition.
- Syncing the editor body to React state only once on the next frame after `compositionend`.
- Preventing external `markdown` prop updates from being re-applied to the editor during composition.
- Applying WYSIWYG bullet rendering and hanging indent only to inactive list lines.

The following behavior may remain separately useful, but is not considered a root fix:

- Suppressing typewriter scroll / selection-driven scrolling while the editor is composing or while a non-empty selection is active.

## Findings From Web Research

### CodeMirror 6 + Chromium EditContext + Japanese IME

There are public reports of Japanese IME issues in CodeMirror 6 on Chromium-based browsers. A CodeMirror maintainer discussion points to Chromium's EditContext API as a likely cause and mentions disabling EditContext with:

```ts
EditorView.EDIT_CONTEXT = false;
```

Relevant sources:

- CodeMirror forum: <https://discuss.codemirror.net/t/issue-with-google-japanese-ime-cursor-position-in-v6/8810>
- Japanese write-up: <https://izanami.dev/post/61c1f7e6-7bf8-4fbb-983f-36677ada4d20>

This is highly relevant because Tauri on Windows uses WebView2, which is Chromium-based.

### CodeMirror Changelog Mentions Composition/EditContext Fixes

The CodeMirror changelog includes several fixes around EditContext, composition, Chrome cursor behavior, and document corruption. This indicates that IME handling is version-sensitive.

Relevant source:

- CodeMirror changelog: <https://codemirror.com/docs/changelog/>

The project currently depends on `@codemirror/view` via a caret range. Before implementing a fix, confirm the exact installed version from `package-lock.json`.

### Decoration.replace and Atomic Ranges Affect Cursor Behavior

Silkdown's bullet rendering uses `Decoration.replace` and atomic ranges around list markers. CodeMirror documentation describes replacing decorations as hiding document ranges, and forum discussion confirms `atomicRanges` are used to make cursor motion skip such ranges.

Relevant sources:

- CodeMirror decorations example: <https://codemirror.net/examples/decoration/>
- Atomic ranges discussion: <https://discuss.codemirror.net/t/cursor-to-skip-decoration-replace/3902>

This does not prove the list marker decoration is the root cause, but it is a plausible amplifier when combined with IME composition anchored near a replaced range.

### Controlled React-Style Value Sync Can Cause Cursor Jumps

The editor wrapper has a controlled-like data path:

1. CodeMirror emits document changes.
2. React state is updated.
3. The updated `markdown` prop can be re-applied to CodeMirror.

React controlled inputs are known to suffer cursor jumps when external value updates are not carefully separated from user input. This is a weaker hypothesis than the EditContext issue because the observed bug is Japanese IME-specific.

Relevant source:

- React issue: <https://github.com/facebook/react/issues/955>

## Recommended Fix Strategy

### Step 1: Confirm Installed CodeMirror Version

Inspect `package-lock.json` for the exact `@codemirror/view` version. Do not rely on the caret range in `package.json`.

Goal:

- Establish whether the app is on a version known to include EditContext behavior changes.
- Decide whether version pinning or updating should be part of the fix.

### Step 2: Test EditContext Disablement First

Temporarily disable EditContext before creating any `EditorView` instance.

Expected validation:

- Reproduce the bug with Japanese IME in a bullet list before the change.
- Apply only EditContext disablement.
- Retest the exact same Japanese IME input sequence.

If this fixes the bug, it is the strongest candidate for the production fix.

Tradeoffs:

- This is a global CodeMirror behavior change.
- It should be verified on Windows WebView2 because the app is distributed as a Tauri desktop app.
- It may affect future browser-native editing behavior, but it is a focused workaround for an upstream Chromium/CodeMirror IME path.

### Step 3: If EditContext Is Not Sufficient, Isolate List Decorations

If the bug still reproduces, test whether list marker rendering is involved.

Suggested isolation order:

1. Disable only `Decoration.replace` for `ListMark`.
2. Keep list line CSS/hanging indent enabled.
3. If the bug disappears, redesign list markers away from replacing the source marker range during active editing.

Potential future designs:

- Use `Decoration.mark` to style source list markers instead of replacing them.
- Use a widget that does not overlap the source marker range.
- Hide list source markers only when the selection is not on the list item and the line is not composing.
- Avoid putting list marker ranges into `atomicRanges` while IME composition may start near the marker.

### Step 4: Only Then Inspect React Synchronization

If EditContext disablement and list decoration isolation do not explain the issue, instrument the controlled-like synchronization path.

What to log:

- `update.docChanged`
- `update.selectionSet`
- `update.view.composing`
- current selection head/from/to
- whether the prop-driven full-document dispatch runs
- whether the document change is local input or external state replacement

Only after logs show React synchronization interfering with IME input should the wrapper be redesigned.

Potential future designs:

- Treat CodeMirror as the source of truth while a document is open.
- Store the latest editor text in a ref and debounce persistence/state updates.
- Apply external `markdown` prop updates only when switching documents or when the incoming value is known to be external.
- Avoid full-document replacement while the editor is focused unless it is a deliberate document load.

## Recommended Order Of Operations

1. Reproduce and write down an exact Japanese IME input sequence.
2. Confirm installed `@codemirror/view` version.
3. Test `EditorView.EDIT_CONTEXT = false` as the only behavior change.
4. If fixed, keep the fix minimal and document why it exists.
5. If not fixed, disable list marker replacement only and retest.
6. If still not fixed, add temporary logs around editor updates and prop-driven dispatches.
7. Remove temporary logs before shipping.

## Current Best Hypothesis

The strongest current hypothesis is:

> Japanese IME composition in Windows WebView2/Chromium is interacting badly with CodeMirror 6's EditContext path, and the issue is amplified when composition starts near Silkdown list marker replacement decorations.

The first implementation to test should therefore be EditContext disablement, not more composition-time React synchronization changes.
