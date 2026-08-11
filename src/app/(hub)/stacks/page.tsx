import { getDb } from '@/lib/db';
import { stacks } from '@/lib/db/schema';
import { requireViewer } from '@/lib/auth/user';
import { timeAgo } from '@/lib/feed';
import { VENTURES } from '@/lib/stacks/generate';
import VerdictEditor from '@/components/VerdictEditor';

interface Layer {
  layer: string;
  pick: string;
  alt: string | null;
  note: string | null;
}

export const metadata = {
  title: 'Stacks — ship-it-today playbooks',
  description:
    'The recommended tech stack per venture type, regenerated weekly from the model market and the news — optimized for speed to MVP and low run cost.',
};

function parseLayers(json: string): Layer[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (l): l is Layer =>
        typeof l === 'object' && l !== null && typeof (l as Layer).layer === 'string' && typeof (l as Layer).pick === 'string',
    );
  } catch {
    return [];
  }
}

export default async function StacksPage() {
  const user = await requireViewer();
  const db = getDb();
  const rows = db.select().from(stacks).all();
  const byVenture = new Map(rows.map((r) => [r.venture, r]));
  const ordered = VENTURES.map((v) => ({ venture: v, stack: byVenture.get(v.slug) ?? null }));
  const have = ordered.filter((o) => o.stack !== null);

  return (
    <div className="mx-auto max-w-[860px] px-6 py-7">
      <div className="readout">venture playbooks &middot; weekly sync, news-grounded</div>
      <h1 className="mt-1 text-[17px] font-semibold tracking-[-0.01em]">Stacks</h1>
      <p className="mt-1.5 max-w-[560px] text-[13px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
        The ship-it-today tech stack per venture type Runelabs sells — optimized for speed to MVP
        with AI-assisted dev, low run cost, and easy handover. Regenerated weekly from the news and
        the model market.
      </p>

      {have.length === 0 ? (
        <p className="mono mt-8 text-[12px]" style={{ color: 'var(--ink-4)' }}>
          No playbooks yet — the weekly stacks job writes them (or run{' '}
          <span style={{ color: 'var(--ink-3)' }}>npm run job -- stacks</span>).
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {have.map(({ venture, stack }, idx) => {
            const s = stack!;
            const layers = parseLayers(s.layers);
            return (
              <section
                key={venture.slug}
                className="card anim-in !p-5"
                style={{ animationDelay: `${idx * 60}ms` }}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="readout" style={{ color: 'var(--phosphor)' }}>
                    &#9646; {venture.label}
                  </span>
                  <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{s.title}</h2>
                  {s.tagline && (
                    <span className="text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
                      {s.tagline}
                    </span>
                  )}
                </div>

                <div className="mono mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[10.5px] tracking-[0.06em] uppercase" style={{ color: 'var(--ink-3)' }}>
                  {s.timeToMvp && (
                    <span>
                      <span style={{ color: 'var(--ink-4)' }}>time to mvp</span> {s.timeToMvp}
                    </span>
                  )}
                  {s.costNote && (
                    <span>
                      <span style={{ color: 'var(--ink-4)' }}>run cost</span> {s.costNote}
                    </span>
                  )}
                </div>

                {layers.length > 0 && (
                  <table className="table table-cards mt-3">
                    <thead>
                      <tr>
                        <th className="w-[13%]">Layer</th>
                        <th className="w-[26%]">Pick</th>
                        <th className="w-[24%]">Alternative</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {layers.map((l) => (
                        <tr key={l.layer}>
                          <td data-label="layer" className="mono text-[10.5px] uppercase" style={{ color: 'var(--ink-4)' }}>
                            {l.layer}
                          </td>
                          <td data-label="pick" style={{ color: 'var(--ink)' }}>{l.pick}</td>
                          <td data-label="alternative">{l.alt ?? <span style={{ color: 'var(--ink-4)' }}>—</span>}</td>
                          <td data-label="note" className="text-[12.5px]">{l.note ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {s.rationale && (
                  <p className="mt-3 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
                    {s.rationale}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-start justify-between gap-3 border-t border-[var(--grat-soft)] pt-3">
                  <div className="min-w-0 flex-1 text-[13px]">
                    <span className="readout mr-2">verdict</span>
                    <VerdictEditor
                      entryId={s.id}
                      verdict={s.runelabsVerdict}
                      author={s.verdictAuthor}
                      canEdit={!!user}
                      kind="stack"
                    />
                  </div>
                  <span className="mono shrink-0 text-[10px]" style={{ color: 'var(--ink-4)' }}>
                    updated {timeAgo(s.updatedAt)}
                  </span>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
