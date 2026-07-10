import fs from 'node:fs';
import path from 'node:path';

/**
 * Loads .env into process.env for tsx entrypoints (worker, jobs, seed) —
 * Next.js loads .env itself, plain node/tsx does not. Existing environment
 * variables always win; missing file is a no-op (Docker passes env directly).
 */
export function loadDotEnv(file = '.env'): void {
  try {
    const p = path.resolve(process.cwd(), file);
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || m[1].startsWith('#')) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch {
    // best-effort loader — a malformed .env should not crash the worker
  }
}
