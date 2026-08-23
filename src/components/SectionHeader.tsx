/**
 * Legacy default export — wraps the shared ui/section-header so older
 * imports (`import SectionHeader from '@/components/SectionHeader'`) keep
 * working, including the phosphor tone used on hub feeds.
 */
import type { ReactNode } from 'react';
import { SectionHeader as UiSectionHeader } from '@/components/ui/section-header';
import { cn } from '@/lib/utils';

export default function SectionHeader({
  label,
  count,
  tone,
  action,
  className,
}: {
  label: string;
  count?: number | string;
  tone?: 'phosphor';
  action?: ReactNode;
  className?: string;
}) {
  return (
    <UiSectionHeader
      label={tone === 'phosphor' ? `\u25A6 ${label}` : label}
      count={count}
      action={action}
      className={cn(tone === 'phosphor' && '[&_.readout]:text-phosphor', className)}
    />
  );
}
