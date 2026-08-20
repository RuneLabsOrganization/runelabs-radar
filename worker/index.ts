import cron from 'node-cron';
import { loadDotEnv } from '../src/lib/env';
import { withJobRun } from '../src/lib/jobs';
import { runIngest } from '../src/lib/ingest/ingest';
import { runCurate } from '../src/lib/curate/curate';
import { runGateAudit } from '../src/lib/curate/gate-audit';
import { runBoardSync } from '../src/lib/board/sync';
import { runBrief } from '../src/lib/brief/brief';
import { runRescore } from '../src/lib/science/hindsight';
import { runStacks } from '../src/lib/stacks/generate';
import { runSnapshot } from '../src/lib/snapshot';
import { runVelocity } from '../src/lib/velocity';
import { runLaunches } from '../src/lib/launches';
import { runEmbed } from '../src/lib/embed';
import { runPain } from '../src/lib/pain';
import { runScience } from '../src/lib/science/run';
import { runOpportunities } from '../src/lib/opportunities/engine';
import { runSecondLook } from '../src/lib/science/second-look';
import { runPricingSync } from '../src/lib/ingest/pricing';
import { runOpenBenchSync } from '../src/lib/ingest/openbench';
import { runDatasetDump } from '../src/lib/dump';
import { runWeeklyReport } from '../src/lib/brief/weekly';
import { syncAgentPlans } from '../src/lib/agent-plans';

loadDotEnv();

console.log('[worker] Runelabs Radar worker starting');

const tasks = [
  // ingest → curate chained: fresh items get scored minutes after landing,
  // and curate can never race a slow ingest (the standalone :05 tick is gone)
  cron.schedule('*/15 * * * *', () =>
    void withJobRun('ingest', runIngest).then(() => withJobRun('curate', runCurate)),
  ),
  cron.schedule('20 * * * *', () => void withJobRun('embed', runEmbed)),
  cron.schedule('30 5 * * *', () => void withJobRun('snapshot', runSnapshot)),
  cron.schedule('45 5 * * *', () => void withJobRun('velocity', runVelocity)),
  cron.schedule('0 6 * * 1', () => void withJobRun('board', runBoardSync)),
  cron.schedule('15 6 * * *', () => void withJobRun('launches', runLaunches)),
  cron.schedule('30 6 * * 1', () => void withJobRun('stacks', runStacks)),
  cron.schedule('40 6 * * *', () => void withJobRun('pain', runPain)),
  cron.schedule('50 6 * * *', () => void withJobRun('science', runScience)),
  cron.schedule('0 7 * * *', () => void withJobRun('brief', runBrief)),
  cron.schedule('0 8 * * *', () => void withJobRun('rescore', runRescore)),
  cron.schedule('10 7 * * *', () => void withJobRun('opportunities', runOpportunities)),
  cron.schedule('20 7 * * *', () => void withJobRun('second-look', runSecondLook)),
  // weekly: audit the relevance gate's false-kill rate on a filtered sample
  cron.schedule('15 9 * * 0', () => void withJobRun('gate-audit', runGateAudit)),
  // weekly: first-party provider prices + open benchmarks (Phase 6 data foundations)
  cron.schedule('10 5 * * 2', () => void withJobRun('pricing', runPricingSync)),
  cron.schedule('20 4 * * 3', () => void withJobRun('openbench', runOpenBenchSync)),
  // daily: the public first-party dataset dump (Phase 10 free databook)
  cron.schedule('20 5 * * *', () => void withJobRun('dataset-dump', runDatasetDump)),
  // weekly: coding-agent plan prices (manual seed, idempotent re-sync)
  cron.schedule('40 4 * * 4', () => void withJobRun('agent-plans', syncAgentPlans)),
  // weekly: State of the Builder Market report (Sunday 08:00, after the brief)
  cron.schedule('0 8 * * 0', () => void withJobRun('weekly-report', runWeeklyReport)),
];

// Populate immediately on boot instead of waiting for the first tick
void withJobRun('ingest', runIngest)
  .then(() => withJobRun('curate', runCurate))
  .then(() => withJobRun('embed', runEmbed));

function shutdown() {
  console.log('[worker] shutting down');
  for (const t of tasks) t.stop();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
