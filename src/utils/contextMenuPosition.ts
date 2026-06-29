type MenuSize = {
  width: number;
  height: number;
  margin?: number;
};

const DEFAULT_MARGIN = 8;

export function getUiFontScale(): number {
  const shell = document.querySelector(".appShell");
  const rawScale = shell
    ? window.getComputedStyle(shell).getPropertyValue("--ui-font-scale")
    : "";
  const scale = Number.parseFloat(rawScale);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export function getScaledFixedMenuPosition(
  clientX: number,
  clientY: number,
  { width, height, margin = DEFAULT_MARGIN }: MenuSize,
): { left: number; top: number } {
  const scale = getUiFontScale();
  const viewportWidth = window.innerWidth / scale;
  const viewportHeight = window.innerHeight / scale;
  const maxLeft = Math.max(margin, viewportWidth - width - margin);
  const maxTop = Math.max(margin, viewportHeight - height - margin);

  return {
    left: Math.min(Math.max(margin, clientX / scale), maxLeft),
    top: Math.min(Math.max(margin, clientY / scale), maxTop),
  };
}
