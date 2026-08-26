/**
 * Seed verdicts for the Best Right Now board.
 *
 * Hand-curated 2026-08-26 from (a) Radar's own story corpus, (b) the
 * hand-reviewed harness data in src/lib/agent-stacks.ts (reviewed 2026-08-21),
 * and (c) targeted vendor/pricing research. Sources are named in the verdict
 * text so a reader can check us.
 *
 * RULES, and they are the product:
 *   - A cell we cannot defend stays NULL. Do not fill a gap with a
 *     plausible-sounding pick — that is how the listicles work.
 *   - Prices are bands, not promises. Usage-priced things get a rate, not a
 *     monthly figure, because the monthly figure depends on your volume.
 *   - Where the free/native option is the right answer, say so even though it
 *     is the least impressive thing to write.
 *
 * applySeedVerdicts() only fills columns that are currently NULL, so a human
 * verdict written in the admin UI is never clobbered by a re-run.
 *
 * Next review due: 2026-11-26 (quarterly).
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { boardEntries, boardHistory } from '../db/schema';
import type { Domain } from '../domains';

export const BOARD_VERDICTS_REVIEWED_AT = '2026-08-26';
export const BOARD_VERDICT_AUTHOR = 'Runelabs';

export interface SeedVerdict {
  domain: Domain;
  task: string;
  bestOverall: string | null;
  bestValue: string | null;
  cheapestViable: string | null;
  /** ';'-separated — the board page renders one line per segment. */
  costNote: string | null;
  verdict: string;
}

export const SEED_VERDICTS: SeedVerdict[] = [
  // ---------------------------------------------------------------- coding
  {
    domain: 'coding',
    task: 'agentic-coding',
    bestOverall: 'Claude Code',
    bestValue: 'Codex',
    cheapestViable: 'OpenCode + your own API key',
    costNote:
      'Claude Code $20 / $100 / $200 per month; Codex $20 Plus, $200 Pro; OpenCode free, you pay the model bill',
    verdict:
      'The Pragmatic Engineer survey (n=906) puts Claude Code at 46% most-loved, roughly triple Cursor. Field reports through August 2026 are consistent: Codex is faster and cheaper for well-specified daily work, Claude is better when the task is underspecified and someone has to make judgement calls. Run the native harness for your model rather than driving Claude through Cursor — that is the combination people abandoned after surprise overage weeks.',
  },
  {
    domain: 'coding',
    task: 'autocomplete',
    bestOverall: 'Cursor Tab',
    bestValue: 'GitHub Copilot',
    cheapestViable: 'GitHub Copilot free tier',
    costNote: 'Cursor $20 / $60 / ~$200; Copilot $10 individual, $39 business',
    verdict:
      'Cursor still has the best inline feel and nothing has taken that from it. Copilot is the cheap seat, works in JetBrains, Visual Studio and Xcode, and is usually the one your IT department already approved — which is why its install base dwarfs its 9% most-loved score. Do not run frontier models inside Cursor Pro; that is how $20 becomes $60 mid-month.',
  },
  {
    domain: 'coding',
    task: 'code-review',
    bestOverall: 'Claude Code (Opus)',
    bestValue: 'Codex',
    cheapestViable: 'GitHub Copilot code review',
    costNote: 'Covered by the harness seat you already pay for; no separate purchase needed',
    verdict:
      'Weaker evidence than the other two coding cells — this is our read, not a survey finding. Reviewing a diff is the job where the model is asked to be sceptical rather than productive, and that is where the more deliberate models earn their cost. Both picks are already covered by a seat you hold, so the honest advice is to try review with what you have before buying a dedicated tool.',
  },

  // --------------------------------------------------------------- agentic
  {
    domain: 'agentic',
    task: 'browser-automation',
    bestOverall: 'Browserbase + Stagehand v3',
    bestValue: 'Playwright CLI',
    cheapestViable: 'Playwright MCP',
    costNote:
      'Browserbase $20–$99+ per month; Playwright CLI and Playwright MCP are free and open source',
    verdict:
      'Playwright CLI became Microsoft’s recommended token-efficient path in 2026, reportedly 4–100× lower token use than the MCP server for the same work — if your agent is burning context on browser calls, this is the fix. Playwright MCP stays the most complete option outside a CLI. Pay for Browserbase only when you need hosted sessions, proxies and replay. One migration note: Anthropic archived the Puppeteer MCP server in March 2026 — move off it.',
  },
  {
    domain: 'agentic',
    task: 'computer-use',
    bestOverall: 'Claude Computer Use',
    bestValue: 'Browser Use',
    cheapestViable: 'Browser Use, self-hosted',
    costNote: 'Both metered by model calls, not by seat — cost scales with the number of steps, not with time',
    verdict:
      'These are different bets, not better and worse. Browser Use reads the DOM and scores 89.1% on WebVoyager; Claude reads screenshots, scores 82.3% on OSWorld, and is the only one of the two that can leave the browser and drive a desktop application. Pick on whether your task is inside a browser. Budget carefully either way: every step is a screenshot plus a model call plus an action that can fail.',
  },
  {
    domain: 'agentic',
    task: 'orchestration',
    bestOverall: null,
    bestValue: null,
    cheapestViable: null,
    costNote: null,
    verdict:
      'Not yet covered — and we would rather say so. The frameworks in this space change faster than we can verify them, and the evidence we have is vendor documentation rather than reports from people running them in production. We are not going to name a winner we cannot defend. This cell gets filled when we have real usage reports behind it.',
  },

  // ------------------------------------------------------------------ copy
  {
    domain: 'copy',
    task: 'long-form',
    bestOverall: 'Claude Opus 4.8',
    bestValue: 'Claude Pro (Sonnet 5)',
    cheapestViable: 'ChatGPT Go',
    costNote: 'Claude Pro $20 per month, ~$17 billed annually; Max $100 / $200; ChatGPT Go $8',
    verdict:
      'Claude is the consistent pick for prose that needs less editing afterwards — fewer clichés, better structure, more controllable tone. The structural reason matters more than taste: dedicated writing tools with short lookback windows lose the thread on long pieces, so the conclusion of a 5,000-word article can contradict its introduction. A large context window simply does not have that failure mode.',
  },
  {
    domain: 'copy',
    task: 'ad-copy',
    bestOverall: 'Anyword',
    bestValue: 'Copy.ai',
    cheapestViable: 'Claude Pro or ChatGPT Plus',
    costNote: 'Anyword and Copy.ai are per-seat marketing tools; a $20 general assistant covers this for most people',
    verdict:
      'Short-form is the one place the specialists genuinely earn their price, because the long-context advantage that matters for articles is invisible in a headline. Anyword scores each variant 0–100 before you spend ad budget, which is a different product from writing well. If you are not running paid media at volume, the $20 assistant you already pay for is the honest answer.',
  },
  {
    domain: 'copy',
    task: 'social',
    bestOverall: 'Claude Pro',
    bestValue: 'ChatGPT Plus',
    cheapestViable: 'ChatGPT Go',
    costNote: 'Claude Pro $20; ChatGPT Plus $20; ChatGPT Go $8; both have usable free tiers',
    verdict:
      'Buy the general assistant, not the wrapper. Most AI writing products are ChatGPT or Claude underneath at roughly three times the price — the market has already shown this, with Jasper revenue falling from about $120M in 2023 to roughly $55M in 2024 as the mass-market use case got absorbed. The exception is a marketing org that needs brand voice enforced across many people, which is a governance product rather than a writing one.',
  },

  // ----------------------------------------------------------------- image
  {
    domain: 'image',
    task: 'photoreal',
    bestOverall: 'GPT Image 2',
    bestValue: 'Seedream 5.0 Pro',
    cheapestViable: 'Nano Banana 2',
    costNote: 'Seedream 5.0 Pro from ~$0.054 per image, Lite ~$0.031; Nano Banana 2 has a free tier',
    verdict:
      'GPT Image 2 currently tops both the generation and the editing leaderboards, which is unusual — most models win one and lose the other. The cost difference against Seedream compounds fast: past roughly fifty images a day the gap is the whole decision, and for most production work the quality difference is not what your audience notices.',
  },
  {
    domain: 'image',
    task: 'illustration',
    bestOverall: 'Midjourney V8.1',
    bestValue: 'Midjourney Standard',
    cheapestViable: 'FLUX.2, self-hosted',
    costNote:
      'Midjourney $10 / $30 / $60 / $120 per month, 20% off annual; extra fast GPU hours $4/hour and unused hours do not roll over; FLUX.2 free to run on your own hardware',
    verdict:
      'Midjourney still leads on aesthetics and art direction, and Standard at $30 is the sweet spot — roughly 900 fast images plus unlimited relax mode. But it is no longer the default production choice: no free tier, no API, web and Discord only. Two things to know before committing: billing is by GPU time rather than image count, and the Disney/Universal copyright action, consolidated with Warner Bros., was still in discovery as of July 2026.',
  },
  {
    domain: 'image',
    task: 'product-shots',
    bestOverall: 'FLUX 2 Pro',
    bestValue: 'Seedream 5.0',
    cheapestViable: 'Seedream 4',
    costNote: 'Seedream 4 ~$0.026–$0.032 per image; Seedream 5.0 Pro from ~$0.054; FLUX 2 Pro priced per generation',
    verdict:
      'Split by job. FLUX 2 Pro for the hero shot where control matters, Seedream for bulk lifestyle context where per-image cost is the constraint. One specific exception worth knowing: if the image has to render readable text — packaging, labels, signage — reach for Ideogram V3 instead, because text is still where most image models fail.',
  },

  // ----------------------------------------------------------------- video
  {
    domain: 'video',
    task: 'text-to-video',
    bestOverall: 'Seedance 2.0',
    bestValue: 'Kling 3.0',
    cheapestViable: 'Wan 2.6',
    costNote: 'Kling 3.0 ~$0.09–$0.14/sec; Wan 2.6 ~$0.05/sec; Veo 3.1 $0.40/sec with audio, Lite $0.05/sec',
    verdict:
      'The leaderboard reshuffled and the familiar names are not on top of it: Seedance 2.0 and HappyHorse-1.0 hold the top two slots on Artificial Analysis, with Kling holding four of the top ten. Two things you need to act on. Sora 2 was deprecated in April 2026 and its API shuts down 24 September 2026 — do not start anything new on it. And if you need synced audio in a single pass rather than a second tool, Veo 3.1 is the one, at roughly eight times Kling’s per-second rate.',
  },
  {
    domain: 'video',
    task: 'image-to-video',
    bestOverall: 'Runway Gen-4.5',
    bestValue: 'Kling 3.0',
    cheapestViable: 'Wan 2.6',
    costNote: 'Runway ~12 credits/sec (~$0.12/sec, so a 10-second clip is about $1.20); Kling ~$0.10/sec; Wan 2.6 ~$0.05/sec',
    verdict:
      'Runway has the best creative control in the category — video-to-video, motion controls, real direction rather than reroll-and-hope — but access is the catch: it is behind an enterprise waitlist with restricted direct API access, so check you can actually get in before planning around it. Kling is the one most people should use, and its multi-angle subject consistency is genuinely better for character-driven short-form.',
  },
  {
    domain: 'video',
    task: 'avatar/talking-head',
    bestOverall: 'Veo 3.1',
    bestValue: 'Kling 3.0',
    cheapestViable: 'HeyGen',
    costNote: 'Veo 3.1 $0.40/sec with audio; Kling ~$0.10/sec; HeyGen sold per seat rather than per second',
    verdict:
      'This is the one cell where paying for audio is the point. Veo 3.1 generates 48kHz speech natively, so lip sync is solved in one pass instead of stitched from two tools. Kling added multilingual lip sync in February 2026 and is the value pick. Turn audio generation off when you do not need it — it is commonly 30–50% of the bill.',
  },

  // ------------------------------------------------------------------- ads
  {
    domain: 'ads',
    task: 'creative-generation',
    bestOverall: 'AdCreative.ai',
    bestValue: 'Arcads',
    cheapestViable: 'Meta Advantage+ Creative',
    costNote:
      'AdCreative.ai per seat; Arcads $77 / $154 / $385 per month, roughly $11 per video; Meta Advantage+ Creative is included with your ad account',
    verdict:
      'Start with the free thing. Meta’s native creative enhancements will crop, animate, swap backgrounds and generate text variations at no extra cost, so only pay for what it genuinely cannot do. AdCreative.ai leads static performance creative; Arcads is the pick if you need UGC-style avatar video at volume. Two compliance notes: since March 2026 Meta requires disclosure of AI-generated content and undisclosed AI is a common rejection reason, and Advantage+ enhancements re-enable themselves when you duplicate a campaign.',
  },
  {
    domain: 'ads',
    task: 'campaign-management',
    bestOverall: 'Meta Advantage+',
    bestValue: 'AdStellar',
    cheapestViable: 'Meta Advantage+',
    costNote: 'Advantage+ is included with ad spend; AdStellar $49 Hobby, $129 Pro, $499 Ultra',
    verdict:
      'The best tool here is the free one, and we would rather tell you that than sell you something. Meta made Advantage+ the default for all new campaigns in February 2026 and is moving toward end-to-end automated campaigns from just a URL and a budget. A third-party platform only starts paying for itself when you are running across five or more platforms and manual upload has become the bottleneck. Below that, you are buying a second dashboard.',
  },
];

/**
 * Fill empty board cells with the seed verdicts. Idempotent and
 * non-destructive: a column that already has a value is left alone, so
 * anything a human wrote in the admin UI survives a re-run.
 *
 * Returns the number of board rows touched.
 */
export function applySeedVerdicts(now: Date = new Date()): number {
  const db = getDb();
  let touched = 0;

  for (const v of SEED_VERDICTS) {
    const row = db
      .select()
      .from(boardEntries)
      .where(eq(boardEntries.domain, v.domain))
      .all()
      .find((r) => r.task === v.task);
    if (!row) continue;

    const patch: Partial<typeof boardEntries.$inferInsert> = {};
    if (row.bestOverall == null && v.bestOverall != null) patch.bestOverall = v.bestOverall;
    if (row.bestValue == null && v.bestValue != null) patch.bestValue = v.bestValue;
    if (row.cheapestViable == null && v.cheapestViable != null) patch.cheapestViable = v.cheapestViable;
    if (row.costNote == null && v.costNote != null) patch.costNote = v.costNote;
    if (row.runelabsVerdict == null) {
      patch.runelabsVerdict = v.verdict;
      patch.verdictAuthor = BOARD_VERDICT_AUTHOR;
    }
    if (Object.keys(patch).length === 0) continue;

    patch.updatedAt = now;
    db.update(boardEntries).set(patch).where(eq(boardEntries.id, row.id)).run();

    db.insert(boardHistory)
      .values({
        domain: v.domain,
        task: v.task,
        change: `Initial verdict published (${BOARD_VERDICTS_REVIEWED_AT} editorial review).`,
        appliedAt: now,
      })
      .run();

    touched += 1;
  }
  return touched;
}
