'use client';

import Link from 'next/link';
import { paths } from '@/lib/urls';
import LogoutButton from '@/components/LogoutButton';
import { Button } from '@/components/ui/button';

export function UserMenu({ userName }: { userName: string | null }) {
  if (!userName) {
    return (
      <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
        <Link href={paths.login}>Sign in</Link>
      </Button>
    );
  }
  return (
    <div className="hidden items-center gap-2 sm:flex">
      <Link href={paths.account} className="mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-2">
        {userName}
      </Link>
      <LogoutButton />
    </div>
  );
}
