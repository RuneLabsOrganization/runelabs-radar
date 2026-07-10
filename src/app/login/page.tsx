'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function LoginPage() {
  const router = useRouter();
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
        router.push('/');
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
    <main className="flex min-h-screen items-center justify-center px-6">
      <form onSubmit={onSubmit} className="card w-full max-w-[340px] !p-6">
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
      </form>
    </main>
  );
}
