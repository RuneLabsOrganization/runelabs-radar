// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';

/** Scope-readout section rule: label ── hairline ── count. */
export default function SectionHeader({
  label,
  count,
  tone,
}: {
  label: string;
  count?: number;
  tone?: 'phosphor';
}) {
  return (
    <div className="mt-9 mb-2 flex items-center gap-3">
      <span className="readout" style={tone === 'phosphor' ? { color: 'var(--phosphor)' } : undefined}>
        {tone === 'phosphor' && <span aria-hidden>&#9646; </span>}
        {label}
      </span>
      <span aria-hidden className="hairline-grow h-px flex-1" style={{ background: 'var(--grat-soft)' }} />
      {count !== undefined && (
        <span className="mono text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
          {count}
        </span>
      )}
    </div>
  );
}
