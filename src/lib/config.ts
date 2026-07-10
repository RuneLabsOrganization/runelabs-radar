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
    return process.env.MINIMAX_MODEL ?? 'MiniMax-M2';
  },
  get minimaxDailyCallCap(): number {
    return Number(process.env.MINIMAX_DAILY_CALL_CAP ?? 500);
  },
  get aaApiKey(): string {
    return process.env.AA_API_KEY ?? '';
  },
  /** PUBLIC_MODE=true lets anonymous visitors read the hub (no votes/verdicts/admin). */
  get publicMode(): boolean {
    return process.env.PUBLIC_MODE === 'true';
  },
};
