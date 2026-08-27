'use client';

import * as React from 'react';
import Link from 'next/link';
import { authClient } from '@/lib/auth/client';
import { paths } from '@/lib/urls';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import RadarBackdrop from '@/components/RadarBackdrop';

export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error: err } = await authClient.requestPasswordReset({
      email: email.trim(),
      redirectTo: paths.resetPassword,
    });
    setPending(false);
    if (err) {
      setError(err.message ?? 'Could not send reset email');
      return;
    }
    setSent(true);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-30">
        <RadarBackdrop intensity={0.12} />
      </div>
      <Card className="relative w-full max-w-md">
        <CardHeader>
          <CardTitle className="type-h1">Forgot password</CardTitle>
          <CardDescription>
            Enter the email on your account and we&apos;ll send a reset link if it exists.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <p className="text-[13px] text-ink-2">If that account exists, we sent a link.</p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
              {error && <p className="text-[12.5px] text-alert">{error}</p>}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? 'Sending…' : 'Send reset link'}
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
    </div>
  );
}
