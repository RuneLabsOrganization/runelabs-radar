import { describe, expect, it } from 'vitest';
import {
  REDIRECTS,
  accountCheckoutPath,
  loginHrefForSignup,
  paths,
  safeNextPath,
  signupHrefFromLogin,
  urls,
} from '../src/lib/urls';

describe('urls route module', () => {
  it('exports absolute and relative builders for every workspace', () => {
    expect(paths.app).toBe('/app');
    expect(paths.tools).toBe('/app/decide/tools');
    expect(paths.opportunities).toBe('/app/build/opportunities');
    expect(paths.connect).toBe('/app/connect');
    expect(paths.trust).toBe('/trust');
    expect(paths.mcp).toBe('/mcp');
    expect(urls.story(42)).toMatch(/\/app\/story\/42$/);
    expect(urls.opportunity('bulk-bg')).toMatch(/\/app\/build\/opportunities\/bulk-bg$/);
    expect(urls.entity('Claude')).toMatch(/\/app\/entity\//);
  });

  it('builds the post-signup auto-checkout account path', () => {
    expect(accountCheckoutPath('builder', false)).toBe('/app/account?checkout=builder&annual=');
    expect(accountCheckoutPath('factory', true)).toBe('/app/account?checkout=factory&annual=1');
  });

  it('covers every legacy hub path with a permanent redirect', () => {
    const sources = REDIRECTS.map((r) => r.source);
    for (const needed of [
      '/board',
      '/stacks',
      '/agent-stacks',
      '/agent-plans',
      '/metrics',
      '/opportunities',
      '/opportunities/:id',
      '/map',
      '/brief',
      '/search',
      '/domain/:slug',
      '/story/:id',
      '/entity/:name',
      '/connect',
      '/accuracy',
      '/admin',
      '/admin/usage',
    ]) {
      expect(sources).toContain(needed);
    }
    expect(REDIRECTS.every((r) => r.permanent)).toBe(true);
  });

  it('never redirects public marketing destinations away from themselves', () => {
    const dests = REDIRECTS.map((r) => r.destination);
    expect(dests).not.toContain('/');
    expect(dests).not.toContain('/pricing');
    expect(dests).not.toContain('/mcp');
  });
});

describe('safeNextPath', () => {
  it('allows same-origin relative paths', () => {
    expect(safeNextPath('/app')).toBe('/app');
    expect(safeNextPath('/app/account?checkout=builder&annual=1')).toBe(
      '/app/account?checkout=builder&annual=1',
    );
  });

  it('rejects open redirects and missing values', () => {
    expect(safeNextPath(null)).toBe(paths.app);
    expect(safeNextPath('https://evil.example/phish')).toBe(paths.app);
    expect(safeNextPath('//evil.example/phish')).toBe(paths.app);
    expect(safeNextPath('app')).toBe(paths.app);
  });
});

describe('loginHrefForSignup', () => {
  it('sends priced-plan signup to login with encoded checkout next', () => {
    expect(loginHrefForSignup('builder', 'monthly')).toBe(
      `/login?next=${encodeURIComponent(accountCheckoutPath('builder', false))}`,
    );
    expect(loginHrefForSignup('factory', 'annual')).toBe(
      `/login?next=${encodeURIComponent(accountCheckoutPath('factory', true))}`,
    );
  });

  it('keeps bare login when there is no paid plan', () => {
    expect(loginHrefForSignup(null)).toBe(paths.login);
    expect(loginHrefForSignup('free')).toBe(paths.login);
  });
});

describe('signupHrefFromLogin', () => {
  it('preserves plan and interval query params', () => {
    expect(signupHrefFromLogin('builder', 'annual', null)).toBe('/signup?plan=builder&interval=annual');
    expect(signupHrefFromLogin('factory', 'monthly', null)).toBe('/signup?plan=factory&interval=monthly');
  });

  it('reconstructs plan intent from a checkout next path', () => {
    expect(signupHrefFromLogin(null, null, accountCheckoutPath('builder', true))).toBe(
      '/signup?plan=builder&interval=annual',
    );
  });

  it('falls back to signup with no plan', () => {
    expect(signupHrefFromLogin(null, null, '/app')).toBe(paths.signup);
    expect(signupHrefFromLogin(null, null, 'https://evil.example')).toBe(paths.signup);
  });
});
