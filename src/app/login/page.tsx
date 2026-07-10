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
      setError(res.status === 401 ? 'Invalid name or password.' : 'Login failed. Try again.');
    } catch {
      setError('Login failed. Try again.');
    }
    setBusy(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form onSubmit={onSubmit} className="card w-full max-w-[340px]">
        <h1 className="text-[15px] font-bold tracking-tight">
          Runelabs <span style={{ color: 'var(--accent)' }}>Radar</span>
        </h1>
        <p className="muted mt-1 text-[12px]">Sign in with your team account.</p>

        <label htmlFor="login-name" className="muted mt-4 block text-[12px]">
          Name
        </label>
        <input
          id="login-name"
          className="input mt-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="username"
          autoFocus
          required
        />

        <label htmlFor="login-password" className="muted mt-3 block text-[12px]">
          Password
        </label>
        <input
          id="login-password"
          type="password"
          className="input mt-1"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        {error && (
          <p className="mt-3 text-[12px]" style={{ color: 'var(--down)' }} role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="btn btn-primary mt-4 w-full justify-center disabled:opacity-60"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
