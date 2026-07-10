'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface VerdictEditorProps {
  entryId: number;
  verdict: string | null;
  author: string | null;
}

export default function VerdictEditor({ entryId, verdict, author }: VerdictEditorProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setText(verdict ?? '');
    setError(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/verdicts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId, verdict: text }),
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
          disabled={saving}
          autoFocus
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn" onClick={() => setEditing(false)} disabled={saving}>
            Cancel
          </button>
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
      )}
    </button>
  );
}
