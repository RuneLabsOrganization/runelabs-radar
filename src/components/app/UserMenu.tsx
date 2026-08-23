'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { paths } from '@/lib/urls';
import LogoutButton from '@/components/LogoutButton';
import { Button } from '@/components/ui/button';

export function UserMenu({ userName }: { userName: string | null }) {
  const pathname = usePathname();

  if (!userName) {
    // carry the current route so signing in returns you where you were
    return (
      <Button asChild size="sm">
        <Link href={`${paths.login}?next=${encodeURIComponent(pathname)}`}>Sign in</Link>
      </Button>
    );
  }

  return (
    <div className="hidden items-center gap-2 sm:flex">
      <Link
        href={paths.account}
        className="mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-2"
      >
        {userName}
      </Link>
      <LogoutButton />
    </div>
  );
}
