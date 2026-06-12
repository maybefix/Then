import type { SyntaxNode } from "@lezer/common";

export function* children(parent: SyntaxNode): Generator<SyntaxNode> {
  let child = parent.firstChild;
  while (child) {
    yield child;
    child = child.nextSibling;
  }
}

export function firstChildNamed(parent: SyntaxNode, name: string): SyntaxNode | null {
  for (const child of children(parent)) {
    if (child.name === name) return child;
  }
  return null;
}

export function lastChildNamed(parent: SyntaxNode, name: string): SyntaxNode | null {
  let last: SyntaxNode | null = null;
  for (const child of children(parent)) {
    if (child.name === name) last = child;
  }
  return last;
}
