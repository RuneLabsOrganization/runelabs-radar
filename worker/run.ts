import { loadDotEnv } from '../src/lib/env';
import { withJobRun, type JobName } from '../src/lib/jobs';

loadDotEnv();
import { runIngest } from '../src/lib/ingest/ingest';
import { runCurate } from '../src/lib/curate/curate';
import { runBoardSync } from '../src/lib/board/sync';
import { runBrief } from '../src/lib/brief/brief';
import { runStacks } from '../src/lib/stacks/generate';
import { runSnapshot } from '../src/lib/snapshot';
import { runVelocity } from '../src/lib/velocity';
import { runLaunches } from '../src/lib/launches';
import { runEmbed } from '../src/lib/embed';
import { runPain } from '../src/lib/pain';

const jobs: Record<JobName, () => Promise<Record<string, unknown>>> = {
  ingest: runIngest,
  curate: runCurate,
  board: runBoardSync,
  brief: runBrief,
  stacks: runStacks,
  snapshot: runSnapshot,
  velocity: runVelocity,
  launches: runLaunches,
  embed: runEmbed,
  pain: runPain,
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
