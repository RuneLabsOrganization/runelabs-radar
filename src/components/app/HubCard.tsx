import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A destination cell on a workspace overview.
 *
 * The whole cell is the link — an "Open" button inside a card that is already
 * one link is a second name for the same target, and it makes every cell read
 * as equally important. Hierarchy comes from `feature`, which gives the one
 * destination people actually came for the wider cell and the larger title.
 */
export function HubCard({
  href,
  title,
  desc,
  icon: Icon,
  feature = false,
  meta,
  className,
}: {
  href: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  feature?: boolean;
  meta?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'hover-raise group flex h-full flex-col rounded-[6px] border border-grat-soft bg-scope-1 p-4 hover:border-grat-strong focus-visible:border-phosphor focus-visible:outline-none',
        feature && 'bg-scope-2 p-5',
        className,
      )}
    >
      <Icon className={cn('text-phosphor', feature ? 'h-[18px] w-[18px]' : 'h-4 w-4')} aria-hidden />
      <h2 className={cn('mt-2.5 text-ink', feature ? 'type-h2' : 'type-h3')}>{title}</h2>
      <p
        className={cn(
          'mt-1.5 flex-1 leading-relaxed text-ink-3',
          feature ? 'text-[13px]' : 'text-[12.5px]',
        )}
      >
        {desc}
      </p>
      <div className="mono mt-3 flex items-baseline gap-2 text-[10px] uppercase tracking-[0.1em] text-ink-4">
        {meta && <span>{meta}</span>}
        <span aria-hidden className="ml-auto transition-colors group-hover:text-phosphor">
          →
        </span>
      </div>
    </Link>
  );
}
