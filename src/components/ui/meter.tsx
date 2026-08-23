import { cn } from '@/lib/utils';

export function Meter({
  value,
  max = 100,
  className,
  barClassName,
  height = 3,
  animate = true,
}: {
  value: number;
  max?: number;
  className?: string;
  barClassName?: string;
  height?: 3 | 4 | 5;
  animate?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className={cn('w-full overflow-hidden rounded-[1px] bg-scope-inset', className)}
      style={{ height }}
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div
        className={cn('h-full rounded-[1px] bg-phosphor', animate && 'anim-bar', barClassName)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
