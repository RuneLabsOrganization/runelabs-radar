import { cn } from '@/lib/utils';

export function SectionHeader({
  label,
  count,
  action,
  className,
}: {
  label: string;
  count?: number | string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 mt-7 flex items-center gap-3 first:mt-0', className)}>
      <div className="readout shrink-0">{label}</div>
      <div className="hairline-grow h-px min-w-0 flex-1 bg-grat" />
      {count != null && (
        <span className="mono shrink-0 text-[10.5px] uppercase tracking-[0.08em] text-ink-4">{count}</span>
      )}
      {action}
    </div>
  );
}
