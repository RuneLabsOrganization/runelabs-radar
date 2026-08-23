import type { ReactNode } from 'react';

/**
 * Shared page header: kicker readout (the flavor line) + h1 + one-line
 * plain-English description. Every hub page uses this so a first-time
 * visitor always gets "what is this page" in the same spot.
 */
export default function PageHeader({
  kicker,
  title,
  description,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div>
      {kicker && <div className="readout">{kicker}</div>}
      <h1 className="type-h1 mt-1">{title}</h1>
      {description && (
        <p className="mt-1.5 max-w-[640px] text-[13px] leading-relaxed text-ink-3">{description}</p>
      )}
    </div>
  );
}
