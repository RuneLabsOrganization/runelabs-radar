'use client';

import { useRouter } from 'next/navigation';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { DOMAIN_COLORS, DOMAIN_LABELS, isDomain } from '@/lib/domains';

export interface ProposedFields {
  bestOverall: string | null;
  bestValue: string | null;
  cheapestViable: string | null;
  costNote: string | null;
}

interface ProposalCardProps {
  id: number;
  domain: string;
  task: string;
  proposed: ProposedFields;
  rationale: string;
}

function cell(value: string | null): ReactNode {
  return value ? value : <span className="muted">—</span>;
}

export default function ProposalCard({ id, domain, task, proposed, rationale }: ProposalCardProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const domainStyle: CSSProperties | undefined = isDomain(domain)
    ? { color: DOMAIN_COLORS[domain], borderColor: DOMAIN_COLORS[domain] }
    : undefined;
  const label = isDomain(domain) ? DOMAIN_LABELS[domain] : domain;

  async function act(action: 'approve' | 'reject') {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/proposals/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
      setBusy(null);
    }
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="badge" style={domainStyle}>
          {label}
        </span>
        <span className="badge">{task}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="table">
        <tbody>
          <tr>
            <td className="muted" style={{ width: 140 }}>
              Best overall
            </td>
            <td>{cell(proposed.bestOverall)}</td>
          </tr>
          <tr>
            <td className="muted">Best value</td>
            <td>{cell(proposed.bestValue)}</td>
          </tr>
          <tr>
            <td className="muted">Cheapest viable</td>
            <td>{cell(proposed.cheapestViable)}</td>
          </tr>
          <tr>
            <td className="muted">Cost note</td>
            <td>{cell(proposed.costNote)}</td>
          </tr>
        </tbody>
      </table>
      </div>

      <p className="muted" style={{ fontSize: 13 }}>
        {rationale}
      </p>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy !== null}
          onClick={() => act('approve')}
        >
          {busy === 'approve' ? 'Approving…' : 'Approve'}
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy !== null}
          onClick={() => act('reject')}
        >
          {busy === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>

      {error && <p style={{ color: 'var(--down)', fontSize: 12 }}>{error}</p>}
    </div>
  );
}
