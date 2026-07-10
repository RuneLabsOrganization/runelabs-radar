import { sqliteTable, text, integer, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
  type: text('type', { enum: ['rss', 'hn', 'reddit', 'arxiv', 'huggingface', 'github'] }).notNull(),
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
  domainScores: text('domain_scores'),
  topScore: integer('top_score').notNull().default(0),
  status: text('status', { enum: ['raw', 'curated'] }).notNull().default('raw'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
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
