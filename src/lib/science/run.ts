import { runAnomalies } from './anomaly';
import { runClustering } from './cluster';
import { computeRadarScores, rollupModelSpeed } from './score';
import { drainLlmUsageStats } from '../llm/minimax';

/** Daily science job: clustering first (anomalies read cluster heat). */
export async function runScience(): Promise<{
  macros: number;
  subs: number;
  mapped: number;
  patterns: number;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  speedModels: number;
  radarScored: number;
}> {
  const clustering = await runClustering();
  const anomalies = await runAnomalies();
  // §6e LAST: speed rollup from llm_calls, then the Radar Score composite
  // (reads the fresh radar-speed series) + AA divergence logging
  const speed = rollupModelSpeed();
  const scores = computeRadarScores();
  return {
    ...clustering,
    ...anomalies,
    speedModels: speed.models,
    radarScored: scores.scored,
    ...drainLlmUsageStats(),
  };
}
