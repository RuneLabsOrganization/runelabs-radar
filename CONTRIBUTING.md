# Contributing

Radar is a small, opinionated codebase on purpose. The best contributions:

## Source adapters (most wanted)

A new source = one file in `src/lib/ingest/adapters/` that normalizes into `items`:

```ts
import type { Adapter } from './types';

export const myAdapter: Adapter = {
  type: 'mytype',
  async fetch(config) {
    // return [{ url, title, excerpt?, publishedAt? }, ...]
    // url must be stable + unique — it dedupes items
  },
};
```

- Register it in `src/lib/ingest/adapters/index.ts`.
- Fail soft: a broken source records `consecutive_failures` and never aborts the batch.
- Be polite: conditional GETs where supported, per-run timeouts, respect robots/ToS.
- Add a fixture test in `tests/adapters.test.ts` against a captured payload (no live network in tests).

## Rules of the house

- `npm test` (vitest) and `npm run build` must pass.
- Dark scope-console design system lives in `.interface-design/system.md` — read it before touching UI.
- Type floor 10px, `--ink-4` is decoration-only (contrast), no new shadows.
- Never blackhole news: if the LLM is down, items still appear raw.
- Don't add dependencies without a reason in the PR description.

## Setup

```bash
npm install
cp .env.example .env          # SESSION_SECRET + MINIMAX_API_KEY
npm run seed -- --admin you password
npm run job -- ingest && npm run job -- curate
npm run dev
```
