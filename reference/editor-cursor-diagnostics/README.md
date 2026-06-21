# Editor cursor diagnostics

This directory archives the temporary diagnostics used to identify the
Tauri-only cursor jump. It is outside `src`, so it is not included in the
production TypeScript build or application bundle.

To restore diagnostics:

1. Copy `editorDiagnostics.ts` under `src/editor/diagnostics`.
2. Create one diagnostics instance for the active editor.
3. Record `beforeinput`, selected `keydown`, `paste`, composition lifecycle,
   ProseMirror transactions, editor create/destroy, and prop synchronization.
4. For a prop/document mismatch, record lengths, hashes, common prefix/suffix
   lengths, selection offsets, focus state, composition state, and revision.
   Do not record document text.
5. Connect `attachCopyShortcut()` to the application clipboard/toast handler.

The shortcut used during investigation was `Ctrl + Alt + Shift + D`.
