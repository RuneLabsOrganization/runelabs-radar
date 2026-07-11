import cron from 'node-cron';
import { loadDotEnv } from '../src/lib/env';
import { withJobRun } from '../src/lib/jobs';
import { runIngest } from '../src/lib/ingest/ingest';
import { runCurate } from '../src/lib/curate/curate';
import { runBoardSync } from '../src/lib/board/sync';
import { runBrief } from '../src/lib/brief/brief';
import { runStacks } from '../src/lib/stacks/generate';

loadDotEnv();

console.log('[worker] Runelabs Radar worker starting');

const tasks = [
  cron.schedule('*/30 * * * *', () => void withJobRun('ingest', runIngest)),
  cron.schedule('5 * * * *', () => void withJobRun('curate', runCurate)),
  cron.schedule('0 6 * * 1', () => void withJobRun('board', runBoardSync)),
  cron.schedule('30 6 * * 1', () => void withJobRun('stacks', runStacks)),
  cron.schedule('0 7 * * *', () => void withJobRun('brief', runBrief)),
];

// Populate immediately on boot instead of waiting for the first tick
void withJobRun('ingest', runIngest).then(() => withJobRun('curate', runCurate));

function shutdown() {
  console.log('[worker] shutting down');
  for (const t of tasks) t.stop();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
