import Link from 'next/link';
import { requireViewer } from '@/lib/auth/user';
import { KIT_CATEGORY_LABELS, isKitCategory } from '@/lib/kits/grid';
import { KIT_PERSONAS } from '@/lib/kits/personas';
import { siteMeta } from '@/lib/seo';
import { paths } from '@/lib/urls';
import PageHeader from '@/components/PageHeader';
import SectionHeader from '@/components/SectionHeader';

export const metadata = siteMeta(
  'Kits — what to actually run',
  'A costed tool kit per role: one pick per job, a monthly total, and the cells not yet covered.',
  paths.kits,
);

/** The categories a persona routes through, in grid order, deduped. */
function coverage(routes: { category: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of routes) {
    if (seen.has(r.category)) continue;
    seen.add(r.category);
    out.push(isKitCategory(r.category) ? KIT_CATEGORY_LABELS[r.category] : r.category);
  }
  return out;
}

export default async function KitsPage() {
  await requireViewer();

  return (
    <div>
      <PageHeader
        kicker="Decide · Kits"
        title="Kits"
        description="Pick the role that fits and get the whole stack costed in one screen — one pick per job, a monthly total that never quietly counts an unknown price as zero, and honest gaps where nothing is verified yet."
      />

      <SectionHeader label="Roles" count={KIT_PERSONAS.length} className="mt-6" />

      <ul className="grid gap-3 sm:grid-cols-2">
        {KIT_PERSONAS.map((p, i) => (
          <li key={p.slug} className="anim-in" style={{ animationDelay: `${i * 40}ms` }}>
            {/*
              The whole cell is the target. A card that is one link needs no
              button inside it — the button was just a second name for the card.
            */}
            <Link
              href={paths.kit(p.slug)}
              className="hover-raise group flex h-full flex-col rounded-[6px] border border-grat-soft bg-scope-1 p-4 hover:border-grat-strong focus-visible:border-phosphor focus-visible:outline-none"
            >
              <h2 className="type-h3 text-ink">{p.label}</h2>
              <p className="mt-1.5 flex-1 text-[12.5px] leading-relaxed text-ink-3">{p.blurb}</p>

              <div className="mt-3 border-t border-grat-soft pt-2.5">
                <div className="mono flex items-baseline gap-2 text-[10px] uppercase tracking-[0.1em] text-ink-4">
                  <span className="text-ink-3">{p.routes.length} jobs</span>
                  <span aria-hidden>·</span>
                  <span>{p.defaultTier}</span>
                  <span
                    aria-hidden
                    className="ml-auto text-ink-4 transition-colors group-hover:text-phosphor"
                  >
                    →
                  </span>
                </div>
                <div className="mono mt-1 truncate text-[10px] uppercase tracking-[0.1em] text-ink-4">
                  {coverage(p.routes).join(' · ')}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
