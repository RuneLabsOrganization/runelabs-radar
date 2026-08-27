import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP_DIR = fileURLToPath(new URL('../src/app/app/', import.meta.url));
const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url));

/** Every `page.tsx` under the authenticated app shell. */
function pageFiles(dir: string = APP_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(full);
    return entry.name === 'page.tsx' ? [full] : [];
  });
}

/** Every `.tsx` under src/, for rules that also cover the marketing shell. */
function tsxFiles(dir: string = SRC_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

const rel = (p: string) => p.slice(SRC_DIR.length).replace(/\\/g, '/');

/**
 * The inline header trio: a readout div immediately followed by the page h1.
 * Deliberately narrow — a standalone `readout` label inside a card is fine.
 */
const INLINE_HEADER = /<div className="readout[^"]*">[\s\S]{0,160}?<\/div>\s*<h1 className="type-h1/;

/**
 * Detail routes (`[persona]`, `[slug]`, `[id]`) are exempt: their headers carry
 * back links, badges and dynamic titles, so they compose from the same
 * primitives rather than from the fixed PageHeader shape. The rule is for the
 * hub and leaf pages a first-time visitor lands on.
 */
const hubAndLeafPages = () => pageFiles().filter((p) => !p.includes('['));

describe('app shell chrome', () => {
  it('states page identity through PageHeader, not a hand-rolled trio', () => {
    const offenders = hubAndLeafPages()
      .filter((p) => INLINE_HEADER.test(readFileSync(p, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('right-aligns numeric table headers with .num, which .table th cannot override', () => {
    // `.table th { text-align: left }` (0,1,1) beats the `.text-right` utility
    // (0,1,0), so a `<th className="text-right">` is a silent no-op.
    const offenders = tsxFiles()
      .filter((p) => /<th className="[^"]*text-right/.test(readFileSync(p, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('nests no second <main> inside the shell layout', () => {
    const offenders = pageFiles()
      .filter((p) => readFileSync(p, 'utf8').includes('<main'))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
