import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '@/lib/config';
import { loadDotEnv } from '@/lib/env';

describe('config numeric caps', () => {
  const saved = { daily: process.env.MINIMAX_DAILY_CALL_CAP, curate: process.env.MINIMAX_CURATE_DAILY_CAP };
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    if (saved.daily === undefined) delete process.env.MINIMAX_DAILY_CALL_CAP;
    else process.env.MINIMAX_DAILY_CALL_CAP = saved.daily;
    if (saved.curate === undefined) delete process.env.MINIMAX_CURATE_DAILY_CAP;
    else process.env.MINIMAX_CURATE_DAILY_CAP = saved.curate;
  });

  it('a malformed MINIMAX_DAILY_CALL_CAP falls back to 500 with a warning instead of NaN', () => {
    process.env.MINIMAX_DAILY_CALL_CAP = 'abc';
    expect(config.minimaxDailyCallCap).toBe(500);
    expect(Number.isFinite(config.minimaxDailyCallCap)).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('MINIMAX_DAILY_CALL_CAP'));
  });

  it('a valid cap is respected without a warning', () => {
    process.env.MINIMAX_DAILY_CALL_CAP = '42';
    expect(config.minimaxDailyCallCap).toBe(42);
    expect(warn).not.toHaveBeenCalled();
  });

  it('an unset cap uses the default silently', () => {
    delete process.env.MINIMAX_DAILY_CALL_CAP;
    expect(config.minimaxDailyCallCap).toBe(500);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a malformed MINIMAX_CURATE_DAILY_CAP falls back to 400 with a warning', () => {
    process.env.MINIMAX_CURATE_DAILY_CAP = 'lots';
    expect(config.minimaxCurateDailyCap).toBe(400);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('MINIMAX_CURATE_DAILY_CAP'));
  });
});

describe('loadDotEnv parsing parity with dotenv', () => {
  const KEYS = [
    'DOTENV_T_PLAIN',
    'DOTENV_T_DQ',
    'DOTENV_T_SQ',
    'DOTENV_T_DQ_COMMENT',
    'DOTENV_T_SQ_COMMENT',
    'DOTENV_T_UNQUOTED_COMMENT',
    'DOTENV_T_HASH_NO_SPACE',
    'DOTENV_T_EMPTY',
    'DOTENV_T_PRESET',
  ];
  let file: string;

  beforeEach(() => {
    for (const k of KEYS) delete process.env[k];
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'radar-env-')), '.env');
  });

  afterEach(() => {
    for (const k of KEYS) delete process.env[k];
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it('parses quoted values with trailing comments the way Next does', () => {
    fs.writeFileSync(
      file,
      [
        'DOTENV_T_PLAIN=plain',
        'DOTENV_T_DQ="double quoted"',
        "DOTENV_T_SQ='single quoted'",
        'DOTENV_T_DQ_COMMENT="quoted" # trailing note',
        "DOTENV_T_SQ_COMMENT='quoted too' # trailing note",
        'DOTENV_T_UNQUOTED_COMMENT=value # trailing note',
        'DOTENV_T_HASH_NO_SPACE=a#b',
        'DOTENV_T_EMPTY=',
      ].join('\n'),
    );
    process.env.DOTENV_T_PRESET = 'keep';
    fs.appendFileSync(file, '\nDOTENV_T_PRESET=change');

    loadDotEnv(file);

    expect(process.env.DOTENV_T_PLAIN).toBe('plain');
    expect(process.env.DOTENV_T_DQ).toBe('double quoted');
    expect(process.env.DOTENV_T_SQ).toBe('single quoted');
    // the fix: quotes stripped AND comment dropped — was `"quoted" # trailing note` minus comment strip → `"quoted"`
    expect(process.env.DOTENV_T_DQ_COMMENT).toBe('quoted');
    expect(process.env.DOTENV_T_SQ_COMMENT).toBe('quoted too');
    expect(process.env.DOTENV_T_UNQUOTED_COMMENT).toBe('value');
    expect(process.env.DOTENV_T_HASH_NO_SPACE).toBe('a#b');
    expect(process.env.DOTENV_T_EMPTY).toBe('');
    expect(process.env.DOTENV_T_PRESET).toBe('keep'); // real environment always wins
  });
});
