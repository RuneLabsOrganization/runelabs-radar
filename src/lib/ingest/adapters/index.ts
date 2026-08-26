import type { Source, SourceAdapter } from '../types';
import { arxivAdapter } from './arxiv';
import { braveAdapter } from './brave';
import { exaAdapter } from './exa';
import { githubAdapter } from './github';
import { hnAdapter } from './hn';
import { huggingfaceAdapter } from './huggingface';
import { redditAdapter } from './reddit';
import { rssAdapter } from './rss';

export const adapters: Record<Source['type'], SourceAdapter> = {
  rss: rssAdapter,
  hn: hnAdapter,
  reddit: redditAdapter,
  arxiv: arxivAdapter,
  huggingface: huggingfaceAdapter,
  github: githubAdapter,
  brave: braveAdapter,
  exa: exaAdapter,
};
