import { blob, index, real, sqliteTable, text, integer, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  passwordHash: text('password_hash').notNull().default(''),
  email: text('email').unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  /** Better Auth user id (text PK). Domain FKs keep using integer users.id. */
  authUserId: text('auth_user_id').unique(),
  role: text('role', { enum: ['admin', 'member'] }).notNull().default('member'),
  stripeCustomerId: text('stripe_customer_id'),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
  // Previous visit's timestamp: the stable anchor for "since your last visit"
  // while lastSeenAt acts as a heartbeat during the current visit.
  prevSeenAt: integer('prev_seen_at', { mode: 'timestamp' }),
});

export const sources = sqliteTable('sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type', { enum: ['rss', 'hn', 'reddit', 'arxiv', 'huggingface', 'github', 'brave', 'exa'] }).notNull(),
  name: text('name').notNull().unique(),
  config: text('config').notNull().default('{}'),
  domainHints: text('domain_hints').notNull().default('[]'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp' }),
  lastStatus: text('last_status'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  /**
   * Polls that returned zero NEW items. A feed can be 200-OK and dead: the
   * server keeps serving the same stale payload, so consecutiveFailures never
   * moves. This is the only signal that catches it.
   */
  consecutiveEmpty: integer('consecutive_empty').notNull().default(0),
});

/**
 * A dated judgement on each source. The longitudinal record of which feeds
 * actually earn their slot — written by the source-review job, never by hand.
 */
export const sourceQuality = sqliteTable(
  'source_quality',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: integer('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    /** UTC day the window ends (inclusive), YYYY-MM-DD. */
    windowEnd: text('window_end').notNull(),
    windowDays: integer('window_days').notNull(),
    fetched: integer('fetched').notNull().default(0),
    used: integer('used').notNull().default(0),
    curated: integer('curated').notNull().default(0),
    meanTopScore: real('mean_top_score'),
    meanHindsight: real('mean_hindsight'),
    verdict: text('verdict', { enum: ['keep', 'watch', 'demote', 'drop'] }).notNull(),
    reason: text('reason').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [uniqueIndex('source_quality_window').on(t.sourceId, t.windowEnd, t.windowDays)],
);

export const stories = sqliteTable(
  'stories',
  {
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
  },
  (t) => [
    // every feed/analytics read is "curated stories in the last N days"
    index('stories_status_created').on(t.status, t.createdAt),
    index('stories_top_score').on(t.topScore),
    index('stories_cluster').on(t.clusterId),
  ],
);

export const items = sqliteTable(
  'items',
  {
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
  },
  (t) => [index('items_story').on(t.storyId)],
);

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
  (t) => [primaryKey({ columns: [t.userId, t.storyId] }), index('votes_story').on(t.storyId)],
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
export const opportunities = sqliteTable(
  'opportunities',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // stable kebab identity — re-detection across days upserts by (owner, slug)
    slug: text('slug').notNull(),
    /**
     * NULL = the canonical public radar, written only by the daily engine.
     * Non-null = a private opening owned by one user (Rung 1/2 output).
     * Every read must scope with: owner_user_id IS NULL OR owner_user_id = :me
     */
    ownerUserId: integer('owner_user_id'),
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
  },
  (t) => [
    // Two users may legitimately compose the same slug, so uniqueness is
    // per-owner. SQLite treats NULLs as DISTINCT in unique indexes, so this
    // index does NOT constrain public rows — the partial index below does.
    uniqueIndex('opportunities_owner_slug').on(t.ownerUserId, t.slug),
    uniqueIndex('opportunities_public_slug').on(t.slug).where(sql`${t.ownerUserId} is null`),
    index('opportunities_owner_status').on(t.ownerUserId, t.status),
  ],
);

/** "The machine noticed" — daily anomaly detections, narrated. */
export const patterns = sqliteTable(
  'patterns',
  {
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
  },
  (t) => [index('patterns_date').on(t.date)],
);

export const insights = sqliteTable('insights', {
  date: text('date').primaryKey(),
  // JSON [{headline, detail, direction: 'up'|'down'|'watch', domain?}]
  items: text('items').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const jobRuns = sqliteTable(
  'job_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    job: text('job').notNull(),
    startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
    finishedAt: integer('finished_at', { mode: 'timestamp' }),
    status: text('status', { enum: ['running', 'ok', 'error'] }).notNull(),
    error: text('error'),
    stats: text('stats'),
  },
  // the header's freshness indicator runs this on every navigation
  (t) => [index('job_runs_job_status').on(t.job, t.status, t.finishedAt)],
);

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
export const llmCalls = sqliteTable(
  'llm_calls',
  {
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
  },
  (t) => [index('llm_calls_ts').on(t.ts), index('llm_calls_feature_ts').on(t.feature, t.ts)],
);

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

/**
 * Latest daily agent-stack overlay (IDE + harness + model playbooks).
 * Seed lives in lib/agent-stacks.ts; this row is the Brave+LLM refresh.
 * Singleton: id is always 1.
 */
export const agentStackState = sqliteTable('agent_stack_state', {
  id: integer('id').primaryKey(),
  payload: text('payload').notNull(),
  rationale: text('rationale'),
  braveHits: integer('brave_hits').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

/**
 * Personalization profile (Phase 9f, hosted mode) — one row per OAuth user,
 * written via the set_profile MCP tool. When present, get_opportunities
 * reranks by fit and scout_opportunities uses it as default constraints.
 */
export const userProfiles = sqliteTable('user_profiles', {
  userId: integer('user_id').primaryKey().references(() => users.id),
  skills: text('skills').notNull().default('[]'), // JSON string[]
  interests: text('interests').notNull().default('[]'), // JSON string[] (sectors/topics)
  capitalBand: text('capital_band'), // null | 'bootstrap' | 'small' | 'comfortable' | 'funded'
  avoidedSectors: text('avoided_sectors').notNull().default('[]'), // JSON string[]
  /** Saved kit persona slug — src/lib/kits/personas.ts KIT_PERSONA_SLUGS. */
  kitPersona: text('kit_persona'),
  /** Saved kit tier override; null = the persona's defaultTier. */
  kitTier: text('kit_tier', { enum: ['best', 'value', 'cheapest'] }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

/**
 * Per-user MCP token-savings aggregates for the current billing cycle.
 * ROI proof for the subscription — not a billing unit (artifact pricing stays).
 */
export const mcpEconomy = sqliteTable(
  'mcp_economy',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    cycleKey: text('cycle_key').notNull(), // YYYY-MM-DD of cycleStart
    calls: integer('calls').notNull().default(0),
    tokensReturned: integer('tokens_returned').notNull().default(0),
    tokensSavedVsFull: integer('tokens_saved_vs_full').notNull().default(0),
    tokensSavedVsDiy: integer('tokens_saved_vs_diy').notNull().default(0),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [uniqueIndex('mcp_economy_user_cycle').on(t.userId, t.cycleKey)],
);

/**
 * Watchlist — agents subscribe to entities/sectors/opportunities/topics and
 * pull only deltas via get_since instead of re-dumping the catalog.
 */
export const userWatches = sqliteTable(
  'user_watches',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind', { enum: ['entity', 'sector', 'opportunity', 'topic'] }).notNull(),
    key: text('key').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [uniqueIndex('user_watches_user_kind_key').on(t.userId, t.kind, t.key)],
);

/**
 * Thin agent session memory — last project/opportunity/topics so ask_radar and
 * get_opportunities can filter without the user repeating themselves.
 */
export const agentSessions = sqliteTable('agent_sessions', {
  userId: integer('user_id').primaryKey().references(() => users.id),
  lastProject: text('last_project'),
  lastOpportunity: text('last_opportunity'),
  watchTopics: text('watch_topics').notNull().default('[]'), // JSON string[]
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

/**
 * Batches — named working sets (workspace) or weekly Radar drops (kind='drop').
 * Bulk runs apply debate / generate_plan / scout across every item.
 */
export const batches = sqliteTable('batches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ownerId: integer('owner_id').references(() => users.id), // null = system Radar Batch
  kind: text('kind', { enum: ['workspace', 'drop'] }).notNull().default('workspace'),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  cohort: text('cohort'), // e.g. '2026-W34' for weekly drops
  visibility: text('visibility', { enum: ['private', 'members', 'public'] }).notNull().default('private'),
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const batchItems = sqliteTable('batch_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  batchId: integer('batch_id')
    .notNull()
    .references(() => batches.id),
  refType: text('ref_type', { enum: ['opportunity', 'story', 'entity', 'idea'] }).notNull(),
  refId: integer('ref_id'), // opportunity/story id when applicable
  refKey: text('ref_key'), // entity name or opportunity slug
  ideaText: text('idea_text'),
  position: integer('position').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const batchRuns = sqliteTable('batch_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  batchId: integer('batch_id')
    .notNull()
    .references(() => batches.id),
  op: text('op', { enum: ['debate', 'plan', 'scout'] }).notNull(),
  status: text('status', { enum: ['pending', 'running', 'ok', 'error'] }).notNull().default('pending'),
  requestedBy: integer('requested_by').references(() => users.id),
  stats: text('stats'), // JSON {total, ok, error, ...}
  error: text('error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
});

export const batchRunItems = sqliteTable('batch_run_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: integer('run_id')
    .notNull()
    .references(() => batchRuns.id),
  batchItemId: integer('batch_item_id')
    .notNull()
    .references(() => batchItems.id),
  status: text('status', { enum: ['pending', 'running', 'ok', 'error', 'skipped'] }).notNull().default('pending'),
  resultRef: text('result_ref'), // debate id, plan slug, etc.
  estCostUsd: real('est_cost_usd').notNull().default(0),
  error: text('error'),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
});

/**
 * Better Auth tables (text PKs). Linked to domain users via users.auth_user_id.
 * Generated to match better-auth drizzle adapter expectations.
 */
export const authUser = sqliteTable('auth_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  stripeCustomerId: text('stripe_customer_id'),
});

export const authSession = sqliteTable('auth_session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => authUser.id),
});

export const authAccount = sqliteTable(
  'auth_account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    /** Trusted issuer namespace — required by Better Auth 1.7 (credential = local:credential). */
    issuer: text('issuer').notNull().default('local:credential'),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [uniqueIndex('auth_account_issuer_account_uid').on(t.issuer, t.accountId)],
);

export const authVerification = sqliteTable('auth_verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export const subscription = sqliteTable('subscription', {
  id: text('id').primaryKey(),
  plan: text('plan').notNull(),
  referenceId: text('reference_id').notNull(),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  status: text('status').notNull(),
  periodStart: integer('period_start', { mode: 'timestamp' }),
  periodEnd: integer('period_end', { mode: 'timestamp' }),
  cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' }),
  seats: integer('seats'),
  trialStart: integer('trial_start', { mode: 'timestamp' }),
  trialEnd: integer('trial_end', { mode: 'timestamp' }),
});

/**
 * Durable replacement for the in-memory rate/quota Maps in mcp/server.ts and
 * the per-tool daily caps. Keyed by (bucket, feature, windowStart) so a fixed
 * window is a single upsert-and-read. Survives deploys; correct across replicas.
 */
export const usageCounters = sqliteTable(
  'usage_counters',
  {
    // 'user:123' or 'ip:1.2.3.4' — the AuthContext.rateKey, verbatim
    bucket: text('bucket').notNull(),
    // 'rate' | 'scout' | 'debate' | 'lead_refine' | 'forge' | ...
    feature: text('feature').notNull(),
    // start of the fixed window, epoch ms — hour/day granularity
    windowStart: integer('window_start', { mode: 'timestamp' }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.bucket, t.feature, t.windowStart] }),
    index('usage_counters_window').on(t.windowStart),
  ],
);

/**
 * The wedge taxonomy: the four axes Rung-0 composition crosses against
 * intelligence primitives. Admin-editable rows rather than a hardcoded module
 * so the combination space can grow without a deploy — the same reasoning that
 * makes `sources` a table.
 *
 * requiresTags / excludesTags are JSON string arrays matched against a
 * primitive's derived tags; they are what stop the cross-product from emitting
 * incoherent pairings ("compliance certification moat" on a hobbyist toy).
 */
export const wedgeValues = sqliteTable(
  'wedge_values',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // 'business_model' | 'delivery_form' | 'buyer' | 'moat_play'
    axis: text('axis').notNull(),
    slug: text('slug').notNull(),
    label: text('label').notNull(),
    // JSON string[] — primitive must carry ALL of these tags
    requiresTags: text('requires_tags').notNull().default('[]'),
    // JSON string[] — primitive must carry NONE of these tags
    excludesTags: text('excludes_tags').notNull().default('[]'),
    // 0..20 nudge into the heuristic score; higher = generally stronger wedge
    weight: integer('weight').notNull().default(10),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [
    uniqueIndex('wedge_values_axis_slug').on(t.axis, t.slug),
    index('wedge_values_axis_active').on(t.axis, t.active),
  ],
);

/**
 * Rung-0 composed leads, owner-scoped.
 *
 * Separate from `opportunities` on purpose: a lead is a heuristic hypothesis
 * with no verdict and no flip score, and an agent must never be able to mistake
 * one for a reviewed dossier. Refining a lead creates an `opportunities` row
 * and back-links it via opportunityId.
 *
 * ownerUserId NULL + ownerKey set = anonymous caller; those rows carry an
 * expiresAt and are swept periodically.
 */
export const leads = sqliteTable(
  'leads',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // AuthContext.rateKey — 'user:123' or 'ip:1.2.3.4'
    ownerKey: text('owner_key').notNull(),
    ownerUserId: integer('owner_user_id'),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    thesisSkeleton: text('thesis_skeleton').notNull(),
    sector: text('sector'),
    // JSON string[] of primitive refs (P1, A2, ...)
    primitiveRefs: text('primitive_refs').notNull().default('[]'),
    // JSON [{ref, type, label}] — the EXACT evidence text these primitiveRefs
    // resolved to at compose time. refine_lead uses this snapshot instead of
    // re-resolving refs against a freshly-reloaded (and possibly reordered)
    // primitive pool, so evidence never silently drifts under a stable ref.
    evidenceSnapshot: text('evidence_snapshot').notNull().default('[]'),
    // JSON Record<axis, wedge value slug>
    wedge: text('wedge').notNull().default('{}'),
    heuristicScore: integer('heuristic_score').notNull().default(0),
    combinationIndex: integer('combination_index').notNull().default(0),
    // 'composed' → 'refined'
    stage: text('stage', { enum: ['composed', 'refined'] }).notNull().default('composed'),
    opportunityId: integer('opportunity_id'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    // set for anonymous callers only; NULL means keep
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    dismissedAt: integer('dismissed_at', { mode: 'timestamp' }),
    dismissReason: text('dismiss_reason'),
  },
  (t) => [
    uniqueIndex('leads_owner_slug').on(t.ownerKey, t.slug),
    index('leads_owner_created').on(t.ownerKey, t.createdAt),
    index('leads_expires').on(t.expiresAt),
  ],
);

/**
 * Kit picks — one row per (category, task, tier).
 *
 * Supersedes board_entries, which flattened the three tiers into columns and
 * therefore had nowhere to store per-pick price, evidence, confidence or
 * verification date. That is why it has sat empty.
 *
 * `category` is the kit grid (src/lib/kits/grid.ts), NOT domains.ts DOMAINS.
 */
export const kitPicks = sqliteTable(
  'kit_picks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    category: text('category').notNull(),
    task: text('task').notNull(),
    tier: text('tier', { enum: ['best', 'value', 'cheapest'] }).notNull(),
    pickName: text('pick_name').notNull(),
    pickUrl: text('pick_url'),
    /** seat = flat monthly; usage = metered (never enters a kit total); free = $0 */
    priceModel: text('price_model', { enum: ['seat', 'usage', 'free'] })
      .notNull()
      .default('seat'),
    priceUsdMonth: real('price_usd_month'),
    priceNote: text('price_note'),
    /** Bill-shock warning for usage-priced picks, e.g. "no spend cap by default". */
    riskFlag: text('risk_flag'),
    why: text('why'),
    skip: text('skip'),
    confidence: text('confidence', { enum: ['high', 'med', 'low'] })
      .notNull()
      .default('low'),
    evidenceCount: integer('evidence_count').notNull().default(0),
    distinctSources: integer('distinct_sources').notNull().default(0),
    verifiedAt: integer('verified_at', { mode: 'timestamp' }),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [uniqueIndex('kit_pick_cell').on(t.category, t.task, t.tier)],
);

/** Receipts behind a verdict. The evidence engine writes these; it never writes a verdict. */
export const kitEvidence = sqliteTable(
  'kit_evidence',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    pickId: integer('pick_id')
      .notNull()
      .references(() => kitPicks.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['benchmark', 'price', 'report'] }).notNull(),
    sourceUrl: text('source_url').notNull(),
    excerpt: text('excerpt'),
    /** -1 negative, 0 neutral, 1 positive */
    sentiment: integer('sentiment').notNull().default(0),
    observedAt: integer('observed_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [index('kit_evidence_pick').on(t.pickId)],
);

/**
 * Every pick change, forever. Powers "changed since you last looked" (spec
 * phase 6) and is the longitudinal asset a competitor cannot scrape — start
 * accumulating it now even though the read surface ships later.
 */
export const kitPickHistory = sqliteTable(
  'kit_pick_history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    category: text('category').notNull(),
    task: text('task').notNull(),
    tier: text('tier', { enum: ['best', 'value', 'cheapest'] }).notNull(),
    fromPick: text('from_pick'),
    toPick: text('to_pick').notNull(),
    reason: text('reason').notNull(),
    changedAt: integer('changed_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [index('kit_history_cell').on(t.category, t.task)],
);
