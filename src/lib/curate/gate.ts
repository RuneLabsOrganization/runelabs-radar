/**
 * The relevance gate: a deterministic, zero-cost pre-filter between clustering
 * and the LLM curation call. Roughly half of all raw stories are obvious
 * off-topic junk (celebrity gossip, sports, shitposts) that would otherwise
 * burn a curation call just to score 0 across all six domains.
 *
 * Conservative by design: a story is filtered ONLY when no AI/domain vocabulary
 * appears anywhere in its title or member items. One unambiguous term passes
 * it; ambiguous everyday words ("model", "agent", "token") need two distinct
 * hits. Borderline always reaches the LLM — a false filter is worse than a
 * wasted call.
 */

/** Unambiguous AI-industry vocabulary — a single hit passes the gate. */
const STRONG: RegExp[] = [
  /\bllms?\b/,
  /\bgpt[-\s]?\d*/,
  /\bclaude\b/,
  /\bgemini\b/,
  /\bcopilot\b/,
  /\bopenai\b/,
  /\banthropic\b/,
  /\bdeepmind\b/,
  /\bdeepseek\b/,
  /\bqwen\b/,
  /\bmistral\b/,
  /\bmidjourney\b/,
  /\bsora\b/,
  /\bsuno\b/,
  /\bperplexity\b/,
  /\bhugging\s?face\b/,
  /\bstability\s+ai\b/,
  /\bblack\s+forest\s+labs\b/,
  /\bstable\s?diffusion\b/,
  /\btext-to-(image|video|speech|audio|3d)\b/,
  /\b(image|video|music|voice|speech|code|text)\s+generation\b/,
  /\bgenerative\s+ai\b/,
  /\bgen[-\s]?ai\b/,
  /\bchatbot(s)?\b/,
  /\bfine[-\s]?tun(e|ed|ing)\b/,
  /\bprompt\s+(engineering|injection)\b/,
  /\bembedding(s)?\b/,
  /\bmultimodal\b/,
  /\bretrieval[-\s]augmented\b/,
  /\bvector\s+(database|db|store|search|embedding)/,
  /\bagentic\b/,
  /\bai\s+agent(s)?\b/,
  /\bcomputer[-\s]use\b/,
  /\blarge\s+language\s+model(s)?\b/,
  /\bfoundation\s+model(s)?\b/,
  /\bfrontier\s+model(s)?\b/,
  /\bmachine\s+learning\b/,
  /\bdeep\s+learning\b/,
  /\breinforcement\s+learning\b/,
  /\bartificial\s+intelligence\b/,
  /\bllama[\s-]?\d/,
  /\btransformer(s)?\s+(model|architecture|network)/,
];

/**
 * Everyday words that only signal relevance in combination — "model" alone is
 * a fashion story; "model" + "benchmark" is ours.
 */
const WEAK: RegExp[] = [
  /\bai\b/,
  /\bmodel(s)?\b/,
  /\bagent(s)?\b/,
  /\btoken(s)?\b/,
  /\bneural\b/,
  /\bcoding?\b/,
  /\bautomation\b/,
  /\bworkflow(s)?\b/,
  /\bcopywriting\b/,
  /\bwriting\s+(assistant|tool)/,
  /\bad(s|vertising|vertiser)?\b/,
  /\bcampaign(s)?\b/,
  /\bseo\b/,
  /\bvideo\b/,
  /\bimage(s)?\b/,
  /\bavatar(s)?\b/,
  /\bvoice(s)?\b/,
  /\brobot(s|ic|ics)?\b/,
  /\bdataset(s)?\b/,
  /\bbenchmark(s)?\b/,
  /\bgpu(s)?\b/,
  /\bprompt(s|ing)?\b/,
  /\brunway\b/,
  /\btransformer(s)?\b/,
  /\bdiffusion\b/,
  /\bgenerat(e|es|ing|ion)\b/,
  /\bopen[\s-]?source\b/,
  /\bapi\b/,
];

/**
 * True when the story carries enough AI/domain vocabulary to deserve an LLM
 * curation call. `memberTexts` = member item titles + excerpts (empty ok).
 */
export function passesGate(title: string, memberTexts: string[] = []): boolean {
  const text = [title, ...memberTexts].join('\n').toLowerCase();
  for (const re of STRONG) {
    if (re.test(text)) return true;
  }
  let weak = 0;
  for (const re of WEAK) {
    if (re.test(text)) weak++;
    if (weak >= 2) return true;
  }
  return false;
}
