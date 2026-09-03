'use client';

// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth/client';

interface LogoutRouter {
  push(path: string): void;
  refresh(): void;
}

/**
 * End every session the hub may have issued: the Better Auth cookie (primary)
 * and the legacy radar_session cookie (seeded CLI operators). Both are
 * attempted even when one fails so whatever can be cleared is cleared.
 * Returns true only when both ended — anything less means the user is still
 * authenticated somewhere.
 */
export async function performLogout(): Promise<boolean> {
  let ok = true;
  try {
    const { error } = await authClient.signOut();
    if (error) ok = false;
  } catch {
    ok = false;
  }
  try {
    const res = await fetch('/api/auth/logout', { method: 'POST' });
    if (!res.ok) ok = false;
  } catch {
    ok = false;
  }
  return ok;
}

/**
 * Navigate to /login only after a full logout. On failure the session cookie
 * is still valid — landing on /login would read as logged out when it isn't,
 * so the caller stays put and re-enables the button instead.
 */
export async function runLogout(router: LogoutRouter): Promise<boolean> {
  if (!(await performLogout())) return false;
  router.push('/login');
  router.refresh();
  return true;
}

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    if (busy) return;
    setBusy(true);
    if (!(await runLogout(router))) setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      className="vote-btn mono text-[10.5px] tracking-[0.1em] uppercase"
    >
      {busy ? '…' : 'exit'}
    </button>
  );
}
