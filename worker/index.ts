import cron from 'node-cron';
import { loadDotEnv } from '../src/lib/env';
import { fireAndForget, withJobRun } from '../src/lib/jobs';
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
import { syncAgentStacks } from '../src/lib/agent-stacks-sync';
import { runRadarEval } from '../src/lib/science/eval';
import { createWeeklyRadarDrop } from '../src/lib/batches';
import { runSweep } from '../src/lib/sweep';
import { runMediaPricingSync } from '../src/lib/ingest/media-pricing';
import { runKitEvidence } from '../src/lib/kits/evidence';
import { runKitPriceBackfill, runKitGrade } from '../src/lib/kits/grade';
import { runSourceReview } from '../src/lib/ingest/review';
import { runVerdictGrade } from '../src/lib/science/verdicts';

loadDotEnv();

console.log('[worker] Runelabs Radar worker starting');

// A rejected cron callback or a sync throw must never kill the worker —
// docker restart would re-run the boot-chain ingest/curate/embed on every
// crash loop. Log and keep the schedule alive.
process.on('unhandledRejection', (reason) => {
  console.error('[worker] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[worker] uncaughtException:', err);
});

const tasks = [
  // ingest → curate chained: fresh items get scored minutes after landing,
  // and curate can never race a slow ingest (the standalone :05 tick is gone)
  cron.schedule('*/15 * * * *', () =>
    fireAndForget(withJobRun('ingest', runIngest).then(() => withJobRun('curate', runCurate)), 'ingest→curate'),
  ),
  cron.schedule('20 * * * *', () => fireAndForget(withJobRun('embed', runEmbed), 'embed')),
  cron.schedule('30 5 * * *', () => fireAndForget(withJobRun('snapshot', runSnapshot), 'snapshot')),
  cron.schedule('45 5 * * *', () => fireAndForget(withJobRun('velocity', runVelocity), 'velocity')),
  cron.schedule('0 6 * * 1', () => fireAndForget(withJobRun('board', runBoardSync), 'board')),
  cron.schedule('15 6 * * *', () => fireAndForget(withJobRun('launches', runLaunches), 'launches')),
  cron.schedule('30 6 * * 1', () => fireAndForget(withJobRun('stacks', runStacks), 'stacks')),
  cron.schedule('40 6 * * *', () => fireAndForget(withJobRun('pain', runPain), 'pain')),
  cron.schedule('50 6 * * *', () => fireAndForget(withJobRun('science', runScience), 'science')),
  cron.schedule('0 7 * * *', () => fireAndForget(withJobRun('brief', runBrief), 'brief')),
  cron.schedule('0 8 * * *', () => fireAndForget(withJobRun('rescore', runRescore), 'rescore')),
  cron.schedule('10 7 * * *', () => fireAndForget(withJobRun('opportunities', runOpportunities), 'opportunities')),
  cron.schedule('20 7 * * *', () => fireAndForget(withJobRun('second-look', runSecondLook), 'second-look')),
  // weekly: audit the relevance gate's false-kill rate on a filtered sample
  cron.schedule('15 9 * * 0', () => fireAndForget(withJobRun('gate-audit', runGateAudit), 'gate-audit')),
  // weekly: first-party provider prices + open benchmarks (Phase 6 data foundations)
  cron.schedule('10 5 * * 2', () => fireAndForget(withJobRun('pricing', runPricingSync), 'pricing')),
  cron.schedule('20 4 * * 3', () => fireAndForget(withJobRun('openbench', runOpenBenchSync), 'openbench')),
  // daily: the public first-party dataset dump (Phase 10 free databook)
  cron.schedule('20 5 * * *', () => fireAndForget(withJobRun('dataset-dump', runDatasetDump), 'dataset-dump')),
  // weekly: coding-agent plan prices (manual seed, idempotent re-sync)
  cron.schedule('40 4 * * 4', () => fireAndForget(withJobRun('agent-plans', syncAgentPlans), 'agent-plans')),
  // daily: coding-agent IDE/harness/model landscape (Brave + LLM overlay)
  cron.schedule('45 4 * * *', () => fireAndForget(withJobRun('agent-stacks', syncAgentStacks), 'agent-stacks')),
  // weekly: micro-eval vs keyed models (Thu 04:30 — the series exists before
  // Friday's nightly science job blends it into the Radar Score)
  cron.schedule('30 4 * * 4', () => fireAndForget(withJobRun('radar-eval', runRadarEval), 'radar-eval')),
  // weekly: State of the Builder Market report (Sunday 08:00, after the brief)
  cron.schedule('0 8 * * 0', () => fireAndForget(withJobRun('weekly-report', runWeeklyReport), 'weekly-report')),
  // weekly Radar Batch drop (Monday 07:30 — after opportunities)
  cron.schedule('30 7 * * 1', () => fireAndForget(withJobRun('radar-batch', createWeeklyRadarDrop), 'radar-batch')),
  // daily: drop expired anonymous leads and stale usage-counter rows
  cron.schedule('20 3 * * *', () => fireAndForget(withJobRun('sweep', runSweep), 'sweep')),
  // media pricing: Tuesday 05:30, 20 min after the LLM pricing sync
  cron.schedule('30 5 * * 2', () => fireAndForget(withJobRun('media-pricing', runMediaPricingSync), 'media-pricing')),
  // evidence mining: daily 06:55, after pain mining (06:40) and science (06:50)
  cron.schedule('55 6 * * *', () => fireAndForget(withJobRun('kit-evidence', runKitEvidence), 'kit-evidence')),
  // price backfill + confidence grading: daily 07:05, after both feeders
  cron.schedule('5 7 * * *', () => fireAndForget(withJobRun('kit-grade', () => {
    const prices = runKitPriceBackfill();
    const grades = runKitGrade();
    return Promise.resolve({ ...prices, ...grades });
  }), 'kit-grade')),
  // daily: grade kit pick verdicts while flip history is fresh (after kit-grade)
  cron.schedule('15 7 * * *', () => fireAndForget(withJobRun('verdict-grade', runVerdictGrade), 'verdict-grade')),
  // weekly: source quality review over a 30-day window (Sunday 09:00)
  cron.schedule('0 9 * * 0', () => fireAndForget(withJobRun('source-review', runSourceReview), 'source-review')),
];

// Populate immediately on boot instead of waiting for the first tick
fireAndForget(
  withJobRun('ingest', runIngest)
    .then(() => withJobRun('curate', runCurate))
    .then(() => withJobRun('embed', runEmbed)),
  'boot-chain',
);

function shutdown() {
  console.log('[worker] shutting down');
  for (const t of tasks) t.stop();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
