export const config = {
  get databasePath(): string {
    return process.env.DATABASE_PATH ?? './data/radar.db';
  },
  get sessionSecret(): string {
    const s = process.env.SESSION_SECRET;
    if (!s && process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET is required in production');
    }
    return s ?? 'dev-secret-do-not-use-in-prod';
  },
  get minimaxApiKey(): string {
    return process.env.MINIMAX_API_KEY ?? '';
  },
  get minimaxBaseUrl(): string {
    return process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/v1';
  },
  get minimaxModel(): string {
    return process.env.MINIMAX_MODEL ?? 'MiniMax-M3';
  },
  get minimaxDailyCallCap(): number {
    return Number(process.env.MINIMAX_DAILY_CALL_CAP ?? 500);
  },
  /** Per-job daily cap for the high-volume curation job — keeps it from starving the others. */
  get minimaxCurateDailyCap(): number {
    return Number(process.env.MINIMAX_CURATE_DAILY_CAP ?? 400);
  },
  get aaApiKey(): string {
    return process.env.AA_API_KEY ?? '';
  },
  /** Brave Search API key — enables the brave news-search ingest adapter. */
  get braveApiKey(): string {
    return process.env.BRAVE_API_KEY ?? '';
  },
  /** PUBLIC_MODE=true lets anonymous visitors read the hub (no votes/verdicts/admin). */
  get publicMode(): boolean {
    return process.env.PUBLIC_MODE === 'true';
  },
  /**
   * AA_PUBLIC=true shows Artificial Analysis-derived sections to anonymous
   * visitors. Default false: AA's terms treat republication as data
   * redistribution (requires a commercial agreement). Logged-in team members
   * always see them.
   */
  get aaPublic(): boolean {
    return process.env.AA_PUBLIC === 'true';
  },
  /** Canonical public URL — used for metadataBase, sitemap, OG, MCP attribution. */
  get siteUrl(): string {
    return process.env.SITE_URL ?? 'http://localhost:3000';
  },
  /** Optional: raises GitHub API rate limits for the velocity job. */
  get githubToken(): string {
    return process.env.GITHUB_TOKEN ?? '';
  },
  /** Optional: enables the Product Hunt launch adapter. */
  get phToken(): string {
    return process.env.PH_TOKEN ?? '';
  },
  /**
   * RADAR_SCORE_CONSUMERS=true flips ranking surfaces (board prompt order,
   * plan market grounding, get_market_models sort:'value') from AA
   * intelligence to our own Radar Score composite (§6e). Default OFF while
   * the v1 weights calibrate against AA via the aa_divergence series — the
   * score pipeline itself (rollup + composite + divergence) always runs.
   */
  get radarScoreConsumers(): boolean {
    return process.env.RADAR_SCORE_CONSUMERS === 'true';
  },
  /** Where the local embedding model weights are cached (persist on a volume). */
  get transformersCache(): string {
    return process.env.TRANSFORMERS_CACHE ?? '.hfcache';
  },
};
