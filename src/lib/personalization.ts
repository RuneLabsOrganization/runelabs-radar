/**
 * Personalization helpers (Phase 9f) — profile read/write + fit-score for
 * opportunity / scout ranking when Builder+ personalize entitlement is on.
 */
import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { agentSessions, userProfiles } from './db/schema';

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export interface UserProfile {
  skills: string[];
  interests: string[];
  capitalBand: 'bootstrap' | 'small' | 'comfortable' | 'funded' | null;
  avoidedSectors: string[];
  updatedAt: string;
}

export interface AgentSessionMemory {
  lastProject: string | null;
  lastOpportunity: string | null;
  watchTopics: string[];
  updatedAt: string;
}

const CAPITAL_BANDS = new Set(['bootstrap', 'small', 'comfortable', 'funded']);

export function getProfile(userId: number): UserProfile | null {
  const row = getDb().select().from(userProfiles).where(eq(userProfiles.userId, userId)).get();
  if (!row) return null;
  const band =
    row.capitalBand && CAPITAL_BANDS.has(row.capitalBand)
      ? (row.capitalBand as UserProfile['capitalBand'])
      : null;
  return {
    skills: parseJson<string[]>(row.skills, []),
    interests: parseJson<string[]>(row.interests, []),
    capitalBand: band,
    avoidedSectors: parseJson<string[]>(row.avoidedSectors, []),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function setProfile(
  userId: number,
  patch: {
    skills?: string[];
    interests?: string[];
    capitalBand?: UserProfile['capitalBand'];
    avoidedSectors?: string[];
  },
): UserProfile {
  const db = getDb();
  const now = new Date();
  const prior = getProfile(userId);
  const next = {
    skills: patch.skills ?? prior?.skills ?? [],
    interests: patch.interests ?? prior?.interests ?? [],
    capitalBand: patch.capitalBand !== undefined ? patch.capitalBand : (prior?.capitalBand ?? null),
    avoidedSectors: patch.avoidedSectors ?? prior?.avoidedSectors ?? [],
  };
  const values = {
    skills: JSON.stringify(next.skills.slice(0, 20)),
    interests: JSON.stringify(next.interests.slice(0, 20)),
    capitalBand: next.capitalBand,
    avoidedSectors: JSON.stringify(next.avoidedSectors.slice(0, 20)),
    updatedAt: now,
  };
  if (prior) {
    db.update(userProfiles).set(values).where(eq(userProfiles.userId, userId)).run();
  } else {
    db.insert(userProfiles).values({ userId, ...values }).run();
  }
  return { ...next, updatedAt: now.toISOString() };
}

export function getSession(userId: number): AgentSessionMemory | null {
  const row = getDb().select().from(agentSessions).where(eq(agentSessions.userId, userId)).get();
  if (!row) return null;
  return {
    lastProject: row.lastProject,
    lastOpportunity: row.lastOpportunity,
    watchTopics: parseJson<string[]>(row.watchTopics, []),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function setSession(
  userId: number,
  patch: {
    lastProject?: string | null;
    lastOpportunity?: string | null;
    watchTopics?: string[];
  },
): AgentSessionMemory {
  const db = getDb();
  const now = new Date();
  const prior = getSession(userId);
  const next = {
    lastProject: patch.lastProject !== undefined ? patch.lastProject : (prior?.lastProject ?? null),
    lastOpportunity:
      patch.lastOpportunity !== undefined ? patch.lastOpportunity : (prior?.lastOpportunity ?? null),
    watchTopics: patch.watchTopics ?? prior?.watchTopics ?? [],
  };
  const values = {
    lastProject: next.lastProject,
    lastOpportunity: next.lastOpportunity,
    watchTopics: JSON.stringify(next.watchTopics.slice(0, 20)),
    updatedAt: now,
  };
  if (prior) {
    db.update(agentSessions).set(values).where(eq(agentSessions.userId, userId)).run();
  } else {
    db.insert(agentSessions).values({ userId, ...values }).run();
  }
  return { ...next, updatedAt: now.toISOString() };
}

/**
 * Whole-token match: `needle` must appear in `haystack` (both already
 * lowercased) bounded by non-word characters — not as a raw substring. This
 * is what keeps 3-char skills honest: "go" no longer matches "governance",
 * "gen" no longer matches "generator". Lookarounds instead of \b so needles
 * with non-word edges ("c++", "node.js") still match.
 */
export function tokenMatch(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w])${escaped}(?![\\w])`).test(haystack);
}

/** Largest bonus the terms below can actually sum to (12+3+4+5+4). */
export const FIT_BONUS_MAX = 28;

/**
 * Fit score added to flip for ordering only; range [−40, FIT_BONUS_MAX]
 * (−40 avoided-sector veto … +28 everything aligned). Interests matching
 * sector boost; avoided sectors penalize hard; skills/watch-tokens overlapping
 * the thesis (whole tokens only) boost lightly.
 */
export function fitBonus(
  profile: UserProfile | null,
  session: AgentSessionMemory | null,
  opp: { sector: string | null; thesis: string; title: string; slug: string },
): number {
  if (!profile && !session) return 0;
  let bonus = 0;
  const sector = (opp.sector ?? '').toLowerCase();
  const hay = `${opp.title} ${opp.thesis}`.toLowerCase();

  if (profile) {
    if (sector && profile.avoidedSectors.some((s) => s.toLowerCase() === sector)) return -40;
    if (
      sector &&
      profile.interests.some((i) => i.toLowerCase() === sector || sector.includes(i.toLowerCase()))
    ) {
      bonus += 12;
    }
    for (const skill of profile.skills) {
      if (skill.length >= 3 && tokenMatch(hay, skill.toLowerCase())) {
        bonus += 3;
        break;
      }
    }
  }

  if (session) {
    if (session.lastOpportunity && session.lastOpportunity === opp.slug) bonus += 4;
    for (const t of session.watchTopics) {
      if (t.length >= 3 && (tokenMatch(hay, t.toLowerCase()) || sector.includes(t.toLowerCase()))) {
        bonus += 5;
        break;
      }
    }
    if (session.lastProject) {
      const tokens = session.lastProject
        .toLowerCase()
        .split(/\W+/)
        .filter((t) => t.length > 3);
      if (tokens.some((t) => tokenMatch(hay, t))) bonus += 4;
    }
  }

  return Math.min(FIT_BONUS_MAX, bonus);
}
