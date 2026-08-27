/**
 * Client-safe billing list prices and plan quotas.
 * No db / node imports — safe for `'use client'` modules.
 */

export const TIER_PRICES = { free: 0, builder: 19, factory: 49 } as const;

/** Annual list prices: two months free vs paying monthly. */
export const TIER_PRICES_ANNUAL = { builder: 190, factory: 490 } as const;

export type Tier = keyof typeof TIER_PRICES;

/** Plans per month per tier (§1.4). */
const TIER_QUOTAS: Record<Tier, number> = { free: 3, builder: 30, factory: 100 };

/** Canonical tier → monthly plan quota. */
export function quotaFor(tier: Tier): number {
  return TIER_QUOTAS[tier];
}
