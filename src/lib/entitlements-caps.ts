/**
 * Client-safe tier capability caps.
 * No db / node imports — safe for `'use client'` modules.
 */
import type { Tier } from './billing-prices';

export const TIER_CAPS: Record<
  Tier,
  {
    plansPerMonth: number;
    debatesPerMonth: number;
    asksPerMonth: number; // -1 = unlimited; ask_radar synthesis
    workspaceBatches: number; // -1 = unlimited
    batchRuns: boolean;
    personalize: boolean;
    leadRefinesPerMonth: number; // -1 = unlimited; Rung 1
    forgesPerMonth: number; // 0 = unavailable; Rung 2 (4 llm calls each)
  }
> = {
  free: {
    plansPerMonth: 3,
    debatesPerMonth: 3,
    asksPerMonth: 10,
    workspaceBatches: 1,
    batchRuns: false,
    personalize: false,
    leadRefinesPerMonth: 3,
    forgesPerMonth: 0,
  },
  builder: {
    plansPerMonth: 30,
    debatesPerMonth: -1,
    asksPerMonth: 100,
    workspaceBatches: 10,
    batchRuns: true,
    personalize: true,
    leadRefinesPerMonth: 50,
    forgesPerMonth: 5,
  },
  factory: {
    plansPerMonth: 100,
    debatesPerMonth: -1,
    asksPerMonth: -1,
    workspaceBatches: -1,
    batchRuns: true,
    personalize: true,
    leadRefinesPerMonth: -1,
    forgesPerMonth: 30,
  },
};
