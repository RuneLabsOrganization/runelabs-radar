import Link from 'next/link';
import { requireUser } from '@/lib/auth/user';
import { listUserConnections } from '@/lib/oauth';
import { paths } from '@/lib/urls';

export const dynamic = 'force-dynamic';

/**
 * The user's connected MCP agents, with a per-client disconnect action (drops
 * every grant the client holds). Linked from the consent screen; this is the
 * answer to "how do I un-connect an agent" that used to be "re-seed your
 * account".
 */
export default async function ConnectionsPage() {
  const user = await requireUser();
  const connections = listUserConnections(user.id);

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <div className="card w-full max-w-[480px] !p-6">
        <div className="mono flex items-center gap-2 text-[11.5px] font-semibold tracking-[0.16em] text-[var(--ink)]">
          <span aria-hidden className="inline-block h-[10px] w-[3px]" style={{ background: 'var(--phosphor)' }} />
          CONNECTED AGENTS
        </div>
        <p className="mt-4 text-[13.5px] text-[var(--ink-2)]">
          MCP clients that hold live access tokens for <strong className="text-[var(--ink)]">{user.name}</strong>.
          Disconnecting revokes all of the client&apos;s tokens immediately.
        </p>

        {connections.length === 0 ? (
          <p className="readout mt-5">no agents connected — nothing has been granted.</p>
        ) : (
          <ul className="mt-5 space-y-3">
            {connections.map((c) => (
              <li
                key={c.clientId}
                className="rounded-[4px] border px-3 py-2.5"
                style={{ borderColor: 'var(--grat-strong)', background: 'var(--grat-soft)' }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-[var(--ink)]">
                      {c.clientName ?? 'Unnamed agent'}
                    </div>
                    <div className="readout mt-0.5">
                      {c.scope.split(' ').join(' · ')} — since {c.connectedAt.toISOString().slice(0, 10)}
                    </div>
                  </div>
                  <form method="POST" action="/api/oauth/disconnect" className="shrink-0">
                    <input type="hidden" name="client_id" value={c.clientId} />
                    <button type="submit" className="btn text-[12px]">
                      Disconnect
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="readout mt-5">
          <Link href={paths.account} className="text-[var(--phosphor)] hover:underline">
            back to account
          </Link>
        </p>
      </div>
    </main>
  );
}
