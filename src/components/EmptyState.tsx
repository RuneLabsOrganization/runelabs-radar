import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function EmptyState({
  kicker,
  title,
  description,
  action,
  className,
}: {
  kicker?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('py-10 text-center', className)}>
      {kicker && <div className="readout text-phosphor">{`\u25A6 ${kicker}`}</div>}
      <h3 className="type-h2 mt-2">{title}</h3>
      {description && (
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink-3">{description}</p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
