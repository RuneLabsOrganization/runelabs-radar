'use client';

import * as React from 'react';
import { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth/client';
import { accountCheckoutPath, paths } from '@/lib/urls';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [agreed, setAgreed] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!agreed) return;
    setPending(true);
    setError(null);
    const plan = params.get('plan');
    const next =
      plan === 'builder' || plan === 'factory'
        ? accountCheckoutPath(plan, params.get('interval') === 'annual')
        : paths.app;
    const { error: err } = await authClient.signUp.email({
      name: name.trim() || email.split('@')[0],
      email: email.trim(),
      password,
      callbackURL: next,
    });
    setPending(false);
    if (err) {
      setError(err.message ?? 'Sign up failed');
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center px-4 py-12">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="type-h1">Stop guessing what to use</CardTitle>
          <CardDescription>
            Free forever: every verdict, every setup, every brief, no limits. Plus three ideas a month turned into a
            full plan. No card.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
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
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
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
            <div className="flex items-start gap-2 pt-1">
              <input
                id="agree"
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--phosphor)]"
              />
              <Label htmlFor="agree" className="text-[12.5px] font-normal leading-snug text-ink-2">
                I agree to the{' '}
                <Link href={paths.terms} className="text-phosphor hover:underline">
                  Terms
                </Link>{' '}
                and{' '}
                <Link href={paths.privacy} className="text-phosphor hover:underline">
                  Privacy Policy
                </Link>
              </Label>
            </div>
            {error && <p className="text-[12.5px] text-alert">{error}</p>}
            <Button type="submit" className="w-full" disabled={pending || !agreed}>
              {pending ? 'Creating…' : 'Create free account'}
            </Button>
          </form>
          <p className="mt-4 text-center text-[12.5px] text-ink-3">
            Already have an account?{' '}
            <Link href={paths.login} className="text-phosphor hover:underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto flex min-h-[70vh] max-w-md items-center px-4 py-12">
          <Card className="w-full">
            <CardHeader>
              <CardTitle className="type-h1">Stop guessing what to use</CardTitle>
            </CardHeader>
          </Card>
        </div>
      }
    >
      <SignupForm />
    </Suspense>
  );
}
