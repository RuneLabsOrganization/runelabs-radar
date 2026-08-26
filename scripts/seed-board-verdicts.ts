/**
 * Publish the hand-curated Best Right Now verdicts onto empty board cells.
 *
 * Idempotent and non-destructive — only NULL columns are filled, so a verdict
 * edited in the admin UI is never overwritten.
 *
 * Usage: npx tsx scripts/seed-board-verdicts.ts
 */
import { loadDotEnv } from '../src/lib/env';
import { applySeedVerdicts, BOARD_VERDICTS_REVIEWED_AT } from '../src/lib/board/verdicts';

loadDotEnv();

const touched = applySeedVerdicts();
console.log(`Board cells filled from the ${BOARD_VERDICTS_REVIEWED_AT} review: ${touched}`);
