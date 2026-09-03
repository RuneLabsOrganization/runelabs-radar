import { loadDotEnv } from '../src/lib/env';
import { withJobRun, type JobName } from '../src/lib/jobs';

loadDotEnv();

// Same containment as the daemon (worker/index.ts): a stray rejection or sync
// throw must surface with a clear message instead of an opaque exit code. The
// withJobRun chain below owns the exit code — these only keep Node's default
// crash handler from firing first.
process.on('unhandledRejection', (reason) => {
  console.error('[job] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[job] uncaughtException:', err);
});

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
import { runOppRescore } from '../src/lib/opportunities/rescore';
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

const jobs: Record<JobName, () => Promise<Record<string, unknown>>> = {
  ingest: runIngest,
  curate: runCurate,
  'gate-audit': runGateAudit,
  board: runBoardSync,
  brief: runBrief,
  rescore: runRescore,
  stacks: runStacks,
  snapshot: runSnapshot,
  velocity: runVelocity,
  launches: runLaunches,
  embed: runEmbed,
  pain: runPain,
  science: runScience,
  opportunities: runOpportunities,
  'opp-rescore': runOppRescore,
  'second-look': runSecondLook,
  pricing: runPricingSync,
  openbench: runOpenBenchSync,
  'dataset-dump': runDatasetDump,
  'weekly-report': runWeeklyReport,
  'agent-plans': syncAgentPlans,
  'agent-stacks': syncAgentStacks,
  'radar-eval': runRadarEval,
  'radar-batch': createWeeklyRadarDrop,
  sweep: runSweep,
  'media-pricing': runMediaPricingSync,
  'kit-evidence': runKitEvidence,
  // separate run rows: a pricing failure must not block (or masquerade as) grading
  'kit-prices': () => Promise.resolve(runKitPriceBackfill()),
  'kit-grade': () => Promise.resolve(runKitGrade()),
  'source-review': runSourceReview,
  'verdict-grade': runVerdictGrade,
};

const name = process.argv[2] as JobName | undefined;
if (!name || !(name in jobs)) {
  console.error(`Usage: npm run job -- <${Object.keys(jobs).join('|')}>`);
  process.exit(1);
}

withJobRun(name, jobs[name])
  .then((stats) => {
    console.log(`[job:${name}]`, stats ?? 'FAILED (see job_runs table)');
    process.exit(stats ? 0 : 1);
  })
  // withJobRun can reject before its internal try/catch (first-call getDb()
  // migrations, SQLITE_BUSY past busy_timeout) — an unhandled rejection would
  // exit with a confusing code and no message
  .catch((e: unknown) => {
    console.error(`[job:${name}] crashed before the run could be recorded:`, e);
    process.exit(1);
  });
