'use client';

import Link from 'next/link';
import { Lock } from 'lucide-react';
import { paths } from '@/lib/urls';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** First-class gate UI — never a disabled button without explanation. */
export function UpgradeWall({
  title = 'Members only',
  reason,
  upgradeHint,
  signedIn = false,
}: {
  title?: string;
  reason?: string;
  upgradeHint?: string;
  signedIn?: boolean;
}) {
  return (
    <Card className="border-phosphor/25 bg-phosphor-dim/30">
      <CardHeader>
        <div className="flex items-center gap-2 text-phosphor">
          <Lock className="h-4 w-4" />
          <CardTitle className="text-[14px]">{title}</CardTitle>
        </div>
        <CardDescription className="text-[13px] text-ink-2">
          {reason ?? 'This action requires a membership.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {signedIn ? (
          <>
            <Button asChild size="sm">
              <Link href={paths.pricing}>{upgradeHint ?? 'Upgrade'}</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={paths.account}>Account</Link>
            </Button>
          </>
        ) : (
          <>
            <Button asChild size="sm">
              <Link href={paths.signup}>Create free account</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={paths.login}>Sign in</Link>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
