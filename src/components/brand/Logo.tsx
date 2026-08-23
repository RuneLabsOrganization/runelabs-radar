import Link from 'next/link';
import { getIdentity } from '@/lib/identity';
import { cn } from '@/lib/utils';

const SIZES = {
  sm: { bar: 'h-[8px] w-[2px]', text: 'text-[10.5px]' },
  md: { bar: 'h-[10px] w-[3px]', text: 'text-[11.5px]' },
  lg: { bar: 'h-[12px] w-[3px]', text: 'text-[13px]' },
} as const;

export function Logo({
  size = 'md',
  href,
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  href?: string;
  className?: string;
}) {
  const name = getIdentity().productName;
  const s = SIZES[size];

  const lockup = (
    <span
      className={cn(
        'mono inline-flex items-center gap-2 font-semibold tracking-[0.16em] text-ink',
        s.text,
        className,
      )}
    >
      <span aria-hidden className={cn('inline-block shrink-0 bg-phosphor', s.bar)} />
      {name.toUpperCase()}
    </span>
  );

  if (href) {
    return (
      <Link href={href} className="shrink-0">
        {lockup}
      </Link>
    );
  }

  return lockup;
}
