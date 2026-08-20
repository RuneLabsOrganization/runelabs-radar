import { blob, real, sqliteTable, text, integer, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'member'] }).notNull().default('member'),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
  // Previous visit's timestamp: the stable anchor for "since your last visit"
  // while lastSeenAt acts as a heartbeat during the current visit.
  prevSeenAt: integer('prev_seen_at', { mode: 'timestamp' }),
});

export const sources = sqliteTable('sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type', { enum: ['rss', 'hn', 'reddit', 'arxiv', 'huggingface', 'github', 'brave'] }).notNull(),
  name: text('name').notNull().unique(),
  config: text('config').notNull().default('{}'),
  domainHints: text('domain_hints').notNull().default('[]'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp' }),
  lastStatus: text('last_status'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
});

export const stories = sqliteTable('stories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  tldr: text('tldr'),
  whyItMatters: text('why_it_matters'),
  whyShown: text('why_shown'),
  domainScores: text('domain_scores'),
  // JSON [{name, kind: 'model'|'tool'|'org'|'technique'}] extracted at curation
  entities: text('entities'),
  // Float32Array bytes from the local sentence-embedding model (embed job)
  embedding: blob('embedding', { mode: 'buffer' }),
  // semantic-map placement, refreshed by the daily science job
  clusterId: integer('cluster_id'),
  mapX: real('map_x'),
  mapY: real('map_y'),
  topScore: integer('top_score').notNull().default(0),
  // hindsight: what the story actually turned out to be worth 36-60h later
  // (echoes, launches, follow-ups) — feeds the accuracy page + calibration
  hindsight: integer('hindsight'),
  hindsightAt: integer('hindsight_at', { mode: 'timestamp' }),
  // contrarian "second look" — why this might NOT matter + one second-order
  // effect, written once per high-score story by the second-look job
  secondLook: text('second_look'),
  secondLookAt: integer('second_look_at', { mode: 'timestamp' }),
  status: text('status', { enum: ['raw', 'curated', 'filtered'] }).notNull().default('raw'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  // last time a new item merged into this story — null until first merge;
  // the "updated" freshness signal and the re-curation trigger
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export const items = sqliteTable('items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: integer('source_id')
    .notNull()
    .references(() => sources.id),
  url: text('url').notNull().unique(),
  title: text('title').notNull(),
  excerpt: text('excerpt'),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).notNull(),
  storyId: integer('story_id').references(() => stories.id),
});

export const votes = sqliteTable(
  'votes',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    storyId: integer('story_id')
      .notNull()
      .references(() => stories.id),
    value: integer('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.storyId] })],
);

export const boardEntries = sqliteTable(
  'board_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    domain: text('domain').notNull(),
    task: text('task').notNull(),
    bestOverall: text('best_overall'),
    bestValue: text('best_value'),
    cheapestViable: text('cheapest_viable'),
    costNote: text('cost_note'),
    runelabsVerdict: text('runelabs_verdict'),
    verdictAuthor: text('verdict_author'),
    updatedAt: integer('updated_at', { mode: 'timestamp' }),
  },
  (t) => [uniqueIndex('board_domain_task').on(t.domain, t.task)],
);

export const boardProposals = sqliteTable('board_proposals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  domain: text('domain').notNull(),
  task: text('task').notNull(),
  proposed: text('proposed').notNull(),
  rationale: text('rationale').notNull(),
  status: text('status', { enum: ['pending', 'approved', 'rejected'] })
    .notNull()
    .default('pending'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const boardHistory = sqliteTable('board_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  domain: text('domain').notNull(),
  task: text('task').notNull(),
  change: text('change').notNull(),
  appliedAt: integer('applied_at', { mode: 'timestamp' }).notNull(),
});

export const benchmarkSnapshots = sqliteTable('benchmark_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  source: text('source').notNull(),
  raw: text('raw').notNull(),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).notNull(),
});

export const briefs = sqliteTable('briefs', {
  date: text('date').primaryKey(),
  markdown: text('markdown').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

/** Stored forecasts — nightly snapshots graded against realized prices later. */
export const forecasts = sqliteTable(
  'forecasts',
  {
    date: text('date').notNull(), // YYYY-MM-DD
    metric: text('metric').notNull(), // e.g. 'frontier_price_30d'
    predicted: real('predicted').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.metric] })],
);

/** One 2-line analytical digest per domain per day, written by the brief job. */
export const domainDigests = sqliteTable(
  'domain_digests',
  {
    domain: text('domain').notNull(),
    date: text('date').notNull(), // YYYY-MM-DD
    text: text('text').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.domain, t.date] })],
);

/**
 * Universal daily time series: one row per (source, entity, metric, day).
 * AA model prices, arena ELOs, GitHub stars, HF/npm downloads, launch counts —
 * everything that charts over time lands here.
 */
export const metricPoints = sqliteTable(
  'metric_points',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    source: text('source').notNull(), // 'aa' | 'aa-media-*' | 'github' | 'huggingface' | 'npm' | 'launches'
    entity: text('entity').notNull(), // model name, repo, package, category…
    metric: text('metric').notNull(), // 'price_blended' | 'intelligence' | 'elo' | 'stars' | …
    value: real('value').notNull(),
    date: text('date').notNull(), // YYYY-MM-DD (UTC)
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => ({
    metricKey: uniqueIndex('metric_points_key').on(t.source, t.entity, t.metric, t.date),
  }),
);

export const launches = sqliteTable('launches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  source: text('source', { enum: ['show-hn', 'producthunt'] }).notNull(),
  title: text('title').notNull(),
  url: text('url').notNull().unique(),
  points: integer('points'),
  comments: integer('comments'),
  // LLM-tagged category slug (ai-coding, ai-media, agents, saas-tools, …)
  category: text('category'),
  launchedAt: integer('launched_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const painPoints = sqliteTable('pain_points', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // imperative unmet-need statement, e.g. "reliable bulk background removal for product photos"
  summary: text('summary').notNull(),
  sector: text('sector'),
  // times this need has been observed (bumped on dedup matches)
  intensity: integer('intensity').notNull().default(1),
  // JSON [{title, url}] of observed evidence
  evidence: text('evidence').notNull().default('[]'),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const comps = sqliteTable('comps', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind', { enum: ['exit', 'revenue'] }).notNull(),
  product: text('product').notNull(),
  amountUsd: real('amount_usd'),
  note: text('note'),
  sourceUrl: text('source_url'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const stacks = sqliteTable('stacks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  venture: text('venture').notNull().unique(),
  title: text('title').notNull(),
  tagline: text('tagline'),
  // JSON [{layer, pick, alt, note}] — layer from the fixed set in lib/stacks
  layers: text('layers').notNull(),
  costNote: text('cost_note'),
  timeToMvp: text('time_to_mvp'),
  rationale: text('rationale'),
  runelabsVerdict: text('runelabs_verdict'),
  verdictAuthor: text('verdict_author'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

/**
 * Semantic topic clusters over story embeddings — regenerated daily,
 * replace-all. Two levels: macro categories (parentId null) and their
 * subtopics (parentId set). stories.clusterId points at the LEAF cluster
 * (a subtopic, or the macro itself when it was too small to split).
 */
export const topicClusters = sqliteTable('topic_clusters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  parentId: integer('parent_id'),
  label: text('label').notNull(),
  summary: text('summary'),
  size: integer('size').notNull(),
  // recency-weighted activity, normalized 0..1 within each level
  heat: real('heat').notNull().default(0),
  // mean cosine of members to centroid — low = grab-bag cluster, not a topic
  coherence: real('coherence').notNull().default(0),
  // dominant sector among member stories (bubble tinting), null when mixed
  sector: text('sector'),
  centroid: blob('centroid', { mode: 'buffer' }),
  date: text('date').notNull(), // run day (YYYY-MM-DD UTC)
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

/** The Opportunity Engine's output: scored monetizable openings. */
export const opportunities = sqliteTable('opportunities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // stable kebab identity — re-detection across days upserts by slug
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  thesis: text('thesis').notNull(),
  sector: text('sector'),
  status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
  flipScore: integer('flip_score').notNull(),
  holdScore: integer('hold_score').notNull(),
  // JSON sub-scores, each 0-20: demand, buildability, margin, competition,
  // timing, moat, regClear, platformSafe, distribution, qualityBar
  scores: text('scores').notNull(),
  // JSON hard estimates {initialCostUsd, monthlyCostUsd, priceUsd,
  // timeToMvpDays, breakEvenCustomers, competitorCount, competitionNote, regulatoryNote}
  kpis: text('kpis'),
  // JSON [{type: 'pain'|'pattern'|'story'|'entity'|'market', label}]
  evidence: text('evidence').notNull().default('[]'),
  window: text('window'),
  // structured window for the scoring gate (the text above is for humans)
  windowMonths: integer('window_months'),
  // layered review outcome: adversarial critic verdict + deterministic gate caps,
  // full trail in `review` (JSON {killRisks, adjustments, flags, capsApplied,
  // criticVerdict, rawFlip, rawHold, criticUnavailable?})
  verdict: text('verdict', { enum: ['pursue', 'watch', 'reject'] }).notNull().default('watch'),
  confidence: integer('confidence').notNull().default(40),
  review: text('review'),
  reviewedAt: integer('reviewed_at', { mode: 'timestamp' }),
  // JSON launchable brief — generated on first expand, cached
  brief: text('brief'),
  briefGeneratedAt: integer('brief_generated_at', { mode: 'timestamp' }),
  // JSON execution plan (full task graph) — generated on first MCP request, cached
  plan: text('plan'),
  planGeneratedAt: integer('plan_generated_at', { mode: 'timestamp' }),
  // crowdedness signal (Phase 9e): successful plan generations for this
  // opportunity — "N builders exploring this", with a ranking penalty above
  // the threshold in the get_opportunities tool
  planRuns: integer('plan_runs').notNull().default(0),
  firstSeenAt: integer('first_seen_at', { mode: 'timestamp' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }).notNull(),
});

/** "The machine noticed" — daily anomaly detections, narrated. */
export const patterns = sqliteTable('patterns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind').notNull(), // 'sector-spike' | 'entity-surge' | 'price-drop' | 'launch-spike' | 'cluster-heat' | 'pain-cluster'
  // what the detection is about (entity name, sector slug, model name…) —
  // lets the UI fetch the underlying series for a per-pattern trend chart
  subject: text('subject'),
  headline: text('headline').notNull(),
  detail: text('detail').notNull(),
  score: real('score').notNull(), // magnitude for ranking (z-score, ratio, %)
  evidence: text('evidence').notNull().default('[]'), // JSON refs
  date: text('date').notNull(), // detection day (YYYY-MM-DD UTC)
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const insights = sqliteTable('insights', {
  date: text('date').primaryKey(),
  // JSON [{headline, detail, direction: 'up'|'down'|'watch', domain?}]
  items: text('items').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const jobRuns = sqliteTable('job_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  job: text('job').notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  status: text('status', { enum: ['running', 'ok', 'error'] }).notNull(),
  error: text('error'),
  stats: text('stats'),
});

export const llmUsage = sqliteTable('llm_usage', {
  date: text('date').primaryKey(),
  calls: integer('calls').notNull().default(0),
});

/**
 * One row per successful LLM call — the monetization prerequisite (§1.3.4):
 * per-feature/per-user cost attribution. durationMs is deliberate double-duty:
 * completionTokens / durationMs per model = our own measured output-speed
 * series, rolled into metric_points (source 'radar-speed') by the science job.
 */
export const llmCalls = sqliteTable('llm_calls', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: integer('ts', { mode: 'timestamp' }).notNull(),
  feature: text('feature').notNull(), // 'curate'|'brief'|'plan'|'stack'|'pain'|'opportunity'|'debate'|'scout'|'digest'|'second-look'|...
  job: text('job'), // worker job name when applicable
  userId: integer('user_id'), // oauth user when MCP-triggered; null = pipeline/anonymous
  model: text('model').notNull(),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0), // wall time — also powers first-party speed data
  estCostUsd: real('est_cost_usd').notNull().default(0),
});

/**
 * OAuth 2.1 for the MCP server (Next.js is the authorization server, the MCP
 * process only validates). Clients register dynamically (RFC 7591) so any MCP
 * client can connect without manual key copying.
 */
export const oauthClients = sqliteTable('oauth_clients', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clientId: text('client_id').notNull().unique(),
  name: text('name'),
  // JSON string[] of allowed redirect URIs from dynamic registration
  redirectUris: text('redirect_uris').notNull().default('[]'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

/** Short-lived authorization codes (PKCE S256), exchanged once at the token endpoint. */
export const oauthCodes = sqliteTable('oauth_codes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),
  clientId: text('client_id').notNull(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  redirectUri: text('redirect_uri').notNull(),
  scope: text('scope').notNull().default('read'),
  codeChallenge: text('code_challenge').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const oauthTokens = sqliteTable('oauth_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accessToken: text('access_token').notNull().unique(),
  refreshToken: text('refresh_token').unique(),
  clientId: text('client_id').notNull(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  scope: text('scope').notNull().default('read'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

/**
 * Per-user artifact quota (Phase 8a). The user's unit is a plan generation;
 * usage is counted from llm_calls rows (feature='plan', userId=?) within the
 * current reset cycle. No row = default 'free' tier.
 */
export const planEntitlements = sqliteTable('plan_entitlements', {
  userId: integer('user_id').primaryKey().references(() => users.id),
  tier: text('tier', { enum: ['free', 'builder', 'factory'] }).notNull().default('free'),
  plansPerMonth: integer('plans_per_month').notNull().default(3), // free=3, builder=30, factory=100
  resetDay: integer('reset_day').notNull().default(1), // day of month the quota resets
});

/**
 * Multi-role debate transcripts (Phase 9a): Advocate → Skeptic → Market
 * Realist → Judge over either a stored opportunity (opportunityId) or a
 * free-text idea (ideaText) from the debate_idea tool — exactly one is set.
 */
export const debates = sqliteTable('debates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  opportunityId: integer('opportunity_id').references(() => opportunities.id),
  ideaText: text('idea_text'),
  // JSON [{role: 'advocate'|'skeptic'|'realist'|'judge', text}]
  transcript: text('transcript').notNull(),
  verdict: text('verdict', { enum: ['pursue', 'watch', 'reject'] }).notNull(),
  confidence: integer('confidence').notNull().default(40),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

/**
 * Weekly "State of the Builder Market" report (Phase 10) — one markdown issue
 * per Sunday, written by runWeeklyReport; public /reports archive + MCP tool.
 */
export const reports = sqliteTable('reports', {
  date: text('date').primaryKey(), // YYYY-MM-DD (UTC, Sunday issue)
  markdown: text('markdown').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
