'use client';

import { useState } from 'react';

/** Consent buttons for the MCP OAuth authorization page. */
export default function ConsentForm(props: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  state: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function deny() {
    const url = new URL(props.redirectUri);
    url.searchParams.set('error', 'access_denied');
    if (props.state) url.searchParams.set('state', props.state);
    window.location.href = url.toString();
  }

  async function allow() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/oauth/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: props.clientId,
          redirect_uri: props.redirectUri,
          code_challenge: props.codeChallenge,
          code_challenge_method: props.codeChallengeMethod,
          scope: props.scope,
          state: props.state,
        }),
      });
      const data = (await res.json()) as { redirect?: string; error?: string };
      if (res.ok && data.redirect) {
        window.location.href = data.redirect;
        return;
      }
      setError(data.error ?? 'Authorization failed.');
    } catch {
      setError('Authorization failed. Try again.');
    }
    setBusy(false);
  }

  return (
    <div className="mt-6">
      {error && (
        <p className="mb-3 text-[12px]" style={{ color: 'var(--alert)' }} role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button onClick={allow} disabled={busy} className="btn btn-primary flex-1 justify-center disabled:opacity-60">
          {busy ? 'Authorizing…' : 'Allow'}
        </button>
        <button onClick={deny} disabled={busy} className="btn flex-1 justify-center disabled:opacity-60">
          Deny
        </button>
      </div>
    </div>
  );
}
