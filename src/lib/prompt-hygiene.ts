// Built via RegExp() with escaped source so the control-char class survives
// every toolchain; a literal class here has been mangled in transit before.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f]+', 'g');
const WHITESPACE = new RegExp('\\s+', 'g');

/**
 * Untrusted text → one prompt-safe line: control characters stripped,
 * whitespace collapsed (kills line-forging inside prompts), truncated.
 * Use for ANY external text (titles, summaries, entity names) that gets
 * interpolated into an LLM prompt or rendered as machine analysis.
 */
export function promptLine(s: string, max = 120): string {
  return s.replace(CONTROL_CHARS, ' ').replace(WHITESPACE, ' ').trim().slice(0, max);
}

/**
 * CJK leakage stripper — OUTPUT side only. MiniMax-M2 has a documented habit
 * of splicing hanzi / kana / CJK punctuation into non-Chinese answers
 * (MiniMax-M2 issues #55, #100, #110; semantic-level, prompts can't fully
 * prevent it). Our generated artifacts (briefs, plans, digests, stacks) are
 * English by design, so any CJK there is leakage. NEVER apply this to scraped
 * input (story titles etc.) — CJK is legitimate content there.
 *
 * - CJK ideographs / radicals / kana / CJK punctuation → a space
 * - fullwidth ASCII variants (，！：…) → their ASCII equivalents
 * - horizontal whitespace re-collapsed, markdown newlines preserved
 */
export function stripCjkLeak(s: string): string {
  let out = '';
  let stripped = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x3002) {
      out += '. '; // 。 ideographic full stop
      stripped++;
    } else if (cp === 0x3001) {
      out += ', '; // 、 ideographic comma
      stripped++;
    } else if (cp >= 0xff01 && cp <= 0xff5e) {
      out += String.fromCodePoint(cp - 0xfee0); // fullwidth → ASCII
    } else if (
      (cp >= 0x2e80 && cp <= 0x303f) || // CJK radicals + CJK punctuation
      (cp >= 0x3040 && cp <= 0x30ff) || // hiragana / katakana
      (cp >= 0x3400 && cp <= 0x4dbf) || // ideographs ext A
      (cp >= 0x4e00 && cp <= 0x9fff) || // unified ideographs (the common case)
      (cp >= 0xf900 && cp <= 0xfaff) // compatibility ideographs
    ) {
      out += ' ';
      stripped++;
    } else {
      out += ch;
    }
  }
  if (stripped > 0) {
    console.warn(`[cjk] stripped ${stripped} leaked CJK char(s) from LLM output`);
  }
  return out
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Deep-apply stripCjkLeak to every string in a parsed JSON structure. */
export function stripCjkDeep<T>(v: T): T {
  if (typeof v === 'string') return stripCjkLeak(v) as T;
  if (Array.isArray(v)) return v.map(stripCjkDeep) as T;
  if (typeof v === 'object' && v !== null) {
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, stripCjkDeep(val)])) as T;
  }
  return v;
}
