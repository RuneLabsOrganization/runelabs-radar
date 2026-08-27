import Link from 'next/link';
import { paths } from '@/lib/urls';

export const metadata = {
  title: 'Terms',
  description:
    'Terms for the hosted Radar service: quotas, billing, opinions vs warranties, and how this relates to the BSL source.',
};

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-[720px] px-4 py-12">
      <h1 className="type-h1">Terms</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
        These terms apply to the hosted service at radar.runelabs.org. Operator-drafted — not a substitute for
        counsel. By creating an account you agree to them.
      </p>

      <h2 className="mt-10 text-[16px] font-semibold tracking-tight text-ink">Hosted service and the source</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        Hosted Radar is a commercial service we operate. The open source tree is licensed under Business Source
        License 1.1 (BSL 1.1). Running your own copy is a separate arrangement under that license; these terms do not
        grant you production rights beyond what BSL already allows.
      </p>

      <h2 className="mt-10 text-[16px] font-semibold tracking-tight text-ink">Quotas, not an SLA</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        Free and paid plans differ by artifact quotas (asks, plans, debates, and related caps). That is a usage
        allotment, not an uptime or response-time SLA. We aim to keep the service available; we do not promise
        continuous availability.
      </p>

      <h2 className="mt-10 text-[16px] font-semibold tracking-tight text-ink">Picks and kits</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        Board picks and persona kits are dated, graded opinions — what looked best for a job on a given day. They are
        not warranties that a tool will fit your stack, budget, or compliance needs. Re-check before you commit.
      </p>

      <h2 className="mt-10 text-[16px] font-semibold tracking-tight text-ink">LLM artifacts</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        Plans, debates, briefs, and other model-generated output can be wrong, incomplete, or outdated. Treat them as
        drafts you verify. Model inference for hosted features currently runs through MiniMax and other subprocessors
        named in the Privacy notice.
      </p>

      <h2 className="mt-10 text-[16px] font-semibold tracking-tight text-ink">Your content</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        You own your prompts, ideas, and project context. We may use aggregated, de-identified telemetry to operate and
        improve the product. Do not submit secrets or credentials into prompts — put keys in your own environment.
      </p>

      <h2 className="mt-10 text-[16px] font-semibold tracking-tight text-ink">Billing</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        Paid tiers are billed through Stripe (monthly or annual). Cancel anytime via the billing portal; access
        continues through the end of the paid period. We do not issue prorated refunds on the current period unless
        the law requires it.
      </p>

      <h2 className="mt-10 text-[16px] font-semibold tracking-tight text-ink">Abuse and suspension</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        We may suspend or terminate accounts that abuse the service, attack infrastructure, scrape at scale without
        permission, or violate these terms. We will try to say why when we can.
      </p>

      <h2 className="mt-10 text-[16px] font-semibold tracking-tight text-ink">Contact</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        Support:{' '}
        <a href="mailto:hello@runelabs.org" className="text-phosphor hover:underline">
          hello@runelabs.org
        </a>
        . Privacy details live on the{' '}
        <Link href={paths.privacy} className="text-phosphor hover:underline">
          Privacy
        </Link>{' '}
        page.
      </p>
    </article>
  );
}
