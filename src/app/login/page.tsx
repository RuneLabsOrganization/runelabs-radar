'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import RadarBackdrop from '@/components/RadarBackdrop';

/** Open-redirect guard: only same-site absolute paths (no protocol-relative '//'). */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password }),
      });
      if (res.ok) {
        // Keep the button disabled while navigating.
        router.push(safeNext(searchParams.get('next')));
        router.refresh();
        return;
      }
      if (res.status === 429) {
        setError('Too many attempts — try again later.');
      } else {
        setError(res.status === 401 ? 'Invalid name or password.' : 'Login failed. Try again.');
      }
    } catch {
      setError('Login failed. Try again.');
    }
    setBusy(false);
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center px-6">
      <div aria-hidden className="absolute inset-0">
        <RadarBackdrop intensity={0.5} />
      </div>
      <form onSubmit={onSubmit} className="card anim-in relative z-10 w-full max-w-[340px] !p-6">
        <div className="mono flex items-center gap-2 text-[11.5px] font-semibold tracking-[0.16em] text-[var(--ink)]">
          <span aria-hidden className="inline-block h-[10px] w-[3px]" style={{ background: 'var(--phosphor)' }} />
          RUNELABS RADAR
        </div>
        <p className="readout mt-2">operator access</p>

        <label htmlFor="login-name" className="readout mt-6 block">
          Name
        </label>
        <input
          id="login-name"
          className="input mt-1.5"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="username"
          autoFocus
          required
        />

        <label htmlFor="login-password" className="readout mt-4 block">
          Password
        </label>
        <input
          id="login-password"
          type="password"
          className="input mt-1.5"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        {error && (
          <p className="mt-3 text-[12px]" style={{ color: 'var(--alert)' }} role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="btn btn-primary mt-5 w-full justify-center disabled:opacity-60"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="mt-4 text-center">
          <Link
            href="/"
            className="mono text-[10px] uppercase tracking-[0.08em]"
            style={{ color: 'var(--ink-4)' }}
          >
            ← back to radar
          </Link>
        </p>
      </form>
    </main>
  );
}

export default function LoginPage() {
  // Next 15 requires a Suspense boundary around useSearchParams for prerendering
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
