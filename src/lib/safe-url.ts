/**
 * Feed- and LLM-supplied URLs are untrusted input: only http(s) URLs may be
 * rendered into an <a href> (blocks javascript:, data:, vbscript:, etc.).
 */
export function safeHttpUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  const t = u.trim();
  return /^https?:\/\//i.test(t) ? t : null;
}
