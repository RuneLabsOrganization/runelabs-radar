/**
 * Backfill kit_picks from board_entries. Safe to re-run.
 *
 * Usage: npx tsx scripts/migrate-board-to-kits.ts
 */
import { loadDotEnv } from '../src/lib/env';
import { migrateBoardToKits } from '../src/lib/kits/migrate-board';

loadDotEnv();

const created = migrateBoardToKits();
console.log(`kit_picks created from board_entries: ${created}`);
