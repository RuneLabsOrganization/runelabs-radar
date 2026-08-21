import { loadDotEnv } from '../src/lib/env';
import { withJobRun, type JobName } from '../src/lib/jobs';

loadDotEnv();
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
import { syncAgentStacks } from '../src/lib/agent-stacks';
import { runRadarEval } from '../src/lib/science/eval';

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
};

const name = process.argv[2] as JobName | undefined;
if (!name || !(name in jobs)) {
  console.error(`Usage: npm run job -- <${Object.keys(jobs).join('|')}>`);
  process.exit(1);
}

withJobRun(name, jobs[name]).then((stats) => {
  console.log(`[job:${name}]`, stats ?? 'FAILED (see job_runs table)');
  process.exit(stats ? 0 : 1);
});
