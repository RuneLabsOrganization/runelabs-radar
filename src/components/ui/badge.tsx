import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors',
  {
    variants: {
      variant: {
        default: 'border-grat text-ink-3',
        phosphor: 'border-transparent bg-phosphor-dim text-phosphor',
        amber: 'border-transparent bg-amber-dim text-amber',
        alert: 'border-alert/40 text-alert',
        sector: 'border-grat text-ink-2',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
