import type { Domain } from '../domains';

export interface SeedSource {
  type: 'rss' | 'hn' | 'reddit' | 'arxiv' | 'huggingface' | 'github';
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
  { type: 'rss', name: 'Ars Technica — AI', config: { url: 'https://arstechnica.com/ai/feed/' }, domainHints: [] },
  { type: 'rss', name: 'The Verge — AI', config: { url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' }, domainHints: [] },
  { type: 'rss', name: 'TechCrunch — AI', config: { url: 'https://techcrunch.com/category/artificial-intelligence/feed/' }, domainHints: ['ads'] },
  { type: 'rss', name: 'VentureBeat — AI', config: { url: 'https://venturebeat.com/category/ai/feed/' }, domainHints: ['ads'] },
  { type: 'hn', name: 'Hacker News — AI', config: { query: 'AI OR LLM OR GPT OR Claude OR Gemini', minPoints: 50 }, domainHints: ['coding'] },
  { type: 'reddit', name: 'r/LocalLLaMA', config: { subreddit: 'LocalLLaMA' }, domainHints: ['coding'] },
  { type: 'reddit', name: 'r/StableDiffusion', config: { subreddit: 'StableDiffusion' }, domainHints: ['image'] },
  { type: 'reddit', name: 'r/aivideo', config: { subreddit: 'aivideo' }, domainHints: ['video'] },
  { type: 'arxiv', name: 'arXiv cs.AI/cs.CL', config: { query: 'cat:cs.AI OR cat:cs.CL', maxResults: 40 }, domainHints: [] },
  { type: 'huggingface', name: 'HF Trending Models', config: { kind: 'models' }, domainHints: [] },
  { type: 'huggingface', name: 'HF Daily Papers', config: { kind: 'papers' }, domainHints: [] },
  { type: 'github', name: 'GitHub Trending', config: {}, domainHints: ['coding'] },
];

export const SEED_BOARD_TASKS: Record<Domain, string[]> = {
  coding: ['agentic-coding', 'autocomplete', 'code-review'],
  copy: ['long-form', 'ad-copy', 'social'],
  image: ['product-shots', 'illustration', 'photoreal'],
  video: ['text-to-video', 'image-to-video', 'avatar/talking-head'],
  ads: ['creative-generation', 'campaign-management'],
  agentic: ['browser-automation', 'computer-use', 'orchestration'],
};
