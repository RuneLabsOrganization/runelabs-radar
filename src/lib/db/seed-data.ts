import type { Domain } from '../domains';

export interface SeedSource {
  type: 'rss' | 'hn' | 'reddit' | 'arxiv' | 'huggingface' | 'github' | 'brave' | 'exa';
  name: string;
  config: Record<string, unknown>;
  domainHints: Domain[];
}

// Feeds that turn out dead show up in the admin source-health panel and can be
// fixed from the UI — adding/removing a feed is a form, not a deploy.
export const SEED_SOURCES: SeedSource[] = [
  { type: 'rss', name: 'OpenAI News', config: { url: 'https://openai.com/news/rss.xml' }, domainHints: ['coding', 'agentic'] },
  { type: 'rss', name: 'Google DeepMind Blog', config: { url: 'https://deepmind.google/blog/rss.xml' }, domainHints: [] },
  { type: 'rss', name: 'Hugging Face Blog', config: { url: 'https://huggingface.co/blog/feed.xml' }, domainHints: [] },
  { type: 'rss', name: 'Simon Willison', config: { url: 'https://simonwillison.net/atom/everything/' }, domainHints: ['coding', 'agentic'] },
  { type: 'rss', name: 'Mistral News', config: { url: 'https://mistral.ai/rss.xml' }, domainHints: [] },
  { type: 'rss', name: 'Stability AI News', config: { url: 'https://stability.ai/news?format=rss' }, domainHints: ['image'] },
  { type: 'rss', name: 'Replicate Blog', config: { url: 'https://replicate.com/blog/rss' }, domainHints: ['image', 'video'] },
  { type: 'rss', name: 'Ars Technica — AI', config: { url: 'https://arstechnica.com/ai/feed/', pollMinutes: 15 }, domainHints: [] },
  { type: 'rss', name: 'The Verge — AI', config: { url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', pollMinutes: 15 }, domainHints: [] },
  { type: 'rss', name: 'TechCrunch — AI', config: { url: 'https://techcrunch.com/category/artificial-intelligence/feed/', pollMinutes: 15 }, domainHints: ['ads'] },
  { type: 'rss', name: 'VentureBeat — AI', config: { url: 'https://venturebeat.com/category/ai/feed/', pollMinutes: 15 }, domainHints: ['ads'] },
  { type: 'hn', name: 'Hacker News — AI', config: { query: 'AI OR LLM OR GPT OR Claude OR Gemini', minPoints: 50, pollMinutes: 15 }, domainHints: ['coding'] },
  { type: 'reddit', name: 'r/LocalLLaMA', config: { subreddit: 'LocalLLaMA' }, domainHints: ['coding'] },
  { type: 'reddit', name: 'r/StableDiffusion', config: { subreddit: 'StableDiffusion' }, domainHints: ['image'] },
  { type: 'reddit', name: 'r/aivideo', config: { subreddit: 'aivideo' }, domainHints: ['video'] },
  { type: 'arxiv', name: 'arXiv cs.AI/cs.CL', config: { query: 'cat:cs.AI OR cat:cs.CL', maxResults: 40, pollMinutes: 60 }, domainHints: [] },
  { type: 'huggingface', name: 'HF Trending Models', config: { kind: 'models', pollMinutes: 60 }, domainHints: [] },
  { type: 'huggingface', name: 'HF Daily Papers', config: { kind: 'papers', pollMinutes: 60 }, domainHints: [] },
  { type: 'github', name: 'GitHub Trending', config: { pollMinutes: 60 }, domainHints: ['coding'] },
  // Search (Exa primary, Brave fallback on any Exa error) — targeted queries
  // per domain, 3h poll cadence via pollMinutes. See src/lib/ingest/adapters/exa.ts.
  { type: 'exa', name: 'Search — Coding AI', config: { query: 'AI coding assistant OR code model OR agentic coding', pollMinutes: 180 }, domainHints: ['coding'] },
  { type: 'exa', name: 'Search — Copy AI', config: { query: 'AI copywriting OR AI writing tool', pollMinutes: 180 }, domainHints: ['copy'] },
  { type: 'exa', name: 'Search — Image AI', config: { query: 'AI image generation OR text-to-image model', pollMinutes: 180 }, domainHints: ['image'] },
  { type: 'exa', name: 'Search — Video AI', config: { query: 'AI video generation OR text-to-video model', pollMinutes: 180 }, domainHints: ['video'] },
  { type: 'exa', name: 'Search — Ads AI', config: { query: 'AI ad creative OR advertising automation AI', pollMinutes: 180 }, domainHints: ['ads'] },
  { type: 'exa', name: 'Search — Agentic AI', config: { query: 'AI agents OR browser agent OR computer use', pollMinutes: 180 }, domainHints: ['agentic'] },
  { type: 'exa', name: 'Search — Frontier Watch', config: { query: 'frontier AI model release OR LLM launch', pollMinutes: 180 }, domainHints: [] },
  { type: 'exa', name: 'Search — Audio AI', config: { query: 'AI voice generation OR text-to-speech OR AI music model', pollMinutes: 180 }, domainHints: [] },
  { type: 'exa', name: 'Search — Dev Infra', config: { query: 'Vercel OR Supabase OR Cloudflare Workers pricing OR outage OR migration', pollMinutes: 180 }, domainHints: ['coding'] },
  { type: 'exa', name: 'Search — MCP Servers', config: { query: 'MCP server Model Context Protocol tool integration', pollMinutes: 180 }, domainHints: ['agentic'] },
  { type: 'reddit', name: 'r/webdev', config: { subreddit: 'webdev' }, domainHints: ['coding'] },
  // Copy/ads were structurally underserved — copy had exactly one source
  // (the Brave query above) and ads had one dedicated source plus two
  // generic tech-news feeds. These are free, zero-quota, active communities,
  // the same adapter type already proven by r/StableDiffusion and r/LocalLLaMA.
  { type: 'reddit', name: 'r/copywriting', config: { subreddit: 'copywriting' }, domainHints: ['copy'] },
  { type: 'reddit', name: 'r/PPC', config: { subreddit: 'PPC' }, domainHints: ['ads'] },
  { type: 'reddit', name: 'r/advertising', config: { subreddit: 'advertising' }, domainHints: ['ads'] },
  { type: 'reddit', name: 'r/DigitalMarketing', config: { subreddit: 'DigitalMarketing' }, domainHints: ['copy', 'ads'] },
];

export const SEED_BOARD_TASKS: Record<Domain, string[]> = {
  coding: ['agentic-coding', 'autocomplete', 'code-review'],
  copy: ['long-form', 'ad-copy', 'social'],
  image: ['product-shots', 'illustration', 'photoreal'],
  video: ['text-to-video', 'image-to-video', 'avatar/talking-head'],
  ads: ['creative-generation', 'campaign-management'],
  agentic: ['browser-automation', 'computer-use', 'orchestration'],
};
