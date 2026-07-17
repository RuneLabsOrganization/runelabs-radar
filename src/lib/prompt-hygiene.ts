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
