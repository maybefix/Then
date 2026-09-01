const MODIFIERS = new Set(["mod", "ctrl", "cmd", "shift", "alt", "option"]);

export function isValidThenPluginKeybinding(binding: string): boolean {
  const parts = binding
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length < 2) return false;
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  return (
    Boolean(key) &&
    !MODIFIERS.has(key) &&
    modifiers.every((part) => MODIFIERS.has(part)) &&
    modifiers.some((part) => part === "mod" || part === "ctrl" || part === "cmd")
  );
}

export function matchesThenPluginKeybinding(event: KeyboardEvent, binding: string): boolean {
  if (!isValidThenPluginKeybinding(binding)) return false;
  const parts = binding
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return false;
  const key = parts[parts.length - 1];
  const wantsMod = parts.includes("mod") || parts.includes("ctrl") || parts.includes("cmd");
  const wantsShift = parts.includes("shift");
  const wantsAlt = parts.includes("alt") || parts.includes("option");
  return (
    event.key.toLowerCase() === key &&
    (event.ctrlKey || event.metaKey) === wantsMod &&
    event.shiftKey === wantsShift &&
    event.altKey === wantsAlt
  );
}
