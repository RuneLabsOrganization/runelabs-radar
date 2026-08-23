import { cn } from '@/lib/utils';

export function ChartFrame({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <div className={cn('chart-frame relative rounded-lg border border-grat-soft bg-scope-1 p-3', className)}>
      {title && <div className="readout mb-2">{title}</div>}
      {children}
    </div>
  );
}

export function ChartGrid({ width, height, xTicks = 4, yTicks = 4 }: { width: number; height: number; xTicks?: number; yTicks?: number }) {
  const xs = Array.from({ length: xTicks + 1 }, (_, i) => (i / xTicks) * width);
  const ys = Array.from({ length: yTicks + 1 }, (_, i) => (i / yTicks) * height);
  return (
    <g aria-hidden>
      {xs.map((x) => (
        <line key={`x${x}`} x1={x} y1={0} x2={x} y2={height} stroke="var(--grat-soft)" strokeWidth={1} />
      ))}
      {ys.map((y) => (
        <line key={`y${y}`} x1={0} y1={y} x2={width} y2={y} stroke="var(--grat-soft)" strokeWidth={1} />
      ))}
    </g>
  );
}

export function ChartAxisLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <text className={cn('fill-[var(--ink-4)] font-mono text-[9px] uppercase tracking-wider', className)}>
      {children}
    </text>
  );
}

export function ChartLegend({
  items,
}: {
  items: { label: string; color: string }[];
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-3">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: it.color }} />
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-4">{it.label}</span>
        </div>
      ))}
    </div>
  );
}
