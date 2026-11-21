// BINDER 4-2: notes and manuscripts dragged from the binder onto the embedded
// Canvas become file cards. The binder's own pointer drag (WorkspaceSidebar)
// finds the Canvas under the pointer by this attribute and tells it with this
// event, as it does for 「この場面」's 「素材」 section (materialsDrop.ts).
export const CANVAS_FILE_DROP_ATTRIBUTE = "data-canvas-file-drop";
export const CANVAS_FILE_DROP_EVENT = "then-canvas-file-drop";

/** paths are the files' absolute paths; clientX/clientY is where they were dropped. */
export type CanvasFileDropDetail = { paths: string[]; clientX: number; clientY: number };
