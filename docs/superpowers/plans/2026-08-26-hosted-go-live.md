# Hosted Radar Go-Live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make radar.runelabs.org a hosted commercial product: Terms/Privacy, Stripe monthly+annual checkout and portal, Resend password reset, Google/GitHub login, cookie-gated Plausible+Sentry, SEO, and an 8/8 indie-dev kit.

**Architecture:** Finish the Better Auth Stripe plugin already in `src/lib/auth/better-auth.ts`; add Resend via Better Auth email hooks; consent cookie gates client telemetry; editorial kit cells go through `applyProposal()` so `kit_picks` history stays honest. MiniMax billing is unchanged.

**Tech Stack:** Next.js 15 App Router, Better Auth 1.7 + `@better-auth/stripe`, Stripe SDK 22, Resend, `@sentry/nextjs`, Plausible script, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-26-hosted-go-live-design.md`

## Global Constraints

- Never commit or paste `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, OAuth secrets, or Sentry DSNs. `.env.example` gets empty placeholders only.
- MiniMax stays on the current subscription key. No PAYG work.
- Team seats are out of scope. Do not re-add “coming” copy.
- Kit seed writes **only** through `applyProposal()` (insert a pending `board_proposals` row, then apply). Do not `INSERT INTO kit_picks` from the seed script.
- `requireEmailVerification` stays `false`. Send verification mail; do not block login.
- Client Sentry and Plausible load only after the matching consent flags. Server Sentry may always run.
- Annual list prices are $190 (Builder) and $490 (Factory). Monthly stays $19 / $49. Quotas do not change with interval.
- Support and From address: `hello@runelabs.org`.
- After each task: `npx vitest run <that test file>` green, then `npx tsc --noEmit` must introduce no new errors.

---

## File structure (locked)

```
docs/superpowers/specs/2026-08-26-hosted-go-live-design.md   (already written)
src/lib/billing.ts                 + TIER_PRICES_ANNUAL
src/lib/consent.ts                 NEW  parse/serialize radar_consent
src/lib/email.ts                   NEW  Resend wrapper
src/lib/seo.ts                     NEW  siteMeta + landing JSON-LD
src/lib/urls.ts                    + privacy, terms, kits, kit(), forgotPassword, resetPassword
src/lib/nav.ts                     + Kits tab; footer legal is in layouts
src/lib/auth/better-auth.ts        + Resend hooks (Stripe/social already present)
src/lib/auth/client.ts             + stripeClient plugin
src/components/account/CheckoutButtons.tsx   plan + annual
src/components/account/BillingPortalButton.tsx  NEW
src/components/auth/SocialButtons.tsx         NEW
src/components/consent/CookieBanner.tsx       NEW
src/components/consent/ConsentScripts.tsx     NEW
src/app/(site)/privacy/page.tsx               NEW
src/app/(site)/terms/page.tsx                 NEW
src/app/(site)/forgot-password/page.tsx       NEW
src/app/(site)/reset-password/page.tsx        NEW
src/app/(site)/layout.tsx          header CTA + footer legal
src/app/layout.tsx                 CookieBanner + ConsentScripts
src/app/(site)/pricing/page.tsx    annual toggle, honest copy, per-card checkout
src/app/(site)/signup/page.tsx     agree checkbox, social, plan query
src/app/(site)/login/page.tsx      social + forgot link; split server/client
src/app/app/account/page.tsx       portal + auto-checkout query
src/app/app/decide/kits/*.tsx      use paths.kits
src/app/sitemap.ts / robots.ts     legal + kits; noindex oauth
scripts/stripe-setup.ts            NEW
scripts/seed-kit-infra.ts          NEW
sentry.server.config.ts            NEW
sentry.edge.config.ts              NEW
sentry.client.config.ts            NEW
next.config.ts                     withSentryConfig
.env.example / README.md           env + ops
tests/consent.test.ts              NEW
tests/seo.test.ts                  NEW
tests/billing.test.ts              + annual constants
tests/board-apply.test.ts          + infra cell mirror (if not already covered)
```

---

### Task 1: URL helpers, annual prices, Decide Kits nav

**Files:**
- Modify: `src/lib/urls.ts`
- Modify: `src/lib/nav.ts`
- Modify: `src/lib/billing.ts`
- Modify: `tests/billing.test.ts`
- Modify: `src/app/app/decide/kits/page.tsx`
- Modify: `src/app/app/decide/kits/[persona]/page.tsx`

**Interfaces:**
- Consumes: existing `paths` / `urls` / `TIER_PRICES`
- Produces: `paths.privacy`, `paths.terms`, `paths.kits`, `paths.kit(slug)`, `paths.forgotPassword`, `paths.resetPassword`; `urls` equivalents; `TIER_PRICES_ANNUAL = { builder: 190, factory: 490 }`

- [ ] **Step 1: Write the failing test**

Add to `tests/billing.test.ts` after the `quotaFor` describe:

```ts
import { TIER_PRICES, TIER_PRICES_ANNUAL } from '@/lib/billing';

describe('TIER_PRICES_ANNUAL', () => {
  it('is two months free vs monthly', () => {
    expect(TIER_PRICES.builder * 10).toBe(TIER_PRICES_ANNUAL.builder);
    expect(TIER_PRICES.factory * 10).toBe(TIER_PRICES_ANNUAL.factory);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/billing.test.ts`
Expected: FAIL — `TIER_PRICES_ANNUAL` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/billing.ts` next to `TIER_PRICES`:

```ts
/** Annual list prices: two months free vs paying monthly. */
export const TIER_PRICES_ANNUAL = { builder: 190, factory: 490 } as const;
```

Update the file comment: Stripe checkout is in this go-live; prices are no longer “placeholders until 8c”.

In `src/lib/urls.ts` add to both `urls` and `paths`:

```ts
privacy: '/privacy',           // urls.privacy: () => abs('/privacy')
terms: '/terms',
forgotPassword: '/forgot-password',
resetPassword: '/reset-password',
kits: '/app/decide/kits',      // urls.kits: () => abs('/app/decide/kits')
kit: (slug: string) => `/app/decide/kits/${slug}`,
```

In `src/lib/nav.ts` Decide `tabs`, insert after Best tools:

```ts
{ href: paths.kits, label: 'Kits' },
```

Replace hardcoded `/app/decide/kits` links in the two kits pages with `paths.kits` / `paths.kit(p.slug)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/billing.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/billing.ts src/lib/urls.ts src/lib/nav.ts src/app/app/decide/kits tests/billing.test.ts
git commit -m "feat: annual prices, legal/kit URL helpers, Kits nav tab"
```

---

### Task 2: Privacy + Terms pages and footer/signup links

**Files:**
- Create: `src/app/(site)/privacy/page.tsx`
- Create: `src/app/(site)/terms/page.tsx`
- Modify: `src/app/(site)/layout.tsx`
- Modify: `src/app/app/layout.tsx`
- Modify: `src/app/(site)/signup/page.tsx`

**Interfaces:**
- Consumes: `paths.privacy`, `paths.terms` from Task 1
- Produces: public `/privacy` and `/terms`; footer links; signup cannot submit without agree checkbox

- [ ] **Step 1: Write the pages**

Use `export const metadata = { title: 'Privacy', description: '...' }` and `title: 'Terms'`.

Layout: `mx-auto max-w-[720px] px-4 py-12` + `type-h1` + `text-[14px] leading-relaxed text-ink-2` paragraphs. No new component library.

**Privacy must include these sections (H2s):** What we collect; What we do not collect; Payments (Stripe — we never see card numbers); Cookies (session necessary; analytics and error reporting opt-in); MCP tokens; Retention; Subprocessors (MiniMax, Stripe, Resend, Plausible, Sentry, Google/GitHub if you use OAuth); Contact `hello@runelabs.org`; this notice is operator-drafted, not a substitute for counsel.

**Terms must include:** Hosted service vs BSL 1.1 self-host; free vs paid artifact quotas, not an uptime SLA; picks and kits are dated opinions, not warranties; LLM plans/debates can be wrong; you own your prompts, we may use aggregated telemetry; Stripe billing, cancel anytime, no prorated refund on the current period unless law requires; abuse/suspension; MiniMax as model provider; contact `hello@runelabs.org`.

Full prose: follow `docs/superpowers/specs/2026-08-26-hosted-go-live-design.md` Wave 1. Write in the site’s voice (short, specific). Do not invent affiliate programs or SLAs.

- [ ] **Step 2: Footer + header legal**

In both site and app footers, add after Self-host / SITE_LINKS:

```tsx
<Link href={paths.privacy}>Privacy</Link>
<Link href={paths.terms}>Terms</Link>
<a href="mailto:hello@runelabs.org">hello@runelabs.org</a>
```

Site header (`src/app/(site)/layout.tsx`): this layout is a server component. Import `getCurrentUser` from `@/lib/auth/user`. If `user` is null, primary button is `<Link href={paths.signup}>Start free</Link>`; else `<Link href={paths.app}>Open the app</Link>`. Keep Sign in as the quiet text link for anonymous only.

- [ ] **Step 3: Signup agree checkbox**

On `src/app/(site)/signup/page.tsx` add state `agreed`. Checkbox + labels linking to Terms and Privacy. Submit `disabled={pending || !agreed}`. Do not create the account unless `agreed` is true (client-side is enough; this is UX not a security boundary).

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors. Spot-check `/privacy` and `/terms` in `npm run dev`.

- [ ] **Step 5: Commit**

```bash
git add src/app/(site)/privacy src/app/(site)/terms src/app/(site)/layout.tsx src/app/app/layout.tsx src/app/(site)/signup/page.tsx
git commit -m "feat: privacy, terms, signup agreement, support footer"
```

---

### Task 3: Pricing honesty + annual toggle + checkout button API

**Files:**
- Modify: `src/app/(site)/pricing/page.tsx`
- Modify: `src/components/account/CheckoutButtons.tsx`

**Interfaces:**
- Consumes: `TIER_PRICES`, `TIER_PRICES_ANNUAL`
- Produces: `CheckoutButtons({ plan: 'builder' | 'factory', annual?: boolean })` — one plan per instance. Logged-out fallback `/signup?plan=&interval=monthly|annual`.

- [ ] **Step 1: Rewrite CheckoutButtons**

```tsx
'use client';

import { paths } from '@/lib/urls';
import { TIER_PRICES, TIER_PRICES_ANNUAL } from '@/lib/billing';
import { Button } from '@/components/ui/button';

export function CheckoutButtons({
  plan,
  annual = false,
}: {
  plan: 'builder' | 'factory';
  annual?: boolean;
}) {
  const price = annual ? TIER_PRICES_ANNUAL[plan] : TIER_PRICES[plan];
  const suffix = annual ? '/yr' : '/mo';

  async function upgrade() {
    try {
      const { authClient } = await import('@/lib/auth/client');
      const client = authClient as {
        subscription?: {
          upgrade: (opts: {
            plan: string;
            annual?: boolean;
            successUrl: string;
            cancelUrl: string;
          }) => Promise<{ error?: { message?: string } }>;
        };
      };
      if (client.subscription?.upgrade) {
        const result = await client.subscription.upgrade({
          plan,
          annual,
          successUrl: `${window.location.origin}${paths.account}?upgraded=1`,
          cancelUrl: `${window.location.origin}${paths.pricing}`,
        });
        if (!result?.error) return;
      }
    } catch {
      /* fall through */
    }
    const interval = annual ? 'annual' : 'monthly';
    window.location.href = `${paths.signup}?plan=${plan}&interval=${interval}`;
  }

  const label = plan === 'builder' ? 'Builder' : 'Factory';
  return (
    <Button className="w-full" onClick={() => void upgrade()}>
      Choose {label} · ${price}
      {suffix}
    </Button>
  );
}
```

- [ ] **Step 2: Pricing page**

Make the page a client wrapper for the interval toggle (`'use client'` on a small `PricingCards` child; keep `metadata` in the server page file by splitting `pricing-cards.tsx`).

- Remove “Team seats (coming)” from Factory highlights. Replace with “Everything Builder has, at Factory quotas”.
- Monthly / Annual segmented control at the top of the grid (site `readout` style). Annual caption: “Two months free”.
- Free card: `Start free` → `paths.signup`.
- Builder card: `<CheckoutButtons plan="builder" annual={annual} />` only.
- Factory card: `<CheckoutButtons plan="factory" annual={annual} />` only. No `paths.account` link.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors. `/pricing` shows one CTA per paid card.

- [ ] **Step 4: Commit**

```bash
git add src/components/account/CheckoutButtons.tsx src/app/(site)/pricing
git commit -m "feat: annual pricing toggle and per-plan checkout CTAs"
```

---

### Task 4: Stripe client plugin, portal, post-signup checkout

**Files:**
- Modify: `src/lib/auth/client.ts`
- Create: `src/components/account/BillingPortalButton.tsx`
- Modify: `src/app/app/account/page.tsx`
- Create: `scripts/stripe-setup.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: Better Auth stripe plugin (server already)
- Produces: working `authClient.subscription.upgrade` / `billingPortal` when env is set; setup script that prints price ids

- [ ] **Step 1: Client plugin**

```ts
// src/lib/auth/client.ts
import { createAuthClient } from 'better-auth/react';
import { stripeClient } from '@better-auth/stripe/client';

export const authClient = createAuthClient({
  plugins: [stripeClient({ subscription: true })],
});
```

- [ ] **Step 2: Billing portal button**

```tsx
'use client';
import { paths } from '@/lib/urls';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth/client';

export function BillingPortalButton() {
  async function open() {
    const client = authClient as {
      subscription?: {
        billingPortal: (opts: { returnUrl: string }) => Promise<unknown>;
      };
    };
    if (client.subscription?.billingPortal) {
      await client.subscription.billingPortal({
        returnUrl: `${window.location.origin}${paths.account}`,
      });
      return;
    }
    window.location.href = paths.pricing;
  }
  return (
    <Button variant="outline" size="sm" onClick={() => void open()}>
      Manage billing
    </Button>
  );
}
```

On account page: if `ent.tier === 'free'`, show `<CheckoutButtons plan="builder" />` and `<CheckoutButtons plan="factory" />` (or a short “Upgrade” pair). If paid, show `<BillingPortalButton />` instead of the Link to pricing.

Add a tiny client `AutoCheckout` on the account page: if searchParams `checkout=builder|factory` and optional `annual=1`, call `upgrade` once on mount then `router.replace(paths.account)`.

Signup: after success, if `plan` query present, `router.push(`${paths.account}?checkout=${plan}&annual=${interval==='annual'?1:''}`)`.

- [ ] **Step 3: Setup script**

`scripts/stripe-setup.ts` — `tsx` entry. Read `STRIPE_SECRET_KEY`. Use Stripe SDK to find-or-create products named `Radar Builder` and `Radar Factory`, then monthly + yearly prices ($19, $190, $49, $490; currency `usd`). Log:

```
STRIPE_PRICE_BUILDER=price_...
STRIPE_PRICE_BUILDER_ANNUAL=price_...
STRIPE_PRICE_FACTORY=price_...
STRIPE_PRICE_FACTORY_ANNUAL=price_...
```

Do not print the secret. Exit 1 if key missing.

Document in `.env.example` (empty values) plus:

```
# STRIPE_WEBHOOK_SECRET=   webhook URL: https://<host>/api/auth/stripe/webhook
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors. Do **not** run the setup script in CI.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/client.ts src/components/account src/app/app/account/page.tsx src/app/(site)/signup/page.tsx scripts/stripe-setup.ts .env.example
git commit -m "feat: Stripe client plugin, billing portal, product setup script"
```

---

### Task 5: Resend + forgot/reset password

**Files:**
- Create: `src/lib/email.ts`
- Modify: `src/lib/auth/better-auth.ts`
- Create: `src/app/(site)/forgot-password/page.tsx`
- Create: `src/app/(site)/reset-password/page.tsx`
- Modify: `src/app/(site)/login/page.tsx`
- Modify: `package.json` (add `resend`)
- Modify: `.env.example`

**Interfaces:**
- Consumes: Better Auth `emailAndPassword`
- Produces: `sendRadarEmail({ to, subject, html })`; reset + verification mails

- [ ] **Step 1: Install and wrapper**

Run: `npm install resend`

```ts
// src/lib/email.ts
import { Resend } from 'resend';

export function emailFrom(): string {
  return process.env.EMAIL_FROM ?? 'Radar <hello@runelabs.org>';
}

export async function sendRadarEmail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[email] RESEND_API_KEY missing — skip send:', opts.subject);
    return;
  }
  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from: emailFrom(),
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 2: Wire Better Auth**

In `better-auth.ts` `emailAndPassword`:

```ts
emailAndPassword: {
  enabled: true,
  requireEmailVerification: false,
  sendResetPassword: async ({ user, url }) => {
    await sendRadarEmail({
      to: user.email,
      subject: 'Reset your Radar password',
      html: `<p>Reset your password:</p><p><a href="${url}">${url}</a></p>`,
    });
  },
},
emailVerification: {
  sendOnSignUp: true,
  sendVerificationEmail: async ({ user, url }) => {
    await sendRadarEmail({
      to: user.email,
      subject: 'Verify your Radar email',
      html: `<p>Verify your email:</p><p><a href="${url}">${url}</a></p>`,
    });
  },
},
```

Import `sendRadarEmail` from `./email`.

- [ ] **Step 3: Pages**

Forgot: email field → `authClient.requestPasswordReset({ email, redirectTo: paths.resetPassword })`. Success copy: “If that account exists, we sent a link.”

Reset: `authClient.resetPassword({ newPassword, token })` from `useSearchParams().get('token')`. Then push login.

Login form: link “Forgot password?” → `paths.forgotPassword`.

`.env.example`: `RESEND_API_KEY=` and `EMAIL_FROM=Radar <hello@runelabs.org>`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/email.ts src/lib/auth/better-auth.ts src/app/(site)/forgot-password src/app/(site)/reset-password src/app/(site)/login/page.tsx .env.example
git commit -m "feat: Resend password reset and verification email"
```

---

### Task 6: Google + GitHub login buttons

**Files:**
- Create: `src/components/auth/SocialButtons.tsx`
- Modify: `src/app/(site)/login/page.tsx` (server wrapper + client form)
- Modify: `src/app/(site)/signup/page.tsx`
- Modify: `.env.example`

**Interfaces:**
- Consumes: existing `socialProviders` in `better-auth.ts`
- Produces: buttons only when `GOOGLE_CLIENT_ID` / `GITHUB_CLIENT_ID` are set on the server

- [ ] **Step 1: SocialButtons**

```tsx
'use client';
import { authClient } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';

export function SocialButtons({
  google,
  github,
  callbackURL,
}: {
  google: boolean;
  github: boolean;
  callbackURL: string;
}) {
  if (!google && !github) return null;
  return (
    <div className="space-y-2">
      {google && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => void authClient.signIn.social({ provider: 'google', callbackURL })}
        >
          Continue with Google
        </Button>
      )}
      {github && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => void authClient.signIn.social({ provider: 'github', callbackURL })}
        >
          Continue with GitHub
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Pass flags from server pages**

Login and signup currently `'use client'`. Split: `page.tsx` (server) reads:

```ts
const google = Boolean(process.env.GOOGLE_CLIENT_ID);
const github = Boolean(process.env.GITHUB_CLIENT_ID);
```

Pass into the existing client form + `<SocialButtons google={google} github={github} callbackURL={paths.app} />` above the email form, with a “or” divider.

`.env.example`:

```
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=
# Callbacks: https://<host>/api/auth/callback/google  and  .../github
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors. With env unset, no social buttons. With env set locally, buttons render.

- [ ] **Step 4: Commit**

```bash
git add src/components/auth/SocialButtons.tsx src/app/(site)/login src/app/(site)/signup .env.example
git commit -m "feat: Google and GitHub OAuth buttons"
```

---

### Task 7: Cookie consent + Plausible + Sentry

**Files:**
- Create: `src/lib/consent.ts`
- Create: `tests/consent.test.ts`
- Create: `src/components/consent/CookieBanner.tsx`
- Create: `src/components/consent/ConsentScripts.tsx`
- Create: `sentry.server.config.ts`, `sentry.edge.config.ts`, `sentry.client.config.ts`
- Modify: `next.config.ts`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/(site)/layout.tsx` (footer Cookies button)
- Modify: `package.json` (`@sentry/nextjs`)
- Modify: `.env.example`

**Interfaces:**
- Consumes: none
- Produces: `parseConsent` / `serializeConsent`; banner; gated scripts

- [ ] **Step 1: Failing tests**

```ts
// tests/consent.test.ts
import { parseConsent, serializeConsent } from '@/lib/consent';

describe('consent', () => {
  it('round-trips', () => {
    const raw = serializeConsent({ analytics: true, errors: false });
    expect(parseConsent(raw)).toEqual({ analytics: true, errors: false });
  });
  it('returns null for missing or garbage', () => {
    expect(parseConsent(undefined)).toBeNull();
    expect(parseConsent('')).toBeNull();
    expect(parseConsent('not-json')).toBeNull();
    expect(parseConsent('{"analytics":1}')).toBeNull();
  });
});
```

Run: `npx vitest run tests/consent.test.ts` — expected FAIL.

- [ ] **Step 2: Implement consent.ts**

```ts
export type Consent = { analytics: boolean; errors: boolean };
export const CONSENT_COOKIE = 'radar_consent';
export const CONSENT_MAX_AGE = 60 * 60 * 24 * 365;

export function parseConsent(raw: string | undefined): Consent | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v !== 'object' || v === null) return null;
    const rec = v as Record<string, unknown>;
    if (typeof rec.analytics !== 'boolean' || typeof rec.errors !== 'boolean') return null;
    return { analytics: rec.analytics, errors: rec.errors };
  } catch {
    return null;
  }
}

export function serializeConsent(c: Consent): string {
  return JSON.stringify({ analytics: c.analytics, errors: c.errors });
}
```

Run tests — expected PASS.

- [ ] **Step 3: Banner + scripts**

`CookieBanner`: client. Read `document.cookie` for `CONSENT_COOKIE`. If null, show a bottom bar (site tokens: `border-grat`, `bg-[var(--header-bg)]`). Copy: session and payments cookies are necessary; analytics (Plausible) and error reports (Sentry) are optional. Buttons: Accept all, Necessary only, Customize (two checkboxes + Save). Setting cookie: `document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(serializeConsent(c))}; max-age=${CONSENT_MAX_AGE}; path=/; samesite=lax``. Dispatch `window.dispatchEvent(new Event('radar-consent'))`.

`ConsentScripts`: listen for the same event + initial parse. If `analytics`, inject

```html
<script defer data-domain="{domain}" src="https://plausible.io/js/script.js"></script>
```

once (`id="plausible-script"`). Domain = `process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ?? 'radar.runelabs.org'`. If `errors` and `process.env.NEXT_PUBLIC_SENTRY_DSN`, dynamically `import('@sentry/nextjs')` and `Sentry.init({ dsn, tracesSampleRate: 0.05 })` once. Never init client Sentry without errors consent.

Footer link “Cookies” dispatches `radar-consent-open` so the banner can reopen (keep a `forced` state).

Mount both in `src/app/layout.tsx` inside `<body>`.

- [ ] **Step 4: Sentry Next.js wrap**

`npm install @sentry/nextjs`

`sentry.server.config.ts` / `sentry.edge.config.ts`: `Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.05 })` if DSN set.

`sentry.client.config.ts`: empty or no-op — client init is consent-gated in `ConsentScripts`. If the Sentry Next wizard insists on a client config, keep `Sentry.init` behind `typeof document !== 'undefined' && parseConsent(...)?.errors`.

`next.config.ts`:

```ts
import { withSentryConfig } from '@sentry/nextjs';
export default withSentryConfig(nextConfig, { silent: true, sourcemaps: { disable: true } });
```

If `withSentryConfig` requires auth token we do not have, skip source-map upload (`sourcemaps.disable: true`) so builds work without `SENTRY_AUTH_TOKEN`.

`.env.example`: `SENTRY_DSN=`, `NEXT_PUBLIC_SENTRY_DSN=`, `NEXT_PUBLIC_PLAUSIBLE_DOMAIN=radar.runelabs.org`.

- [ ] **Step 5: Verify + commit**

Run: `npx vitest run tests/consent.test.ts` and `npx tsc --noEmit`

```bash
git add src/lib/consent.ts tests/consent.test.ts src/components/consent sentry.*.config.ts next.config.ts src/app/layout.tsx src/app/(site)/layout.tsx package.json package-lock.json .env.example
git commit -m "feat: cookie consent, Plausible, and Sentry"
```

---

### Task 8: SEO helper, noindex, JSON-LD, sitemap

**Files:**
- Create: `src/lib/seo.ts`
- Create: `tests/seo.test.ts`
- Modify: `src/app/(site)/page.tsx` (JSON-LD script)
- Modify: `src/app/sitemap.ts`
- Modify: `src/app/robots.ts`
- Modify: `src/app/(site)/signup/page.tsx` (move metadata to a server parent if needed)
- Modify: `src/app/(site)/login/page.tsx`
- Modify: `src/app/app/decide/kits/page.tsx` (already has metadata)
- Modify: `src/app/app/account/page.tsx`

**Interfaces:**
- Consumes: `config.siteUrl`, `urls.*`
- Produces: `siteMeta(title, description, path, opts?: { index?: boolean })`

- [ ] **Step 1: Failing tests**

```ts
import { landingJsonLd, siteMeta } from '@/lib/seo';

describe('siteMeta', () => {
  it('sets canonical from path', () => {
    const m = siteMeta('Pricing', 'desc', '/pricing');
    expect(m.alternates?.canonical).toMatch(/\/pricing$/);
    expect(m.openGraph?.title).toBe('Pricing');
  });
  it('noindexes when index is false', () => {
    const m = siteMeta('Sign in', 'desc', '/login', { index: false });
    expect(m.robots).toEqual({ index: false, follow: false });
  });
});

describe('landingJsonLd', () => {
  it('emits Organization, SoftwareApplication, FAQPage', () => {
    const types = landingJsonLd().map((x) => x['@type']);
    expect(types).toEqual(expect.arrayContaining(['Organization', 'SoftwareApplication', 'FAQPage']));
  });
});
```

- [ ] **Step 2: Implement `src/lib/seo.ts`**

`siteMeta` returns a `Metadata` object: `title`, `description`, `alternates.canonical` = `new URL(path, config.siteUrl).toString()`, `openGraph: { title, description, url: canonical }`, `twitter: { card: 'summary_large_image', title, description }`, `robots` when `index === false`.

`landingJsonLd()`: array of three schema.org objects. Organization name from `getIdentity().productName`, url `config.siteUrl`. SoftwareApplication: name, url, offers free + $19. FAQPage: three Qs — what Radar is; what is free vs paid; how picks are funded ($0 vendor money). Keep answers ≤ 40 words, matching landing copy.

- [ ] **Step 3: Apply**

- Landing: `<script type="application/ld+json">{JSON.stringify(landingJsonLd())}</script>`.
- `robots.ts` disallow add `/oauth`, `/login`, `/signup`, `/forgot-password`, `/reset-password`.
- `sitemap.ts` add `urls.privacy()`, `urls.terms()`, `urls.kits()`, and `KIT_PERSONAS.map(p => urls.kit(p.slug))`. Do not add login/signup/account.
- Login, signup, forgot, reset, account, admin: `export const metadata = siteMeta(..., { index: false })`. Signup/login are client pages — add a sibling `layout.tsx` in those folders **or** split so `page.tsx` is server-exported metadata + client child. Prefer a local `layout.tsx` with metadata only where the page must stay client.
- Kits roster already has title; switch it to `siteMeta('Kits — what to actually run', existing description, paths.kits)`.

- [ ] **Step 4: Verify + commit**

Run: `npx vitest run tests/seo.test.ts`

```bash
git add src/lib/seo.ts tests/seo.test.ts src/app/(site)/page.tsx src/app/sitemap.ts src/app/robots.ts src/app/(site) src/app/app/account/page.tsx src/app/app/decide/kits/page.tsx
git commit -m "feat: canonical URLs, noindex auth, landing JSON-LD, sitemap legal+kits"
```

---

### Task 9: Seed infra/connector kit cells

**Files:**
- Create: `scripts/seed-kit-infra.ts`
- Modify: `tests/board-apply.test.ts` (one infra-cell assertion if missing)

**Interfaces:**
- Consumes: `applyProposal()` from `src/lib/board/apply.ts`; `boardCellToKitCell('infra','hosting')` etc.
- Produces: 5 pending-then-approved proposals; indie-dev kit 8/8 covered

- [ ] **Step 1: Confirm apply mirrors infra**

If `tests/board-apply.test.ts` has no infra example, add:

```ts
it('mirrors an infra hosting proposal into kit_picks', async () => {
  // insert pending proposal domain=infra task=hosting with three pick names
  // applyProposal(id)
  // expect kit_picks rows best/value/cheapest pickName
});
```

Implement by following the existing proposal-insert helpers in that file.

- [ ] **Step 2: Seed script**

`scripts/seed-kit-infra.ts`:

```ts
const CELLS = [
  {
    domain: 'connectors',
    task: 'code-repo',
    proposed: { bestOverall: 'GitHub', bestValue: 'GitHub', cheapestViable: 'GitLab', costNote: 'Seat or self-host. CI usage not in the kit total.' },
    rationale: 'Everyone already has a git host; GitHub is the default, GitLab is the self-host escape hatch.',
  },
  {
    domain: 'infra',
    task: 'hosting',
    proposed: { bestOverall: 'Vercel', bestValue: 'Railway', cheapestViable: 'Hetzner', costNote: 'Vercel/Railway are usage-priced — excluded from kit total when priceModel is usage.' },
    rationale: 'Vercel is the Next.js default; Railway is simpler paid; Hetzner is the cheap VPS this hub already runs on.',
  },
  {
    domain: 'infra',
    task: 'database-baas',
    proposed: { bestOverall: 'Neon', bestValue: 'Supabase', cheapestViable: 'Turso', costNote: 'Serverless Postgres vs SQLite edge.' },
    rationale: 'Neon for branching Postgres; Supabase when you also want auth/storage; Turso when SQLite is enough.',
  },
  {
    domain: 'infra',
    task: 'auth',
    proposed: { bestOverall: 'Clerk', bestValue: 'Better Auth', cheapestViable: 'Better Auth', costNote: 'Clerk is a seat product; Better Auth is self-hosted.' },
    rationale: 'Clerk is the hosted default; Better Auth is what Radar itself runs and the cheap escape hatch.',
  },
  {
    domain: 'infra',
    task: 'payments',
    proposed: { bestOverall: 'Stripe', bestValue: 'Stripe', cheapestViable: 'Polar', costNote: 'Stripe is usage-priced; Polar is merchant-of-record.' },
    rationale: 'Stripe is the default for SaaS; Polar is the cheaper MoR alternative.',
  },
] as const;
```

For each cell: if `kit_picks` already has a `pickName` for `best` on that category/task, skip. Else insert `board_proposals` (`status: 'pending'`, `proposed: JSON.stringify(...)`, `createdAt: new Date()`) and `await applyProposal(id)`. Log skipped vs applied. `npm` script optional: `"seed:kits": "tsx scripts/seed-kit-infra.ts"`.

- [ ] **Step 3: Verify**

Run: `npx vitest run tests/board-apply.test.ts`
On a local DB: `npx tsx scripts/seed-kit-infra.ts` then open `/app/decide/kits/indie-dev` — expect 8 of 8 covered.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-kit-infra.ts tests/board-apply.test.ts package.json
git commit -m "feat: editorial seed for infra and connector kit cells"
```

---

### Task 10: README + env inventory + operator checklist

**Files:**
- Modify: `README.md`
- Modify: `.env.example` (final pass so every var from this plan is listed)

**Interfaces:**
- Consumes: all env added in Tasks 4–7
- Produces: operator can deploy without reading the spec

- [ ] **Step 1: README**

Delete the paragraph that says entitlements are “manual SQL until Stripe checkout lands”. Replace with:

Hosted billing: Stripe Checkout (Better Auth). Tiers Builder $19/mo or $190/yr, Factory $49/mo or $490/yr. Cancel/manage via Stripe Customer Portal on `/app/account`. Webhook `https://<host>/api/auth/stripe/webhook`.

Add a **Hosted go-live checklist**:

1. `npx tsx scripts/stripe-setup.ts` → paste price ids into `.env`
2. Stripe webhook signing secret → `STRIPE_WEBHOOK_SECRET`
3. Resend domain + `RESEND_API_KEY` + `EMAIL_FROM`
4. Google/GitHub OAuth apps + callbacks
5. Sentry project DSNs
6. Plausible site for `radar.runelabs.org`
7. `docker compose run --rm worker npx tsx scripts/seed-kit-infra.ts`
8. Backup `data/radar.db`
9. (Optional) box git PAT so deploys are `git pull` not bundle/scp

Keep MiniMax env as it is. Do not add PAYG notes.

- [ ] **Step 2: Commit**

```bash
git add README.md .env.example
git commit -m "docs: hosted go-live env and operator checklist"
```

---

## Execution order

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10

T6 (social) can run in parallel with T5 (Resend) after T2. T8 (SEO) can run in parallel with T5–T7 after T1 URLs exist. T9 depends on T1 (kits paths) only. Prefer serial if one agent; parallelize T5∥T6∥T8 after T4 if using subagents.

## Verification (whole plan)

```
npx vitest run
npx tsc --noEmit
npm run build
```

Manual on production after env:

- Signup with agree box; reject without.
- Forgot password (Resend dashboard shows the mail).
- Google or GitHub login.
- Builder monthly checkout (test mode first).
- Builder annual checkout.
- Portal cancel → free tier.
- Cookie: Necessary only → no Plausible request in Network; Accept all → Plausible + Sentry client.
- `/app/decide/kits/indie-dev` → 8 of 8.
- `curl -s https://radar.runelabs.org/sitemap.xml` contains `/privacy` and `/app/decide/kits`.
- `curl -sI https://radar.runelabs.org/signup` — page robots noindex (view source meta).
