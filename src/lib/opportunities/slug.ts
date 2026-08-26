/**
 * Stable kebab identity shared by the composer (Rung 0) and the daily engine.
 * Lives in its own module so get_leads can compose without loading chatJSON.
 */
export function normalizeSlug(s: string): string {
  // trailing strip AFTER the slice keeps this idempotent — a stored 60-char
  // slug ending at a hyphen must re-normalize to itself, or day-2 refreshes
  // silently duplicate the opportunity
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}
