// BINDER 3-3: notes dragged from the binder onto 「この場面」's 「素材」 section.
// The binder's own drag (WorkspaceSidebar) finds the section under the pointer
// by this attribute and tells it with this event, so App is not in between.
export const MATERIALS_DROP_ATTRIBUTE = "data-scene-materials-drop";
export const MATERIALS_DROP_EVENT = "then-materials-drop";

export type MaterialsDropDetail = { paths: string[] };
