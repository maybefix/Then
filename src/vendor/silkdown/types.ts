export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type InlineNodeName = "StrongEmphasis" | "Emphasis" | "InlineCode" | "Strikethrough";

export type ToggleInlineNodeName = Extract<
  InlineNodeName,
  "StrongEmphasis" | "Emphasis" | "InlineCode"
>;
