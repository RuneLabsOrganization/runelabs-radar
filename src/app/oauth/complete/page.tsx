import { browserLoopbackRedirect, isLoopbackRedirectUri } from '@/lib/oauth-loopback';
import CompleteClient from './complete-client';

export const dynamic = 'force-dynamic';

function ErrorCard({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="card w-full max-w-[520px] !p-6">
        <div className="mono text-[11.5px] font-semibold tracking-[0.16em] text-[var(--ink)]">
          MCP AUTHORIZATION
        </div>
        <p className="mt-4 text-[13px]" style={{ color: 'var(--alert)' }} role="alert">
          {message}
        </p>
      </div>
    </main>
  );
}

/**
 * Loopback handoff page. Desktop MCP clients register http://127.0.0.1:<port>/callback
 * but the local listener is often gone by the time the browser redirects — show the
 * full callback URL so the user can paste it back into the editor (Claude Code pattern).
 */
export default async function OAuthCompletePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = typeof sp.to === 'string' ? sp.to : '';
  if (!raw) return <ErrorCard message="missing callback target." />;

  let callbackUrl: string;
  try {
    callbackUrl = browserLoopbackRedirect(raw);
  } catch {
    return <ErrorCard message="invalid callback target." />;
  }
  if (!isLoopbackRedirectUri(callbackUrl)) {
    return <ErrorCard message="callback target must be a loopback URL." />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="card w-full max-w-[520px] !p-6">
        <div className="mono flex items-center gap-2 text-[11.5px] font-semibold tracking-[0.16em] text-[var(--ink)]">
          <span aria-hidden className="inline-block h-[10px] w-[3px]" style={{ background: 'var(--phosphor)' }} />
          AUTHORIZATION COMPLETE
        </div>
        <p className="mt-4 text-[13.5px] text-[var(--ink-2)]">
          Radar issued an authorization code for your MCP client. Your editor
          should finish connecting automatically.
        </p>
        <CompleteClient callbackUrl={callbackUrl} />
      </div>
    </main>
  );
}
