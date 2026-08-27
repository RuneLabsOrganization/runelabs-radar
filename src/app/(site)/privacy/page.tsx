import Link from 'next/link';
import { paths } from '@/lib/urls';

export const metadata = {
  title: 'Privacy',
  description:
    'What Radar collects on the hosted service, what we do not, how payments and cookies work, and how to reach us.',
};

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-[720px] px-4 py-12">
      <h1 className="type-h1">Privacy</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
        This notice covers the hosted service at radar.runelabs.org. Self-hosted copies of the source are under BSL
        1.1 and outside this notice. Operator-drafted — not a substitute for counsel.
      </p>

      <h2 className="mt-10 text-[16px] font-semibold tracking-tight text-ink">What we collect</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        Account email, display name, and a password hash — or OAuth identifiers if you sign in with Google or GitHub.
        Session cookies so you stay signed in. Stripe customer and subscription ids when you pay. Usage and quota
        counters for free and paid tiers. MCP OAuth tokens if you connect an agent. Optional Plausible pageviews and
        optional Sentry error reports only after you opt in.
      </p>

      <h2 className="mt-10 text-[16px] font-semibold tracking-tight text-ink">What we do not collect</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        We do not sell your data. Board picks and kits are not funded by vendors — there is no affiliate money in the
        rankings. We do not store card numbers on our servers. Theme preference lives in localStorage, not a cookie.
      </p>

      <h2 className="mt-10 text-[16px] font-semibold tracking-tight text-ink">Payments</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        Stripe handles checkout and billing. We keep customer and subscription ids so we can map your plan. We never
        see or store full card numbers.
      </p>

      <h2 className="mt-10 text-[16px] font-semibold tracking-tight text-ink">Cookies</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        Session (and related CSRF / Stripe) cookies are necessary to run the product. Analytics (Plausible) and error
        reporting (Sentry on the client) load only after you opt in via the cookie banner. You can change that later.
      </p>

      <h2 className="mt-10 text-[16px] font-semibold tracking-tight text-ink">MCP tokens</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        When you authorize an MCP client, we store OAuth tokens scoped to the permissions you approve. Revoke access
        from your account or by disconnecting the client. Do not put secrets in chat — keys belong in your own
        environment at deploy time.
      </p>

      <h2 className="mt-10 text-[16px] font-semibold tracking-tight text-ink">Retention</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        Account data stays until you delete the account. Operational logs are kept about 90 days. Stripe retains
        payment records under their own policies.
      </p>

      <h2 className="mt-10 text-[16px] font-semibold tracking-tight text-ink">Subprocessors</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        MiniMax (model inference), Stripe (payments), Resend (transactional email), Plausible (opt-in analytics),
        Sentry (opt-in error reporting), and Google or GitHub if you use those for OAuth. Hosting runs on our
        infrastructure; we do not hand your account to marketers.
      </p>

      <h2 className="mt-10 text-[16px] font-semibold tracking-tight text-ink">Contact</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        Questions or deletion requests:{' '}
        <a href="mailto:hello@runelabs.org" className="text-phosphor hover:underline">
          hello@runelabs.org
        </a>
        . See also the{' '}
        <Link href={paths.terms} className="text-phosphor hover:underline">
          Terms
        </Link>
        .
      </p>
    </article>
  );
}
