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
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m || m[1].startsWith('#')) continue;
      let v = m[2];
      // dotenv/Next semantics: a quoted value ends at its matching close
      // quote and anything after it (e.g. an inline comment) is dropped; an
      // unquoted value stops at a whitespace-led inline comment. Handling
      // comments only in the unquoted branch left `FOO="bar" # note` parsing
      // differently from Next's loader — quotes included, comment kept.
      const dq = /^"((?:\\.|[^"\\])*)"/.exec(v);
      const sq = dq ? null : /^'((?:\\.|[^'\\])*)'/.exec(v);
      if (dq) {
        v = dq[1];
      } else if (sq) {
        v = sq[1];
      } else {
        v = v.replace(/\s+#.*$/, '').trim();
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch {
    // best-effort loader — a malformed .env should not crash the worker
  }
}
