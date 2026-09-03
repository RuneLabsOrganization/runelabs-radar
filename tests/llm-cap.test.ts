import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { openDb, rawSqlite, type Db } from '@/lib/db';
import { llmUsage } from '@/lib/db/schema';
import { _setFetch, chatJSON, LlmError, tryConsumeDailyCall } from '@/lib/llm/minimax';
import { useTestDb } from './helpers/db';

const savedEnv = { mini: process.env.MINIMAX_API_KEY, cap: process.env.MINIMAX_DAILY_CALL_CAP };

beforeEach(() => {
  process.env.MINIMAX_API_KEY = 'test-key';
  _setFetch((async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }], usage: {} }),
  })) as unknown as typeof fetch);
});

afterEach(() => {
  _setFetch(globalThis.fetch);
  if (savedEnv.mini === undefined) delete process.env.MINIMAX_API_KEY;
  else process.env.MINIMAX_API_KEY = savedEnv.mini;
  if (savedEnv.cap === undefined) delete process.env.MINIMAX_DAILY_CALL_CAP;
  else process.env.MINIMAX_DAILY_CALL_CAP = savedEnv.cap;
});

describe('daily LLM call cap', () => {
  it('allows exactly cap calls through chatJSON, then refuses', async () => {
    const db = useTestDb();
    process.env.MINIMAX_DAILY_CALL_CAP = '2';
    const date = new Date().toISOString().slice(0, 10);

    await chatJSON('s', 'u');
    await chatJSON('s', 'u');
    await expect(chatJSON('s', 'u')).rejects.toThrow(LlmError);
    await expect(chatJSON('s', 'u')).rejects.toThrow(/Daily LLM call cap/);

    expect(db.select().from(llmUsage).where(eq(llmUsage.date, date)).get()!.calls).toBe(2);
  });

  it('two writers on the same SQLite file consume the budget exactly once', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-cap-'));
    let dbA: Db | null = null;
    let dbB: Db | null = null;
    try {
      const file = path.join(dir, 'cap.db');
      dbA = openDb(file);
      dbB = openDb(file); // the "other process" sharing the file
      const date = '2026-08-24';

      // interleaved writers, cap 2: each successful consume is visible to the other
      expect(tryConsumeDailyCall(dbA, date, 2)).toBe(1);
      expect(tryConsumeDailyCall(dbB, date, 2)).toBe(2);
      expect(tryConsumeDailyCall(dbA, date, 2)).toBeNull();
      expect(tryConsumeDailyCall(dbB, date, 2)).toBeNull();
      expect(dbB.select().from(llmUsage).where(eq(llmUsage.date, date)).get()!.calls).toBe(2);
    } finally {
      if (dbA) rawSqlite(dbA).close();
      if (dbB) rawSqlite(dbB).close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
