/**
 * Board-history change strings come from the proposal applier as raw field
 * diffs: "bestOverall: A -> B; costNote: X -> Y". This formats them for
 * humans: one entry per field, verbose cost-note dumps summarized.
 */

export interface FieldChange {
  field: string;
  text: string;
}

const FIELD_LABELS: Record<string, string> = {
  bestOverall: 'best overall',
  bestValue: 'best value',
  cheapestViable: 'cheapest viable',
  costNote: 'cost note',
  runelabsVerdict: 'verdict',
};

function clip(s: string, max = 56): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** True when the change string carries no information ("no field changes"). */
export function isNoopChange(change: string): boolean {
  return change.trim().toLowerCase().replace(/[^a-z]/g, '') === 'nofieldchanges';
}

/**
 * Splits a raw diff string into per-field rows. costNote/verdict diffs are
 * summarized ("cost note updated") — the full values are unreadable inline.
 * Unparseable segments pass through clipped. Empty input → [].
 */
export function formatBoardChange(change: string): FieldChange[] {
  if (!change || isNoopChange(change)) return [];
  const out: FieldChange[] = [];
  // split only at field boundaries — costNote values themselves contain '; '
  const segments = change.split(
    /;\s*(?=(?:bestOverall|bestValue|cheapestViable|costNote|runelabsVerdict)\s*:)/,
  );
  for (const seg of segments) {
    const m = /^([a-zA-Z]+):\s*(.*)$/.exec(seg.trim());
    if (!m) {
      if (seg.trim()) out.push({ field: 'note', text: clip(seg.trim()) });
      continue;
    }
    const [, field, rest] = m;
    const label = FIELD_LABELS[field] ?? field;
    if (field === 'costNote' || field === 'runelabsVerdict') {
      out.push({ field: label, text: 'updated' });
      continue;
    }
    const arrow = rest.indexOf(' -> ');
    if (arrow === -1) {
      out.push({ field: label, text: clip(rest) });
    } else {
      out.push({ field: label, text: `${clip(rest.slice(0, arrow))} → ${clip(rest.slice(arrow + 4))}` });
    }
  }
  return out;
}
