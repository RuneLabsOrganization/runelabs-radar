import { loadDotEnv } from '../src/lib/env';
import { withJobRun, type JobName } from '../src/lib/jobs';

loadDotEnv();
import { runIngest } from '../src/lib/ingest/ingest';
import { runCurate } from '../src/lib/curate/curate';
import { runBoardSync } from '../src/lib/board/sync';
import { runBrief } from '../src/lib/brief/brief';

const jobs: Record<JobName, () => Promise<Record<string, unknown>>> = {
  ingest: runIngest,
  curate: runCurate,
  board: runBoardSync,
  brief: runBrief,
};

const name = process.argv[2] as JobName | undefined;
if (!name || !(name in jobs)) {
  console.error('Usage: npm run job -- <ingest|curate|board|brief>');
  process.exit(1);
}

withJobRun(name, jobs[name]).then((stats) => {
  console.log(`[job:${name}]`, stats ?? 'FAILED (see job_runs table)');
  process.exit(stats ? 0 : 1);
});
