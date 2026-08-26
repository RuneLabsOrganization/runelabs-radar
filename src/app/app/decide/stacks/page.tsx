import Link from 'next/link';
import { getDb } from '@/lib/db';
import { stacks } from '@/lib/db/schema';
import { requireViewer } from '@/lib/auth/user';
import { timeAgo } from '@/lib/feed';
import { VENTURES } from '@/lib/stacks/generate';
import { allEntityNames, matchEntity, stackMarkdown } from '@/lib/stacks/match';
import VerdictEditor from '@/components/VerdictEditor';
import CopyButton from '@/components/CopyButton';
import { Card, CardContent } from '@/components/ui/card';
import { paths } from '@/lib/urls';

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

/** Pick cell: linked to its entity watch page when the name matches the graph. */
function PickText({
  text,
  entities,
  strong = false,
}: {
  text: string;
  entities: Map<string, string>;
  strong?: boolean;
}) {
  const m = matchEntity(text, entities);
  if (!m) return <span className={strong ? 'text-ink' : 'text-ink-2'}>{text}</span>;
  return (
    <Link
      href={paths.entity(m.slug)}
      title={`watch ${m.name}`}
      className={`decoration-grat-strong underline-offset-2 hover:underline ${strong ? 'text-ink' : 'text-ink-2'}`}
    >
      {text}
    </Link>
  );
}

export default async function StacksPage() {
  const user = await requireViewer();
  const db = getDb();
  const rows = db.select().from(stacks).all();
  const byVenture = new Map(rows.map((r) => [r.venture, r]));
  const ordered = VENTURES.map((v) => ({ venture: v, stack: byVenture.get(v.slug) ?? null }));
  const have = ordered.filter((o) => o.stack !== null);
  const entities = allEntityNames();

  return (
    <div>
      <div className="readout text-phosphor">Decide · Stacks</div>
      <h1 className="type-h1 mt-1">Stacks</h1>
      <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-ink-3">
        Skip the week of deciding what to build it on. For each kind of product: the stack that gets you to a
        working MVP fastest, stays cheap to run, and that a model can actually write — because it has seen enough of
        it. Which editor and coding agent to use is a different question, answered on Agent stacks.
      </p>

      {have.length === 0 ? (
        <p className="mono mt-8 text-[12px] text-ink-4">
          No playbooks yet — the weekly stacks job writes them (or run{' '}
          <span className="text-ink-3">npm run job -- stacks</span>).
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {ordered.map(({ venture, stack }, idx) => {
            if (!stack) {
              // placeholder slot — the catalog shows its shape, not a hole
              return (
                <section key={venture.slug} className="rounded-[6px] border border-dashed border-grat p-5 opacity-60">
                  <span className="readout text-ink-4">
                    &#9646; {venture.label}
                  </span>
                  <p className="mono mt-2 text-[11px] text-ink-4">
                    playbook drafts on the next weekly run
                  </p>
                </section>
              );
            }
            const s = stack;
            const layers = parseLayers(s.layers);
            const recipe = layers.map((l) => {
              const m = matchEntity(l.pick, entities);
              return m ? m.name : l.pick.split(' (')[0].slice(0, 26);
            });
            return (
              <Card key={venture.slug} className="anim-in !p-5" style={{ animationDelay: `${idx * 60}ms` }}>
                <CardContent className="p-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="readout text-phosphor">
                    &#9646; {venture.label}
                  </span>
                  <h2 className="type-h3">{s.title}</h2>
                  {s.tagline && (
                    <span className="text-[12.5px] text-ink-3">
                      {s.tagline}
                    </span>
                  )}
                </div>

                {recipe.length > 0 && (
                  <p className="mono mt-2 text-[11px] tracking-[0.02em] text-ink-3">
                    {recipe.join(' → ')}
                  </p>
                )}

                <div className="mono mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
                  {s.timeToMvp && (
                    <span>
                      <span className="text-ink-4">time to mvp</span> {s.timeToMvp}
                    </span>
                  )}
                  {s.costNote && (
                    <span>
                      <span className="text-ink-4">run cost</span> {s.costNote}
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
                          <td data-label="layer" className="mono text-[10.5px] uppercase text-ink-4">
                            {l.layer}
                          </td>
                          <td data-label="pick">
                            <PickText text={l.pick} entities={entities} strong />
                          </td>
                          <td data-label="alternative">
                            {l.alt ? <PickText text={l.alt} entities={entities} /> : <span className="text-ink-4">—</span>}
                          </td>
                          <td data-label="note" className="text-[12.5px]">{l.note ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {s.rationale && (
                  <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
                    {s.rationale}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-start justify-between gap-3 border-t border-grat-soft pt-3">
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
                  <div className="flex shrink-0 items-center gap-4">
                    <CopyButton text={stackMarkdown(venture.label, s, layers)} />
                    <span className="mono text-[10px] text-ink-4">
                      updated {timeAgo(s.updatedAt)}
                    </span>
                  </div>
                </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
