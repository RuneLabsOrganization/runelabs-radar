import type { FetchedItem, Source, SourceAdapter } from '../types';
import { fetchJson, parseConfig, parseDate, toExcerpt } from './shared';

interface HfConfig {
  kind?: 'models' | 'papers';
}

interface HfModel {
  id?: string;
  modelId?: string;
  lastModified?: string;
}

interface HfPaperEntry {
  publishedAt?: string;
  paper?: {
    id?: string;
    title?: string;
    summary?: string;
    publishedAt?: string;
  };
}

export const huggingfaceAdapter: SourceAdapter = {
  type: 'huggingface',
  async fetchItems(source: Source): Promise<FetchedItem[]> {
    const cfg = parseConfig<HfConfig>(source.config);

    if (cfg.kind === 'models') {
      const models = await fetchJson<HfModel[]>(
        'https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=20',
      );
      const out: FetchedItem[] = [];
      for (const model of Array.isArray(models) ? models : []) {
        const modelId = model?.modelId ?? model?.id;
        if (!modelId) continue;
        out.push({
          url: `https://huggingface.co/${modelId}`,
          title: modelId,
          excerpt: null,
          publishedAt: parseDate(model.lastModified),
        });
      }
      return out;
    }

    if (cfg.kind === 'papers') {
      const entries = await fetchJson<HfPaperEntry[]>('https://huggingface.co/api/daily_papers?limit=20');
      const out: FetchedItem[] = [];
      for (const entry of Array.isArray(entries) ? entries : []) {
        const paper = entry?.paper;
        if (!paper?.id || !paper.title) continue;
        out.push({
          url: `https://huggingface.co/papers/${paper.id}`,
          title: paper.title.replace(/\s+/g, ' ').trim(),
          excerpt: toExcerpt(paper.summary),
          publishedAt: parseDate(entry.publishedAt ?? paper.publishedAt),
        });
      }
      return out;
    }

    throw new Error(`huggingface source "${source.name}" needs config.kind of 'models' or 'papers'`);
  },
};
