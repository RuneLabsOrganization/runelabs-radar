import fs from 'node:fs';
import path from 'node:path';

/**
 * Instance identity — what makes a Radar deployment YOURS.
 *
 * Everything the LLM prompts and the UI say about the operating org comes
 * from here. Defaults are the Runelabs values; override any subset with a
 * `radar.config.json` in the project root (path overridable via RADAR_CONFIG).
 * Self-hosters: copy radar.config.example.json, describe YOUR operation, and
 * the curation brain, briefs, opportunity scout and stack advisor all speak
 * in your context.
 */

export interface VentureDef {
  slug: string;
  label: string;
  hint: string;
}

export interface Identity {
  /** Org name shown in prompts and the UI ("Runelabs"). */
  brandName: string;
  /** Product name in the header/metadata ("Runelabs Radar"). */
  productName: string;
  /**
   * One-paragraph description of the operator injected into every LLM prompt —
   * this is the calibration context: what you build, sell, and care about.
   */
  brandContext: string;
  /** H1 prefix for the daily brief ("Runelabs Morning Brief"). */
  briefTitle: string;
  /** Venture archetypes for the stacks playbook job; null = built-in defaults. */
  ventures: VentureDef[] | null;
}

const DEFAULTS: Identity = {
  brandName: 'Runelabs',
  productName: 'Runelabs Radar',
  brandContext:
    'Runelabs — a vibecoding startup farm that ships many small AI-powered products fast',
  briefTitle: 'Runelabs Morning Brief',
  ventures: null,
};

let cached: Identity | null = null;

export function getIdentity(): Identity {
  if (cached) return cached;
  const file = process.env.RADAR_CONFIG ?? path.resolve(process.cwd(), 'radar.config.json');
  let overrides: Partial<Identity> = {};
  try {
    if (fs.existsSync(file)) {
      overrides = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Identity>;
    }
  } catch {
    // malformed config — fall back to defaults rather than crash a job
  }
  cached = { ...DEFAULTS, ...overrides };
  return cached;
}

/** Test hook: reset the cached identity after changing RADAR_CONFIG. */
export function _resetIdentity(): void {
  cached = null;
}
