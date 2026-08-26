import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireViewer } from '@/lib/auth/user';
import { isKitTier, KIT_TIERS, type KitTier } from '@/lib/kits/grid';
import { getKitPersona } from '@/lib/kits/personas';
import { loadKit } from '@/lib/kits/repo';

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

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/app/decide/kits" className="text-sm text-ink-4 hover:underline">
        ← All kits
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{kit.label}</h1>
      <p className="mt-1 text-ink-4">{persona.blurb}</p>

      <div className="mt-4 flex flex-wrap items-baseline gap-4">
        <span className="text-3xl font-semibold">
          {kit.unpriced.length > 0 ? '$' + kit.totalUsdMonth + '+' : '$' + kit.totalUsdMonth}
        </span>
        <span className="text-ink-4">
          /mo · {kit.coveredCount} of {kit.totalCount} covered
        </span>
      </div>
      {kit.unpriced.length > 0 && (
        <p className="mt-1 text-sm text-ink-4">
          Price not on file yet for {kit.unpriced.map((p) => p.pickName).join(', ')} — the total above does not
          include {kit.unpriced.length === 1 ? 'it' : 'them'}.
        </p>
      )}

      <nav className="mt-4 flex gap-2 text-sm">
        {KIT_TIERS.map((t) => (
          <Link
            key={t}
            href={`/app/decide/kits/${persona.slug}?tier=${t}`}
            className={`rounded border border-line px-2 py-1 ${t === tier ? 'font-medium' : 'text-ink-4'}`}
          >
            {t}
          </Link>
        ))}
      </nav>

      <table className="mt-6 w-full text-sm">
        <thead className="text-left text-ink-4">
          <tr>
            <th className="py-2">Job</th>
            <th>Pick</th>
            <th>Price</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {kit.lines.map((l) => (
            <tr key={`${l.category}/${l.task}`} className="border-t border-line">
              <td className="py-2">
                {l.category}/{l.task}
              </td>
              <td>{l.pick ? l.pick.pickName : <span className="text-ink-4">not yet covered</span>}</td>
              <td>
                {!l.pick
                  ? '—'
                  : l.pick.priceModel === 'usage'
                    ? 'usage-priced'
                    : l.pick.priceModel === 'free'
                      ? 'free'
                      : l.pick.priceUsdMonth != null
                        ? `$${l.pick.priceUsdMonth}`
                        : <span className="text-ink-4">price unknown</span>}
              </td>
              <td className="text-ink-4">{l.pick ? l.pick.confidence : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {kit.usageRisk.length > 0 && (
        <section className="mt-6 rounded-lg border border-line p-4">
          <h2 className="font-medium">Usage-priced — excluded from the total</h2>
          <ul className="mt-2 space-y-1 text-sm text-ink-4">
            {kit.usageRisk.map((p) => (
              <li key={`${p.category}/${p.task}`}>
                {p.pickName} ({p.category}/{p.task}) — {p.riskFlag ?? 'metered; set a spend cap'}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
