import { desc, gte } from 'drizzle-orm';
import type { ReactNode } from 'react';
import VerdictEditor from '@/components/VerdictEditor';
import { requireUser } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { boardEntries, boardHistory } from '@/lib/db/schema';
import { DOMAIN_COLORS, DOMAIN_LABELS, DOMAINS, isDomain } from '@/lib/domains';

type BoardEntry = typeof boardEntries.$inferSelect;

function cell(value: string | null): ReactNode {
  return value ? value : <span className="muted">—</span>;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function domainLabel(domain: string): string {
  return isDomain(domain) ? DOMAIN_LABELS[domain] : domain;
}

export default async function BoardPage() {
  await requireUser();
  const db = getDb();

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h1 style={{ fontSize: 16, fontWeight: 600 }}>Best Right Now</h1>

      {entries.length === 0 && (
        <div className="card">
          <p className="muted">
            No board entries yet. The weekly board job drafts proposals; approved ones land here.
          </p>
        </div>
      )}

      {DOMAINS.map((domain) => {
        const rows = byDomain.get(domain);
        if (!rows || rows.length === 0) return null;
        return (
          <section key={domain} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: DOMAIN_COLORS[domain],
                  display: 'inline-block',
                  flexShrink: 0,
                }}
              />
              <h2 className="section-title" style={{ marginBottom: 0 }}>
                {DOMAIN_LABELS[domain]}
              </h2>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Best overall</th>
                  <th>Best value</th>
                  <th>Cheapest viable</th>
                  <th>Cost note</th>
                  <th>Runelabs verdict</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={entry.id}>
                    <td style={{ fontWeight: 600 }}>{entry.task}</td>
                    <td>{cell(entry.bestOverall)}</td>
                    <td>{cell(entry.bestValue)}</td>
                    <td>{cell(entry.cheapestViable)}</td>
                    <td>{cell(entry.costNote)}</td>
                    <td>
                      <VerdictEditor
                        entryId={entry.id}
                        verdict={entry.runelabsVerdict}
                        author={entry.verdictAuthor}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}

      <section className="card">
        <h2 className="section-title">Changed recently</h2>
        {history.length === 0 ? (
          <p className="muted">No board changes in the last 14 days.</p>
        ) : (
          <ul style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            {history.map((h) => (
              <li key={h.id}>
                <span className="muted">{fmtDate(h.appliedAt)}</span>{' '}
                <span style={{ fontWeight: 600 }}>
                  {domainLabel(h.domain)} / {h.task}
                </span>{' '}
                <span>{h.change}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
