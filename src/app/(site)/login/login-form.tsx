'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth/client';
import { paths } from '@/lib/urls';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SocialButtons } from '@/components/auth/SocialButtons';

export function LoginForm({ google, github }: { google: boolean; github: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || paths.app;
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error: err } = await authClient.signIn.email({
      email: email.trim(),
      password,
      callbackURL: next,
    });
    setPending(false);
    if (err) {
      // Fallback: legacy operator login (name + password via old API)
      const legacy = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: email.trim(), password }),
      });
      if (legacy.ok) {
        router.push(next);
        router.refresh();
        return;
      }
      setError(err.message ?? 'Sign in failed');
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <Card className="relative w-full max-w-md">
      <CardHeader>
        <CardTitle className="type-h1">Welcome back</CardTitle>
        <CardDescription>
          Pick up where you left off — your plans, your saved work, and what changed since your last visit.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {(google || github) && (
          <div className="mb-4 space-y-3">
            <SocialButtons google={google} github={github} callbackURL={paths.app} />
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-grat" />
              <span className="text-[12px] text-ink-3">or</span>
              <div className="h-px flex-1 bg-grat" />
            </div>
          </div>
        )}
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email or name</Label>
            <Input
              id="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="password">Password</Label>
              <Link href={paths.forgotPassword} className="text-[12px] text-phosphor hover:underline">
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          {error && <p className="text-[12.5px] text-alert">{error}</p>}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className="mt-4 text-center text-[12.5px] text-ink-3">
          New here?{' '}
          <Link href={paths.signup} className="text-phosphor hover:underline">
            Create a free account
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
