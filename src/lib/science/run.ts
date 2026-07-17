import { runAnomalies } from './anomaly';
import { runClustering } from './cluster';

/** Daily science job: clustering first (anomalies read cluster heat). */
export async function runScience(): Promise<{
  macros: number;
  subs: number;
  mapped: number;
  patterns: number;
}> {
  const clustering = await runClustering();
  const anomalies = await runAnomalies();
  return { ...clustering, ...anomalies };
}
