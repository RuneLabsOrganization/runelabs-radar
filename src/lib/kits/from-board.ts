/**
 * board_entries -> kit_picks addressing.
 *
 * The first six kit categories are deliberately named identically to the six
 * story DOMAINS, so a board row maps across by name. Only the task differs,
 * and only for one cell — reuse the rename map rather than duplicating it.
 */
import { isKitCell, type KitTier } from './grid';
import { TASK_RENAMES } from './migrate-board';

export const TIER_BY_FIELD = {
  bestOverall: 'best',
  bestValue: 'value',
  cheapestViable: 'cheapest',
} as const satisfies Record<string, KitTier>;

export type BoardField = keyof typeof TIER_BY_FIELD;

export interface KitCellRef {
  category: string;
  task: string;
}

export function boardCellToKitCell(domain: string, task: string): KitCellRef | null {
  const mapped = TASK_RENAMES[task] ?? task;
  if (!isKitCell(domain, mapped)) return null;
  return { category: domain, task: mapped };
}
