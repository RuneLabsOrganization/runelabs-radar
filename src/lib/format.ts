/**
 * Shared number formatting — one implementation behind every compact figure,
 * percent, and duration in the product. The /trust methodology promises
 * "round down, never up", so compact formatters FLOOR by default.
 */

/**
 * Compact magnitude: 999 → "999", 1234 → "1.2k", 1_999_999 → "1.9M" (floored —
 * rounding up would overstate). Sub-1000 values keep up to 2 decimals with
 * binary-float noise trimmed.
 */
export function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}${trim(Math.floor((abs / 1e9) * 10) / 10)}B`;
  if (abs >= 1e6) return `${sign}${trim(Math.floor((abs / 1e6) * 10) / 10)}M`;
  if (abs >= 1e3) return `${sign}${trim(Math.floor((abs / 1e3) * 10) / 10)}k`;
  return `${sign}${trim(Number(abs.toFixed(2)))}`;
}

function trim(v: number): string {
  return String(Number(v.toFixed(2)));
}

/** Compact USD: $900 / $12.5k / $1.2M / -$5. Negative sign leads the $. */
export function fmtUsdCompact(usd: number): string {
  if (usd < 0) return `-${fmtUsdCompact(-usd)}`;
  return `$${fmtCompact(usd)}`;
}

/**
 * Signed percent with a single precision regime (|v|≥10 → 0dp, else 1dp).
 * `null` means "no data" and must never render as if it were 0 — callers
 * render "—" (or omit the chip) so an empty denominator can't masquerade as
 * "no change".
 */
export function fmtPct(v: number | null): string | null {
  if (v === null || !Number.isFinite(v)) return null;
  const abs = Math.abs(v);
  const digits = abs >= 10 ? 0 : 1;
  const rounded = Number(v.toFixed(digits));
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

/** One duration regime for every jobs/usage surface: 900ms / 65.0s / 3.2m / 1.5h. */
export function fmtDurationMs(ms: number): string {
  if (ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 90_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 90 * 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}
