import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fireAndForget } from '@/lib/jobs';

/** Let the .catch microtask attached by fireAndForget run. */
function flushMicrotasks(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe('fireAndForget', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('contains a rejecting promise: does not throw, logs, settles', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('boom');
    expect(() => fireAndForget(Promise.reject(boom), 'test-job')).not.toThrow();
    await flushMicrotasks();
    expect(err).toHaveBeenCalledWith('[worker] fire-and-forget "test-job" rejected:', boom);
  });

  it('logs nothing when the promise resolves', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    fireAndForget(Promise.resolve({ ok: true }), 'test-job');
    await flushMicrotasks();
    expect(err).not.toHaveBeenCalled();
  });
});

// The daemon must never die from a stray rejection/exception — docker restart
// would re-run the boot-chain ingest/curate/embed on every crash loop. Both
// worker entries register log-only process handlers (importing them would
// start the schedule, so this is a source-level guard).
describe('worker entry containment', () => {
  it.each(['../worker/index.ts', '../worker/run.ts'])('%s registers the process handlers', (file) => {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    expect(src).toContain("process.on('unhandledRejection'");
    expect(src).toContain("process.on('uncaughtException'");
  });

  it('worker/index.ts routes every cron callback through fireAndForget', () => {
    const src = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
    const schedules = src.match(/cron\.schedule\(/g) ?? [];
    const wrapped = src.match(/\(\) =>\s*fireAndForget\(/g) ?? [];
    expect(schedules.length).toBeGreaterThan(0);
    expect(wrapped).toHaveLength(schedules.length);
  });
});
