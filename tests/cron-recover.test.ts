import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { schedule } from '@/lib/cron';

/** Busy-waits — what a synchronous better-sqlite3 job does to the event loop. */
function blockFor(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin */
  }
}

describe('schedule() — a blocked event loop must not drop a cron tick', () => {
  it('fires a tick whose second passed while the loop was blocked', async () => {
    // let node-cron's first 1s check run, then target a second we will block through
    const target = new Date(Date.now() + 2000);
    let fired = 0;
    const task = schedule(`${target.getSeconds()} * * * * *`, () => fired++);
    try {
      await new Promise((r) => setTimeout(r, Math.max(0, target.getTime() - Date.now() - 400)));
      blockFor(1800); // straddles the target second
      await new Promise((r) => setTimeout(r, 1500));
      expect(fired).toBe(1); // default node-cron options: 0 — the tick is lost
    } finally {
      task.stop();
    }
  }, 10_000);

  it('the worker schedules everything through it', () => {
    const src = readFileSync('worker/index.ts', 'utf8');
    expect(src).not.toMatch(/cron\.schedule\(/);
    expect(src).toMatch(/schedule\('0 8 \* \* 0'/);
  });
});
