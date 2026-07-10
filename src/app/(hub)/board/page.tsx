import { desc, gte } from 'drizzle-orm';
import type { ReactNode } from 'react';
import ModelScatter from '@/components/ModelScatter';
import VerdictEditor from '@/components/VerdictEditor';
import SectionHeader from '@/components/SectionHeader';
import { aaModels } from '@/lib/analytics';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { boardEntries, boardHistory } from '@/lib/db/schema';
import { DOMAIN_COLORS, DOMAIN_LABELS, DOMAINS, isDomain } from '@/lib/domains';

type BoardEntry = typeof boardEntries.$inferSelect;

function cell(value: string | null): ReactNode {
  return value ? value : <span style={{ color: 'var(--ink-4)' }}>—</span>;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function domainLabel(domain: string): string {
  return isDomain(domain) ? DOMAIN_LABELS[domain] : domain;
}

export default async function BoardPage() {
  const user = await requireViewer();
  const db = getDb();
  const aa = aaModels();

  const entries = db
    .select()
    .from(boardEntries)
    .orderBy(boardEntries.domain, boardEntries.task)
    .all();

  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const history = db
    .select()
    .from(boardHistory)
    .where(gte(boardHistory.appliedAt, cutoff))
    .orderBy(desc(boardHistory.appliedAt))
    .all();

  const byDomain = new Map<string, BoardEntry[]>();
  for (const entry of entries) {
    const list = byDomain.get(entry.domain) ?? [];
    list.push(entry);
    byDomain.set(entry.domain, list);
  }

  return (
    <div className="mx-auto max-w-[860px] px-6 py-7">
      <div className="readout">cost-benefit board &middot; weekly sync, human-approved</div>
      <h1 className="mt-1 text-[17px] font-semibold tracking-[-0.01em]">Best Right Now</h1>

      {aa && aa.models.length > 0 && (
        <>
          <SectionHeader label="The market — quality vs price" />
          <ModelScatter models={aa.models} fetchedAt={aa.fetchedAt} />
        </>
      )}

      {entries.length === 0 && (
        <p className="mono mt-6 text-[12px]" style={{ color: 'var(--ink-4)' }}>
          No board entries yet — the weekly board job drafts proposals; approved ones land here.
        </p>
      )}

      {DOMAINS.map((domain) => {
        const rows = byDomain.get(domain);
        if (!rows || rows.length === 0) return null;
        return (
          <section key={domain}>
            <div className="mt-9 mb-2 flex items-center gap-3">
              <span className="readout inline-flex items-center gap-2" style={{ color: 'var(--ink-3)' }}>
                <span aria-hidden className="inline-block h-[10px] w-[2px]" style={{ background: DOMAIN_COLORS[domain] }} />
                {DOMAIN_LABELS[domain]}
              </span>
              <span aria-hidden className="h-px flex-1" style={{ background: 'var(--grat-soft)' }} />
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th className="w-[16%]">Task</th>
                  <th className="w-[15%]">Best overall</th>
                  <th className="w-[15%]">Best value</th>
                  <th className="w-[15%]">Cheapest viable</th>
                  <th className="w-[19%]">Cost note</th>
                  <th>Runelabs verdict</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={entry.id}>
                    <td className="mono text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
                      {entry.task}
                    </td>
                    <td style={{ color: 'var(--ink)' }}>{cell(entry.bestOverall)}</td>
                    <td>{cell(entry.bestValue)}</td>
                    <td>{cell(entry.cheapestViable)}</td>
                    <td className="text-[12.5px]">{cell(entry.costNote)}</td>
                    <td>
                      <VerdictEditor
                        entryId={entry.id}
                        verdict={entry.runelabsVerdict}
                        author={entry.verdictAuthor}
                        canEdit={!!user}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}

      <SectionHeader label="Changed recently" count={history.length} />
      {history.length === 0 ? (
        <p className="mono text-[12px]" style={{ color: 'var(--ink-4)' }}>
          No board changes in the last 14 days.
        </p>
      ) : (
        <ul className="flex flex-col">
          {history.map((h) => (
            <li
              key={h.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-[var(--grat-soft)] py-[7px] text-[13px] last:border-b-0"
            >
              <span className="mono shrink-0 text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
                {fmtDate(h.appliedAt)}
              </span>
              <span className="mono shrink-0 text-[11px]" style={{ color: 'var(--ink-3)' }}>
                {domainLabel(h.domain)} / {h.task}
              </span>
              <span className="min-w-0" style={{ color: 'var(--ink-2)' }}>
                {h.change}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
