/**
 * The ONE definition of "enough signal to scout": the opportunity engine
 * (engine.ts) and the scout tool (mcp/tools/scout.ts) must agree on the
 * threshold or the same radar state can be "too thin" on one path and
 * scoutable on the other.
 *
 * Pure module: no DB/LLM imports.
 */

/** Minimum signal count before proposal/scout runs; below this the scope is too thin. */
export const MIN_SIGNALS = 5;

/** Lookback window the engine counts demand signals over, in days. */
export const SIGNAL_LOOKBACK_DAYS = 14;
