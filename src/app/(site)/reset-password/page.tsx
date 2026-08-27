'use client';

import * as React from 'react';
import { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth/client';
import { paths } from '@/lib/urls';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import RadarBackdrop from '@/components/RadarBackdrop';
import { Skeleton } from '@/components/ui/skeleton';

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      setError('Reset link is missing or invalid');
      return;
    }
    setPending(true);
    setError(null);
    const { error: err } = await authClient.resetPassword({
      newPassword: password,
      token,
    });
    setPending(false);
    if (err) {
      setError(err.message ?? 'Could not reset password');
      return;
    }
    router.push(paths.login);
    router.refresh();
  }

  return (
    <Card className="relative w-full max-w-md">
      <CardHeader>
        <CardTitle className="type-h1">Set a new password</CardTitle>
        <CardDescription>Choose a new password for your Radar account.</CardDescription>
      </CardHeader>
      <CardContent>
        {!token || params.get('error') === 'INVALID_TOKEN' ? (
          <p className="text-[13px] text-alert">
            This reset link is invalid or expired.{' '}
            <Link href={paths.forgotPassword} className="text-phosphor hover:underline">
              Request a new one
            </Link>
            .
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            {error && <p className="text-[12.5px] text-alert">{error}</p>}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Saving…' : 'Update password'}
            </Button>
          </form>
        )}
        <p className="mt-4 text-center text-[12.5px] text-ink-3">
          <Link href={paths.login} className="text-phosphor hover:underline">
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

function ResetFallback() {
  return (
    <Card className="relative w-full max-w-md">
      <CardHeader>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-4 w-full" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-30">
        <RadarBackdrop intensity={0.12} />
      </div>
      <Suspense fallback={<ResetFallback />}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
