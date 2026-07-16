import { and, desc, eq, isNull } from 'drizzle-orm';
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { config } from './config';
import { getDb } from './db';
import { stories } from './db/schema';

// Worker-only module: never import from Next.js pages/components — it drags
// the ONNX runtime into the web bundle.

const MODEL = 'Xenova/all-MiniLM-L6-v2'; // 384-dim, ~90MB, CPU-friendly
const BATCH_LIMIT = 128;

let _extractor: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!_extractor) {
    env.cacheDir = config.transformersCache;
    _extractor = pipeline('feature-extraction', MODEL, { dtype: 'fp32' });
  }
  return _extractor;
}

/** Mean-pooled, L2-normalized sentence embeddings. */
export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  const extractor = await getExtractor();
  const out: Float32Array[] = [];
  for (const text of texts) {
    const res = await extractor(text, { pooling: 'mean', normalize: true });
    out.push(new Float32Array(res.data as Float32Array));
  }
  return out;
}

// Vector helpers live in the web-safe module; re-exported here for worker code.
export { bufferToVec, cosine, vecToBuffer } from './vec';
import { vecToBuffer } from './vec';

/**
 * Hourly embed job: newest curated stories missing an embedding get one
 * (title + tldr). Powers the semantic map, clustering, dedup, and
 * related-stories in later phases.
 */
export async function runEmbed(): Promise<{ embedded: number }> {
  const db = getDb();
  const rows = db
    .select({ id: stories.id, title: stories.title, tldr: stories.tldr })
    .from(stories)
    .where(and(eq(stories.status, 'curated'), isNull(stories.embedding)))
    .orderBy(desc(stories.id))
    .limit(BATCH_LIMIT)
    .all();
  if (rows.length === 0) return { embedded: 0 };

  const vectors = await embedTexts(rows.map((r) => `${r.title}\n${r.tldr ?? ''}`.trim()));
  for (let i = 0; i < rows.length; i++) {
    db.update(stories).set({ embedding: vecToBuffer(vectors[i]) }).where(eq(stories.id, rows[i].id)).run();
  }
  return { embedded: rows.length };
}
