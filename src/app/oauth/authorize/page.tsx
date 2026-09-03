import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/user';
import { getClient, sanitizeScopes } from '@/lib/oauth';
import { redirectDestination } from '@/lib/urls';
import ConsentForm from './consent';

export const dynamic = 'force-dynamic';

interface AuthorizeParams {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  state: string;
  /** RFC 8707 resource indicator — accepted (and round-tripped through login); single resource server, so not audience-bound yet. */
  resource: string;
}

function validate(p: AuthorizeParams): string | null {
  if (p.response_type !== 'code') return 'response_type must be "code".';
  if (!p.client_id) return 'missing client_id.';
  const client = getClient(p.client_id);
  if (!client) return 'unknown client — the agent must register first (RFC 7591).';
  if (!p.redirect_uri || !client.redirectUris.includes(p.redirect_uri)) {
    return 'redirect_uri is not registered for this client.';
  }
  // OAuth 2.1 / MCP: PKCE S256 is mandatory (method must be explicit)
  if (!p.code_challenge || p.code_challenge.length < 43) return 'missing PKCE code_challenge.';
  if (p.code_challenge_method !== 'S256') {
    return 'code_challenge_method must be S256.';
  }
  return null;
}

function ErrorCard({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="card w-full max-w-[420px] !p-6">
        <div className="mono text-[11.5px] font-semibold tracking-[0.16em] text-[var(--ink)]">
          MCP AUTHORIZATION
        </div>
        <p className="mt-4 text-[13px]" style={{ color: 'var(--alert)' }} role="alert">
          {message}
        </p>
        <p className="readout mt-3">the request was rejected before any redirect — nothing was granted.</p>
      </div>
    </main>
  );
}

/**
 * OAuth 2.1 authorization endpoint for MCP clients. The user logs in (hub
 * session), sees what the agent is asking for, and approves — the agent
 * receives an authorization code it exchanges for tokens at /api/oauth/token.
 */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string): string => {
    const v = sp[k];
    return typeof v === 'string' ? v : '';
  };
  const params: AuthorizeParams = {
    client_id: one('client_id'),
    redirect_uri: one('redirect_uri'),
    response_type: one('response_type'),
    code_challenge: one('code_challenge'),
    code_challenge_method: one('code_challenge_method'),
    scope: one('scope'),
    state: one('state'),
    resource: one('resource'),
  };

  const error = validate(params);
  if (error) return <ErrorCard message={error} />;

  const user = await getCurrentUser();
  if (!user) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v) as [string, string][],
    ).toString();
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${qs}`)}`);
  }

  const client = getClient(params.client_id);
  const scopes = sanitizeScopes(params.scope).split(' ');
  // The client name is attacker-chosen (open dynamic registration) — the
  // redirect destination is the ground truth the user must consent to.
  const dest = redirectDestination(params.redirect_uri);
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="card w-full max-w-[420px] !p-6">
        <div className="mono flex items-center gap-2 text-[11.5px] font-semibold tracking-[0.16em] text-[var(--ink)]">
          <span aria-hidden className="inline-block h-[10px] w-[3px]" style={{ background: 'var(--phosphor)' }} />
          MCP AUTHORIZATION
        </div>
        <p className="mt-4 text-[13.5px] text-[var(--ink-2)]">
          <strong className="text-[var(--ink)]">{client?.name ?? 'An AI agent'}</strong> wants to connect to your
          Radar intelligence feed.
        </p>
        {dest && (
          <div
            className="mt-3 rounded-[4px] border px-3 py-2.5"
            style={{ borderColor: 'var(--grat-strong)', background: 'var(--grat-soft)' }}
          >
            <div className="readout">access tokens go to</div>
            <div className="mono mt-1 break-all text-[13px] font-semibold text-[var(--ink)]">
              {!dest.https && dest.host && <span style={{ color: 'var(--alert)' }}>{dest.scheme}://</span>}
              {dest.host || params.redirect_uri}
            </div>
            {!dest.https && (
              <p className="mt-1 text-[11.5px]" style={{ color: 'var(--alert)' }}>
                not https — the authorization code leaves this site over “{dest.scheme}”.
              </p>
            )}
          </div>
        )}
        <ul className="mt-4 space-y-2">
          {scopes.map((s) => (
            <li key={s} className="flex items-start gap-2 text-[12.5px] text-[var(--ink-3)]">
              <span aria-hidden className="mono mt-0.5 text-[10px] uppercase" style={{ color: 'var(--phosphor)' }}>
                {s}
              </span>
              <span>
                {s === 'read'
                  ? 'Read briefs, signals, board, stacks, opportunities, and all other intelligence.'
                  : s === 'plans'
                    ? 'Generate execution plans for opportunities (uses server LLM budget).'
                    : s === 'batches'
                      ? 'Create and run workspace batches — bulk debate and plan runs.'
                      : s}
              </span>
            </li>
          ))}
        </ul>
        <ConsentForm
          clientId={params.client_id}
          redirectUri={params.redirect_uri}
          codeChallenge={params.code_challenge}
          codeChallengeMethod={params.code_challenge_method}
          scope={scopes.join(' ')}
          state={params.state}
        />
        <p className="readout mt-4">signed in as {user.name} — tokens can be revoked by re-seeding your account.</p>
      </div>
    </main>
  );
}
