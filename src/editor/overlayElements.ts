/** Keep overlay nodes alive while scrolling. Replacing every label on every
 * frame triggers selector invalidation and style/layout work across the app. */
export function syncOverlayElements(layer: HTMLElement, fragment: DocumentFragment) {
  const key = (element: Element) => element.classList.contains("activeVisualLineHighlight")
    ? "active"
    : element.classList.contains("visibleLineNumber")
      ? `number:${(element as HTMLElement).dataset.visualLineNumber}`
      : element.classList.contains("manuscriptPageBoundary")
        ? `page:${(element as HTMLElement).dataset.manuscriptPage}`
        : `break:${(element as HTMLElement).dataset.blockIndex}`;
  const wanted = Array.from(fragment.children);
  const keys = new Set(wanted.map(key));
  const previous = new Map<string, Element>();
  for (const element of Array.from(layer.children)) {
    const id = key(element);
    if (keys.has(id)) previous.set(id, element);
    else element.remove();
  }
  let cursor = layer.firstElementChild;
  for (const next of wanted) {
    const current = previous.get(key(next)) ?? next;
    if (current !== next) {
      for (const attribute of Array.from(next.attributes)) {
        if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
      }
      if (current.textContent !== next.textContent) current.textContent = next.textContent;
    }
    if (current !== cursor) layer.insertBefore(current, cursor);
    cursor = current.nextElementSibling;
  }
}
