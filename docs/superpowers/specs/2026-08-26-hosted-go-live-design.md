# Hosted Radar — Go-Live Design

**Date:** 2026-08-26
**Status:** Approved (decisions locked via brainstorming Q&A + scope add)
**Owner:** Specter / Runelabs

## Problem

[radar.runelabs.org](https://radar.runelabs.org) is publicly up: ingest, MCP OAuth, free signup, pricing copy, 51 board picks. It is not a hosted commercial launch. A visitor cannot pay, reset a password, agree to terms, or recover an account. Persona kits are 3/8 covered on indie-dev. Upgrade buttons do not open Stripe. There is no error reporting, no traffic analytics, no social login, no cookie disclosure, and marketing SEO is a single default title/OG card.

## Goal

A visitor can create an account (email or Google/GitHub), agree to Terms, reset a password, pay Builder or Factory (monthly or annual), cancel in the Stripe portal, see an 8/8 indie-dev kit, and the public site is legally, analytically, and search-indexably a real product.

MiniMax remains on the current subscription key. No PAYG migration in this work.

## Locked decisions

| Decision | Choice |
|---|---|
| Sequencing | One plan, four shippable waves (legal/honesty → Stripe → email/social/consent/obs → kits/SEO/ops) |
| Stripe products | Create from API keys via a setup script (no Price IDs exist yet) |
| Annual | Two months free: Builder $190/yr, Factory $490/yr. Monthly stays $19 / $49 |
| Email | Resend. Password reset required. Verification email sent; login **not** blocked if unverified |
| Support / From | `hello@runelabs.org` (Resend `EMAIL_FROM=Radar <hello@runelabs.org>`) |
| Kits | Editorially seed empty infra/connector cells through `applyProposal()`. Honest gaps stay elsewhere. Add Kits to Decide nav. Do not feature kits on the marketing homepage until after the seed |
| Social login | Google + GitHub. Buttons only render when the matching env vars are set |
| Errors | Sentry (`@sentry/nextjs`). Server errors always. Client PII / user context only after error-reporting consent |
| Analytics | Plausible (pageviews). Script loads only after analytics consent |
| Cookie banner | Categories: necessary (always), analytics (opt-in), error reporting (opt-in). Accept all / Necessary only / Customize |
| Legal | Operator-drafted `/privacy` + `/terms`. Signup requires a checked “I agree”. Not lawyer-reviewed; pages say so |
| MiniMax ToS | Out of scope — keep current key |
| Team seats | Out of scope — remove “coming” from pricing copy |
| Secrets in chat | Never. Keys go in box `.env` at deploy |

## Out of scope

- MiniMax PAYG / Team plan migration
- Team / seat billing
- Session replay, Sentry performance at high sample rates
- Google Analytics / PostHog (Plausible only)
- Cookie banner for theme `localStorage` (not a cookie)
- Changing the Hetzner/Docker topology
- Lawyer review of Terms/Privacy

---

## Wave 1 — Honesty + legal

### Copy

- Site header: anonymous → **Start free** (`/signup`). Signed-in → **Open the app**.
- Pricing: delete “Team seats (coming)”. Factory uses the same checkout control as Builder (plan argument), not a link to `/app/account`.
- Signup: checkbox “I agree to the Terms and Privacy Policy” (links). Submit disabled until checked.
- Footer (site + app): Terms, Privacy, `hello@runelabs.org`.

### Pages

- `src/app/(site)/privacy/page.tsx`
- `src/app/(site)/terms/page.tsx`

Copy lives in those files (not a CMS). Tone: same as the rest of the site — short, specific, no “we value your privacy” filler.

**Terms (must cover):** hosted service vs BSL self-host; artifact quotas not SLA; picks/kits are opinions dated and graded, not warranties; LLM artifacts (plans, debates) can be wrong; you own your prompts/ideas, we may use aggregated telemetry; payment via Stripe, cancel anytime, no refunds on the current period unless required by law; MiniMax and other subprocessors; we can suspend abuse; BSL 1.1 for the source.

**Privacy (must cover):** account email/name/password-hash or OAuth ids; session cookies; Stripe customer/subscription ids (no card numbers on our servers); MCP OAuth tokens; usage/quota counters; optional Plausible pageviews; optional Sentry errors; no sale of data; no vendor-money in picks; retention (account until deletion; logs ~90 days); contact `hello@runelabs.org`; operator-drafted notice.

`paths.privacy`, `paths.terms` in `src/lib/urls.ts`.

---

## Wave 2 — Stripe (monthly + annual)

Existing server plugin in `src/lib/auth/better-auth.ts` already maps `builder` / `factory` and has `annualDiscountPriceId` slots. Missing: products in Stripe, client plugin, working checkout, portal, annual UI.

### Products (script)

`scripts/stripe-setup.ts` (idempotent by product name):

| Product | Monthly | Annual |
|---|---|---|
| Radar Builder | $19 / month | $190 / year |
| Radar Factory | $49 / month | $490 / year |

Prints the four `price_…` ids. Operator pastes into `.env`. Never logs the secret key.

Env:

```
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_BUILDER=
STRIPE_PRICE_BUILDER_ANNUAL=
STRIPE_PRICE_FACTORY=
STRIPE_PRICE_FACTORY_ANNUAL=
```

Webhook (Stripe Dashboard): `https://radar.runelabs.org/api/auth/stripe/webhook`  
Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.

### Client

`src/lib/auth/client.ts` registers `stripeClient({ subscription: true })` from `@better-auth/stripe/client` whenever we are in a browser. The plugin no-ops if the server has no Stripe plugin; checkout buttons still fall back to signup.

`CheckoutButtons` props: `{ plan?: 'builder' | 'factory' }` — default both buttons on pricing Builder card is wrong; pricing page uses one button per card. Interval from a monthly/annual toggle on `/pricing` (React state, default monthly). `upgrade({ plan, annual, successUrl, cancelUrl })`.

Logged-out: `/signup?plan=builder&interval=annual`. After signup, redirect to `/app/account?checkout=builder&annual=1` which auto-starts upgrade once.

Account page (paid): **Manage billing** → `authClient.subscription.billingPortal({ returnUrl })`. Not a dead link to `/pricing`.

`src/lib/billing.ts`: add `TIER_PRICES_ANNUAL = { builder: 190, factory: 490 }`. Quotas unchanged (same plans/month either interval).

---

## Wave 3 — Resend, social login, consent, Sentry, Plausible

### Resend

Package: `resend`. `src/lib/email.ts` wraps `emails.send`. Better Auth:

- `sendResetPassword` → `/reset-password` link
- `sendVerificationEmail` → verify link
- `requireEmailVerification: false`

Pages: `/forgot-password`, `/reset-password` (Better Auth token query). Login: “Forgot password?”.

Ops: verify `runelabs.org` in Resend (SPF/DKIM). `RESEND_API_KEY=`.

### Google / GitHub

Server already reads `GOOGLE_CLIENT_ID/SECRET` and `GITHUB_CLIENT_ID/SECRET`. Add UI.

Login + signup: “Continue with Google” / “Continue with GitHub” calling `authClient.signIn.social({ provider, callbackURL })`. Render only if the server page passes `google` / `github` booleans from env (do not leak secrets).

OAuth app callback URLs:

- `https://radar.runelabs.org/api/auth/callback/google`
- `https://radar.runelabs.org/api/auth/callback/github`

(and localhost equivalents for dev).

### Cookie consent

`src/lib/consent.ts` (pure):

```ts
export type Consent = { analytics: boolean; errors: boolean };
export const CONSENT_COOKIE = 'radar_consent';
export const CONSENT_MAX_AGE = 60 * 60 * 24 * 365;
export function parseConsent(raw: string | undefined): Consent | null;
export function serializeConsent(c: Consent): string;
```

Necessary cookies (session, Stripe, CSRF) are not optional and are listed in the banner. Theme stays `localStorage`.

`CookieBanner` in root layout: if `parseConsent` is null, show bar. Actions: Accept all (`{analytics:true, errors:true}`), Necessary only (`{false,false}`), Customize (two toggles + save). Link to Privacy.

`ConsentScripts`: client. If `analytics`, inject Plausible (`PLAUSIBLE_DOMAIN` or default `radar.runelabs.org`). If `errors` and `NEXT_PUBLIC_SENTRY_DSN`, `Sentry.setUser` may run; without consent, Sentry client stays anonymous or uninitialized.

Footer: “Cookies” opens the banner again (`radar.consent` custom event).

### Sentry

`@sentry/nextjs`. Wrap `next.config.ts`. `sentry.server.config.ts`, `sentry.edge.config.ts`, `sentry.client.config.ts`. `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN`. Traces sample rate `0.05`. No session replay. Server always reports. Client init only when errors consent is true (or init without user id when consent is necessary-only — prefer **no client SDK until errors consent** so the banner is honest).

### Plausible

No npm required. Script `https://plausible.io/js/script.js` with `data-domain={PLAUSIBLE_DOMAIN}`. Env `NEXT_PUBLIC_PLAUSIBLE_DOMAIN=radar.runelabs.org`. Load only after analytics consent.

---

## Wave 4 — Kits, SEO, ops docs

### Kit seed

`scripts/seed-kit-infra.ts`: insert pending `board_proposals` then `applyProposal` for:

| domain/task | bestOverall | bestValue | cheapestViable | costNote |
|---|---|---|---|---|
| connectors / code-repo | GitHub | GitHub | GitLab | Seat or self-host. Usage-priced CI not in the total. |
| infra / hosting | Vercel | Railway | Hetzner | Vercel/Railway usage-priced — excluded from kit total once priceModel is set. |
| infra / database-baas | Neon | Supabase | Turso | Serverless Postgres vs SQLite edge. |
| infra / auth | Clerk | Better Auth | Better Auth | Clerk is a seat; Better Auth is self-hosted. |
| infra / payments | Stripe | Stripe | Polar | Stripe is usage-priced; Polar is the cheaper merchant-of-record alternative. |

Rationale on each proposal: one sentence why, dated 2026-08-26, author auto. Idempotent: skip if `kit_picks` already has a non-empty `pickName` for that cell+tier.

Nav: add `{ href: paths.kits, label: 'Kits' }` to Decide tabs. `paths.kits` + `paths.kit(slug)`. Kits pages use `paths.*` instead of hardcoded `/app/decide/kits`.

### SEO

Already have: `metadataBase`, sitemap (stories/entities/opportunities), robots, one OG image, story JSON-LD.

Add:

1. **Titles + descriptions** on `/signup`, `/privacy`, `/terms`, `/forgot-password`, kits roster + persona pages.
2. **`noindex`** on `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/oauth/*`, `/app/account`, `/app/admin`.
3. **Canonical** `alternates.canonical` on every `(site)` page via a small helper `siteMeta(title, description, path)`.
4. **JSON-LD** on `/`: `Organization` + `SoftwareApplication` + `FAQPage` (three questions from the landing: what Radar is, what is free, how picks are funded).
5. **Sitemap** add `/privacy`, `/terms`, `/mcp`, `/pricing` (pricing already), `/app/decide/kits` and each persona slug. Do not add account/login.
6. **robots.ts**: keep disallow `/admin` and `/api/`; add disallow `/oauth`.
7. **Open Graph**: per-page `openGraph.title/description`; keep the existing default OG image.
8. **Internal links**: footer legal; landing already links pricing/signup.

### Ops / README

Replace “manual SQL until Stripe lands” with checkout + portal. Document all new env vars in `.env.example`. Checklist: Stripe webhook, Resend domain, OAuth apps, Plausible site, Sentry project, `SESSION_SECRET` / `BETTER_AUTH_SECRET`, backup `data/radar.db`. Git-on-box PAT remains a checklist item, not a code change.

---

## File map

| File | Role |
|---|---|
| `src/lib/billing.ts` | Monthly + annual list prices |
| `src/lib/consent.ts` | Pure consent parse/serialize |
| `src/lib/email.ts` | Resend send helper |
| `src/lib/seo.ts` | `siteMeta()` + JSON-LD builders |
| `src/lib/auth/better-auth.ts` | Stripe (already), Resend hooks, social (already) |
| `src/lib/auth/client.ts` | stripeClient + no extra social plugin needed |
| `src/lib/urls.ts` / `src/lib/nav.ts` | privacy, terms, kits, forgot-password |
| `src/components/account/CheckoutButtons.tsx` | plan + annual |
| `src/components/consent/*` | Banner + scripts |
| `src/components/auth/SocialButtons.tsx` | Google/GitHub |
| `src/app/(site)/{privacy,terms,forgot-password,reset-password}/page.tsx` | New routes |
| `scripts/stripe-setup.ts` | Create products/prices |
| `scripts/seed-kit-infra.ts` | Editorial kit cells |
| `sentry.*.config.ts` + `next.config.ts` | Sentry wrap |
| `.env.example` / `README.md` | Operator docs |

## Testing

- `tests/billing.test.ts` — annual constants; existing quota tests unchanged.
- `tests/consent.test.ts` — parse/serialize/round-trip/garbage → null.
- `tests/seo.test.ts` — `siteMeta` canonical uses `SITE_URL`; JSON-LD types present.
- `tests/board-apply.test.ts` — infra domain proposal mirrors to `kit_picks` (extend if missing).
- Manual: Stripe test-mode checkout (operator). Do not put live charges in CI.

## Done when

1. New user signs up (email or Google/GitHub) only after agreeing to Terms.
2. Forgot-password email arrives via Resend and login works after reset.
3. Logged-in user completes Builder monthly **and** annual Checkout (test mode acceptable for verification) and `plan_entitlements.tier` becomes `builder`.
4. Account → Manage billing opens Stripe portal; cancel returns them to free.
5. Cookie banner appears once; Necessary-only means no Plausible script and no client Sentry; Accept all loads both.
6. Indie-dev kit is 8/8 covered; Decide nav has Kits.
7. `/privacy` and `/terms` linked from footer and signup. `/signup` is `noindex`. Homepage JSON-LD present. Sitemap lists legal + kits.
8. `.env.example` lists every new var. README no longer says entitlements are manual SQL.
