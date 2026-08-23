import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

/** Unified filter / toggle chip — replaces ~10 duplicated implementations. */
export function Chip({ active, className, children, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors',
        active
          ? 'border-transparent bg-phosphor-dim text-phosphor'
          : 'border-grat text-ink-3 hover:border-grat-strong hover:text-ink-2',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function ChipGroup({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('flex flex-wrap items-center gap-1.5', className)}>{children}</div>;
}
