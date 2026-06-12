/**
 * Default URL allowlist. Returns a safe URL string when accepted, or null when blocked.
 *
 * Accepted by default:
 *  - http:// and https://
 *  - data:image/*
 *  - relative URLs without an explicit scheme
 *
 * Blocked: protocol-relative URLs and explicit schemes other than http(s).
 *
 * Consumers can pass their own predicate to silkdown() to override.
 */
export type UrlPolicy = (url: string) => string | null;

const DATA_IMAGE_RE = /^data:image\/[a-z0-9+-]+(;[a-z0-9-]+=[a-z0-9-]+)*(;base64)?,/i;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

export const defaultUrlPolicy: UrlPolicy = (url) => {
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) return trimmed;
  if (DATA_IMAGE_RE.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return null;

  // No explicit scheme means the URL is relative to the current document.
  if (!SCHEME_RE.test(trimmed)) return trimmed;

  return null;
};

export function safeUrl(url: string, policy: UrlPolicy = defaultUrlPolicy): string | null {
  return policy(url);
}
