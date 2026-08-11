'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface VerdictEditorProps {
  entryId: number;
  verdict: string | null;
  author: string | null;
  /** false renders read-only text (anonymous visitors in public mode). */
  canEdit?: boolean;
  /** Which record the verdict belongs to: a board entry (default) or a stack. */
  kind?: 'board' | 'stack';
}

export default function VerdictEditor({
  entryId,
  verdict,
  author,
  canEdit = true,
  kind = 'board',
}: VerdictEditorProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) {
    return verdict ? (
      <span>
        {verdict}
        {author && <span className="muted"> — {author}</span>}
      </span>
    ) : (
      <span className="muted">—</span>
    );
  }

  function startEditing() {
    setText(verdict ?? '');
    setError(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(kind === 'stack' ? '/api/stack-verdicts' : '/api/verdicts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          kind === 'stack' ? { stackId: entryId, verdict: text } : { entryId, verdict: text },
        ),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 180 }}>
        <textarea
          className="input"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
            if (e.key === 'Escape') setEditing(false);
          }}
          disabled={saving}
          autoFocus
        />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn" onClick={() => setEditing(false)} disabled={saving}>
            Cancel
          </button>
          <span className="mono text-[10px]" style={{ color: 'var(--ink-4)' }}>
            ctrl+enter saves
          </span>
        </div>
        {error && <span style={{ color: 'var(--down)', fontSize: 12 }}>{error}</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      title="Edit verdict"
      className="verdict-edit"
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        font: 'inherit',
        color: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        display: 'block',
        width: '100%',
      }}
    >
      {verdict ? (
        <>
          <span>{verdict}</span>
          {author && <span className="muted"> — {author}</span>}
        </>
      ) : (
        <span className="muted">add verdict</span>
      )}{' '}
      <span className="verdict-pencil" aria-hidden>
        ✎
      </span>
    </button>
  );
}
