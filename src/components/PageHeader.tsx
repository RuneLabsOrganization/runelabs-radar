import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Shared page header: kicker readout (the flavor line) + h1 + one-line
 * plain-English description. Every page under /app uses this so a first-time
 * visitor always gets "what is this page" in the same spot, at the same size.
 *
 * `tone="phosphor"` marks a workspace OVERVIEW (/app/decide, /app/build). Leaf
 * pages take the neutral kicker, so the phosphor keeps meaning "you are at the
 * top of a workspace" instead of meaning nothing at all.
 */
export default function PageHeader({
  kicker,
  title,
  description,
  tone,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  tone?: 'phosphor';
}) {
  return (
    <div>
      {kicker && (
        <div className={cn('readout', tone === 'phosphor' && 'text-phosphor')}>{kicker}</div>
      )}
      <h1 className="type-h1 mt-1">{title}</h1>
      {description && (
        <p className="mt-1.5 max-w-[640px] text-[13px] leading-relaxed text-ink-3">{description}</p>
      )}
    </div>
  );
}
