import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireViewer } from '@/lib/auth/user';
import { isKitCategory, isKitTier, KIT_CATEGORY_LABELS, KIT_TIERS, type KitTier } from '@/lib/kits/grid';
import { getKitPersona } from '@/lib/kits/personas';
import { loadKit, loadKitPickHistory } from '@/lib/kits/repo';
import type { Confidence } from '@/lib/kits/confidence';
import type { KitLine } from '@/lib/kits/compose';
import { safeHttpUrl } from '@/lib/safe-url';
import { siteMeta } from '@/lib/seo';
import { paths } from '@/lib/urls';
import SectionHeader from '@/components/SectionHeader';

/** Cost tiers, in the words a buyer uses rather than the enum. */
const TIER_LABEL: Record<KitTier, string> = {
  best: 'Best',
  value: 'Value',
  cheapest: 'Cheapest',
};

/** Confidence is computed, so it is coloured like a reading, not a label. */
const CONFIDENCE_STYLE: Record<Confidence, { color: string; borderColor: string }> = {
  high: { color: 'var(--phosphor)', borderColor: 'var(--grat)' },
  med: { color: 'var(--ink-3)', borderColor: 'var(--grat)' },
  low: { color: 'var(--amber)', borderColor: 'var(--amber-dim)' },
};

function jobLabel(line: { category: string; task: string }): string {
  const category = isKitCategory(line.category) ? KIT_CATEGORY_LABELS[line.category] : line.category;
  const task = line.task.replace(/-/g, ' ');
  return `${category} · ${task}`;
}

/** The price cell says which kind of unknown it is — never a bare dash. */
function priceCell(line: KitLine) {
  if (!line.pick) return <span className="text-ink-4">—</span>;
  const { priceModel, priceUsdMonth } = line.pick;
  if (priceModel === 'usage') return <span className="text-amber">usage</span>;
  if (priceModel === 'free') return <span className="text-ink-3">free</span>;
  if (priceUsdMonth == null) return <span className="text-amber">unknown</span>;
  return <span className="text-ink">${priceUsdMonth}</span>;
}

export async function generateMetadata({ params }: { params: Promise<{ persona: string }> }) {
  const { persona: slug } = await params;
  const persona = getKitPersona(slug);
  if (!persona) return { title: 'Kit' };
  return siteMeta(
    `${persona.label} — kit`,
    `${persona.blurb} One pick per job across ${persona.routes.length} jobs, costed per month.`,
    paths.kit(slug),
  );
}

export default async function KitPage({
  params,
  searchParams,
}: {
  params: Promise<{ persona: string }>;
  searchParams: Promise<{ tier?: string }>;
}) {
  await requireViewer();
  const { persona: slug } = await params;
  const { tier: rawTier } = await searchParams;

  const persona = getKitPersona(slug);
  if (!persona) notFound();

  const tier: KitTier = rawTier && isKitTier(rawTier) ? rawTier : persona.defaultTier;
  const kit = loadKit(persona, tier);
  const changes = loadKitPickHistory({ days: 30, cells: persona.routes });
  const partial = kit.unpriced.length > 0;
  // Every priced pick is unknown, so "$0" would read as "this kit is free"
  // when the truth is "we have no prices". Show the absence instead.
  const noPriceKnown = partial && kit.totalUsdMonth === 0;

  return (
    <div>
      <Link
        href={paths.kits}
        className="mono text-[10.5px] uppercase tracking-[0.1em] text-ink-4 hover:text-ink-2"
      >
        ← All kits
      </Link>
      <h1 className="type-h1 mt-1.5">{kit.label}</h1>
      <p className="mt-1.5 max-w-[640px] text-[13px] leading-relaxed text-ink-3">{persona.blurb}</p>

      {/*
        The total is what the page is for, so it gets the size, and the tier
        switcher sits beside it because the tier is what moves the number.
      */}
      <div className="mt-5 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-grat pb-5">
        <div>
          <div className="readout">monthly total · {TIER_LABEL[tier].toLowerCase()} tier</div>
          <div className="mt-1 flex items-baseline gap-2.5">
            {noPriceKnown ? (
              <span className="mono text-[38px] leading-none font-medium tracking-[-0.02em] text-ink-4">
                —
              </span>
            ) : (
              <span className="mono text-[38px] leading-none font-medium tracking-[-0.02em] text-ink">
                ${kit.totalUsdMonth}
                {partial && <span className="text-amber">+</span>}
              </span>
            )}
            <span className="mono text-[11px] uppercase tracking-[0.1em] text-ink-4">
              {kit.coveredCount}/{kit.totalCount} covered
            </span>
          </div>
        </div>

        <nav aria-label="Cost tier" className="flex shrink-0 rounded-[4px] border border-grat">
          {KIT_TIERS.map((t, i) => (
            <Link
              key={t}
              href={paths.kit(persona.slug, t)}
              aria-current={t === tier ? 'page' : undefined}
              className={`mono px-3 py-1.5 text-[10.5px] uppercase tracking-[0.1em] transition-colors ${
                i > 0 ? 'border-l border-grat' : ''
              } ${
                t === tier
                  ? 'bg-phosphor-dim text-phosphor'
                  : 'text-ink-4 hover:bg-scope-2 hover:text-ink-2'
              }`}
            >
              {TIER_LABEL[t]}
            </Link>
          ))}
        </nav>
      </div>

      {partial && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
          <span className="text-amber">
            {noPriceKnown ? 'No total yet.' : 'Partial total.'}
          </span>{' '}
          No price on file yet for{' '}
          <span className="text-ink-2">{kit.unpriced.map((p) => p.pickName).join(', ')}</span> —{' '}
          {kit.unpriced.length === 1 ? 'it is' : 'they are'} not counted above rather than counted as
          zero.
        </p>
      )}

      <SectionHeader label="The kit" count={`${kit.totalCount} jobs`} />
      <table className="table table-cards">
        <thead>
          <tr>
            <th>Job</th>
            <th>Pick</th>
            <th className="num">Price</th>
            <th className="num">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {kit.lines.map((l) => {
            const url = safeHttpUrl(l.pick?.pickUrl);
            return (
              <tr key={`${l.category}/${l.task}`} className="row-hover">
                <td data-label="Job">
                  <span className="mono text-[11px] uppercase tracking-[0.08em] text-ink-4">
                    {jobLabel(l)}
                  </span>
                </td>
                <td data-label="Pick">
                  {!l.pick ? (
                    <span className="text-ink-4">not yet covered</span>
                  ) : url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-ink decoration-grat-strong underline-offset-2 hover:underline"
                    >
                      {l.pick.pickName}
                    </a>
                  ) : (
                    <span className="text-ink">{l.pick.pickName}</span>
                  )}
                </td>
                <td data-label="Price" className="num mono text-[12.5px]">
                  {priceCell(l)}
                </td>
                <td data-label="Confidence" className="num">
                  {l.pick ? (
                    <span className="badge" style={CONFIDENCE_STYLE[l.pick.confidence]}>
                      {l.pick.confidence}
                    </span>
                  ) : (
                    <span className="text-ink-4">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {kit.usageRisk.length > 0 && (
        <>
          <SectionHeader label="Usage-priced — not in the total" count={kit.usageRisk.length} />
          <ul>
            {kit.usageRisk.map((p) => (
              <li
                key={`${p.category}/${p.task}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-grat-soft py-2 text-[13px] last:border-b-0"
              >
                <span className="text-ink">{p.pickName}</span>
                <span className="mono text-[10px] uppercase tracking-[0.08em] text-ink-4">
                  {jobLabel(p)}
                </span>
                <span className="w-full text-[12.5px] text-ink-3 sm:w-auto sm:flex-1 sm:text-right">
                  {p.riskFlag ?? 'metered — set a spend cap'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {changes.length > 0 && (
        <>
          <SectionHeader label="Changed — last 30 days" count={changes.length} />
          <ul>
            {changes.map((c) => (
              <li
                key={`${c.category}/${c.task}/${c.tier}/${c.changedAt.toISOString()}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-grat-soft py-2 text-[13px] last:border-b-0"
              >
                <span className="mono w-[86px] shrink-0 text-[10px] uppercase tracking-[0.08em] text-ink-4">
                  {c.changedAt.toISOString().slice(0, 10)}
                </span>
                <span className="mono text-[10px] uppercase tracking-[0.08em] text-ink-4">
                  {c.task.replace(/-/g, ' ')} · {c.tier}
                </span>
                <span className="text-ink-3">
                  {c.fromPick ?? 'nothing'} <span className="text-ink-4">→</span>{' '}
                  <span className="text-ink">{c.toPick}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
