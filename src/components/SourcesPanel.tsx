'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';

const SOURCE_TYPES = ['rss', 'hn', 'reddit', 'arxiv', 'huggingface', 'github', 'brave'] as const;

export interface SourceRow {
  id: number;
  type: string;
  name: string;
  config: string;
  domainHints: string;
  enabled: boolean;
  lastStatus: string | null;
  lastFetchedAt: string | null; // ISO string
  consecutiveFailures: number;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function health(s: SourceRow): ReactNode {
  if (s.lastFetchedAt === null) {
    return <span className="muted">never</span>;
  }
  if (s.consecutiveFailures > 0) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span
          className="badge"
          style={{ color: 'var(--down)', borderColor: 'var(--down)' }}
          title={s.lastStatus ?? undefined}
        >
          {s.consecutiveFailures} failure{s.consecutiveFailures === 1 ? '' : 's'}
        </span>
        {s.lastStatus && (
          <span className="muted" title={s.lastStatus}>
            {truncate(s.lastStatus, 60)}
          </span>
        )}
      </span>
    );
  }
  return (
    <span
      className="badge"
      style={{ color: 'var(--up)', borderColor: 'var(--up)' }}
      title={s.lastFetchedAt}
    >
      ok
    </span>
  );
}

const emptyForm = { type: 'rss', name: '', config: '{}', domainHints: '' };

export default function SourcesPanel({ sources }: { sources: SourceRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function toggle(s: SourceRow) {
    setBusyId(s.id);
    setRowError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/sources/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !s.enabled }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(s: SourceRow) {
    if (!confirm(`Delete source "${s.name}"?`)) return;
    setBusyId(s.id);
    setRowError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/sources/${s.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      const data = (await res.json().catch(() => null)) as { softDisabled?: boolean } | null;
      if (data?.softDisabled) {
        setNote(`"${s.name}" already has ingested items, so it was disabled instead of deleted.`);
      }
      router.refresh();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusyId(null);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!form.name.trim()) {
      setFormError('Name is required.');
      return;
    }
    let configObj: unknown;
    try {
      configObj = JSON.parse(form.config.trim() || '{}');
    } catch {
      setFormError('Config must be valid JSON.');
      return;
    }
    if (typeof configObj !== 'object' || configObj === null || Array.isArray(configObj)) {
      setFormError('Config must be a JSON object, e.g. {"url": "https://…"}.');
      return;
    }
    const domainHints = form.domainHints
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);

    setSubmitting(true);
    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: form.type,
          name: form.name.trim(),
          config: configObj,
          domainHints,
          enabled: true,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      setForm(emptyForm);
      router.refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card overflow-x-auto" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Health</th>
            <th>Enabled</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sources.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No sources configured.
              </td>
            </tr>
          )}
          {sources.map((s) => (
            <tr key={s.id}>
              <td style={{ fontWeight: 600 }}>{s.name}</td>
              <td className="muted">{s.type}</td>
              <td>{health(s)}</td>
              <td>
                <input
                  type="checkbox"
                  checked={s.enabled}
                  disabled={busyId === s.id}
                  onChange={() => toggle(s)}
                  aria-label={`${s.enabled ? 'Disable' : 'Enable'} ${s.name}`}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busyId === s.id}
                  onClick={() => remove(s)}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {note && <p className="muted" style={{ fontSize: 12 }}>{note}</p>}
      {rowError && <p style={{ color: 'var(--down)', fontSize: 12 }}>{rowError}</p>}

      <form onSubmit={add} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 className="section-title" style={{ marginBottom: 0 }}>
          Add source
        </h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            className="input"
            style={{ width: 160 }}
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            aria-label="Source type"
          >
            {SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            className="input"
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            aria-label="Source name"
          />
        </div>
        <textarea
          className="input"
          rows={3}
          placeholder='Config JSON, e.g. {"url": "https://example.com/feed.xml"}'
          value={form.config}
          onChange={(e) => setForm({ ...form, config: e.target.value })}
          aria-label="Source config JSON"
          style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
        />
        <input
          className="input"
          placeholder="Domain hints, comma-separated (e.g. coding, agentic)"
          value={form.domainHints}
          onChange={(e) => setForm({ ...form, domainHints: e.target.value })}
          aria-label="Domain hints"
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add source'}
          </button>
          {formError && <span style={{ color: 'var(--down)', fontSize: 12 }}>{formError}</span>}
        </div>
      </form>
    </div>
  );
}
