export type Consent = { analytics: boolean; errors: boolean };
export const CONSENT_COOKIE = 'radar_consent';
export const CONSENT_MAX_AGE = 60 * 60 * 24 * 365;

export function parseConsent(raw: string | undefined): Consent | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v !== 'object' || v === null) return null;
    const rec = v as Record<string, unknown>;
    if (typeof rec.analytics !== 'boolean' || typeof rec.errors !== 'boolean') return null;
    return { analytics: rec.analytics, errors: rec.errors };
  } catch {
    return null;
  }
}

export function serializeConsent(c: Consent): string {
  return JSON.stringify({ analytics: c.analytics, errors: c.errors });
}

/**
 * Reads the consent cookie in the browser — the one copy used by both the
 * banner and the script loader. Null when unset, malformed, or off-DOM.
 */
export function readConsent(): Consent | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${CONSENT_COOKIE}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return parseConsent(decodeURIComponent(trimmed.slice(prefix.length)));
    }
  }
  return null;
}
