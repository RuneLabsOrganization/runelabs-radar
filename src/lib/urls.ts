/**
 * Single source of truth for all public hub URLs.
 * MCP payloads, sitemap, RSS, and embeds MUST use these helpers —
 * never hardcode path strings.
 */
import { config } from './config';

function base(): string {
  return config.siteUrl.replace(/\/+$/, '');
}

function abs(path: string): string {
  return `${base()}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Absolute URL builders (for MCP, RSS, OG, sitemap). */
export const urls = {
  home: () => abs('/'),
  mcp: () => abs('/mcp'),
  pricing: () => abs('/pricing'),
  privacy: () => abs('/privacy'),
  terms: () => abs('/terms'),
  trust: () => abs('/trust'),
  changelog: () => abs('/changelog'),
  reports: () => abs('/reports'),
  report: (date: string) => abs(`/reports/${date}`),
  login: (next?: string) => abs(next ? `/login?next=${encodeURIComponent(next)}` : '/login'),
  signup: () => abs('/signup'),
  forgotPassword: () => abs('/forgot-password'),
  resetPassword: () => abs('/reset-password'),

  // App workspaces
  app: () => abs('/app'),
  signal: () => abs('/app'),
  brief: (date?: string) => abs(date ? `/app/brief?date=${date}` : '/app/brief'),
  map: () => abs('/app/map'),
  domain: (slug: string) => abs(`/app/domain/${slug}`),
  search: (q?: string) => abs(q ? `/app/search?q=${encodeURIComponent(q)}` : '/app/search'),
  story: (id: number | string) => abs(`/app/story/${id}`),
  entity: (name: string) => abs(`/app/entity/${encodeURIComponent(name)}`),

  decide: () => abs('/app/decide'),
  tools: (domain?: string) => abs(domain ? `/app/decide/tools?domain=${domain}` : '/app/decide/tools'),
  kits: () => abs('/app/decide/kits'),
  kit: (slug: string) => abs(`/app/decide/kits/${slug}`),
  stacks: () => abs('/app/decide/stacks'),
  agents: () => abs('/app/decide/agents'),
  metrics: () => abs('/app/decide/metrics'),

  build: () => abs('/app/build'),
  opportunities: () => abs('/app/build/opportunities'),
  opportunity: (idOrSlug: number | string) => abs(`/app/build/opportunities/${idOrSlug}`),
  batches: () => abs('/app/build/batches'),
  batch: (slug: string) => abs(`/app/build/batches/${slug}`),
  debates: () => abs('/app/build/debates'),

  connect: () => abs('/app/connect'),
  account: () => abs('/app/account'),
  admin: () => abs('/app/admin'),
  adminUsage: () => abs('/app/admin/usage'),
} as const;

/** Relative path builders (for Next.js <Link> hrefs). */
export const paths = {
  home: '/',
  mcp: '/mcp',
  pricing: '/pricing',
  privacy: '/privacy',
  terms: '/terms',
  trust: '/trust',
  changelog: '/changelog',
  reports: '/reports',
  report: (date: string) => `/reports/${date}`,
  login: '/login',
  signup: '/signup',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',

  app: '/app',
  signal: '/app',
  brief: '/app/brief',
  map: '/app/map',
  domain: (slug: string) => `/app/domain/${slug}`,
  search: '/app/search',
  story: (id: number | string) => `/app/story/${id}`,
  entity: (name: string) => `/app/entity/${encodeURIComponent(name)}`,

  decide: '/app/decide',
  tools: '/app/decide/tools',
  kits: '/app/decide/kits',
  kit: (slug: string) => `/app/decide/kits/${slug}`,
  stacks: '/app/decide/stacks',
  agents: '/app/decide/agents',
  metrics: '/app/decide/metrics',

  build: '/app/build',
  opportunities: '/app/build/opportunities',
  opportunity: (idOrSlug: number | string) => `/app/build/opportunities/${idOrSlug}`,
  batches: '/app/build/batches',
  batch: (slug: string) => `/app/build/batches/${slug}`,
  debates: '/app/build/debates',

  connect: '/app/connect',
  account: '/app/account',
  admin: '/app/admin',
  adminUsage: '/app/admin/usage',
} as const;

/** After signup, send a priced plan intent to account auto-checkout. */
export function accountCheckoutPath(plan: 'builder' | 'factory', annual: boolean): string {
  return `${paths.account}?checkout=${plan}&annual=${annual ? 1 : ''}`;
}

/** Same-origin relative path only. Rejects protocol-relative and absolute URLs. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return paths.app;
  return next;
}

/** Signup “Sign in” link: carry paid-plan checkout intent via `next`. */
export function loginHrefForSignup(plan: string | null, interval?: string | null): string {
  if (plan === 'builder' || plan === 'factory') {
    const next = accountCheckoutPath(plan, interval === 'annual');
    return `${paths.login}?next=${encodeURIComponent(next)}`;
  }
  return paths.login;
}

/** Login “Create a free account”: keep plan/interval, or reconstruct from checkout `next`. */
export function signupHrefFromLogin(
  plan: string | null,
  interval: string | null,
  next: string | null,
): string {
  if (plan === 'builder' || plan === 'factory') {
    return `${paths.signup}?plan=${plan}&interval=${interval === 'annual' ? 'annual' : 'monthly'}`;
  }
  const safe = safeNextPath(next);
  if (safe.startsWith(`${paths.account}?checkout=`)) {
    try {
      const u = new URL(safe, 'http://local.invalid');
      const checkout = u.searchParams.get('checkout');
      if (checkout === 'builder' || checkout === 'factory') {
        const annual = u.searchParams.get('annual') === '1';
        return `${paths.signup}?plan=${checkout}&interval=${annual ? 'annual' : 'monthly'}`;
      }
    } catch {
      /* fall through */
    }
  }
  return paths.signup;
}

/**
 * Old → new permanent redirects. Used by next.config.ts and the redirect
 * assertion test. Keep in sync with the IA consolidation map.
 */
export const REDIRECTS: { source: string; destination: string; permanent: boolean }[] = [
  { source: '/board', destination: '/app/decide/tools', permanent: true },
  { source: '/stacks', destination: '/app/decide/stacks', permanent: true },
  { source: '/agent-stacks', destination: '/app/decide/agents', permanent: true },
  { source: '/agent-plans', destination: '/app/decide/agents', permanent: true },
  { source: '/metrics', destination: '/app/decide/metrics', permanent: true },
  { source: '/opportunities', destination: '/app/build/opportunities', permanent: true },
  { source: '/opportunities/:id', destination: '/app/build/opportunities/:id', permanent: true },
  { source: '/map', destination: '/app/map', permanent: true },
  { source: '/brief', destination: '/app/brief', permanent: true },
  { source: '/search', destination: '/app/search', permanent: true },
  { source: '/domain/:slug', destination: '/app/domain/:slug', permanent: true },
  { source: '/story/:id', destination: '/app/story/:id', permanent: true },
  { source: '/entity/:name', destination: '/app/entity/:name', permanent: true },
  { source: '/connect', destination: '/app/connect', permanent: true },
  { source: '/accuracy', destination: '/trust', permanent: true },
  { source: '/admin', destination: '/app/admin', permanent: true },
  { source: '/admin/usage', destination: '/app/admin/usage', permanent: true },
  // Today dashboard moves under /app; marketing owns /
  { source: '/today', destination: '/app', permanent: true },
];
