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

function LoginForm() {
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
            <Label htmlFor="password">Password</Label>
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

function LoginFallback() {
  return (
    <Card className="relative w-full max-w-md">
      <CardHeader>
        <Skeleton className="h-7 w-28" />
        <Skeleton className="mt-2 h-4 w-full" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-30">
        <RadarBackdrop intensity={0.12} />
      </div>
      <Suspense fallback={<LoginFallback />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
