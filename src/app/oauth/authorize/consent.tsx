'use client';

import { browserLoopbackRedirect } from '@/lib/oauth-loopback';

/** Consent buttons for the MCP OAuth authorization page. */
export default function ConsentForm(props: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  state: string;
}) {
  function deny() {
    const url = new URL(props.redirectUri);
    url.searchParams.set('error', 'access_denied');
    if (props.state) url.searchParams.set('state', props.state);
    window.location.href = browserLoopbackRedirect(url.toString());
  }

  return (
    <div className="mt-6">
      <form method="POST" action="/api/oauth/authorize" className="flex gap-3">
        <input type="hidden" name="client_id" value={props.clientId} />
        <input type="hidden" name="redirect_uri" value={props.redirectUri} />
        <input type="hidden" name="code_challenge" value={props.codeChallenge} />
        <input type="hidden" name="code_challenge_method" value={props.codeChallengeMethod} />
        <input type="hidden" name="scope" value={props.scope} />
        <input type="hidden" name="state" value={props.state} />
        <button type="submit" className="btn btn-primary flex-1 justify-center">
          Allow
        </button>
        <button type="button" onClick={deny} className="btn flex-1 justify-center">
          Deny
        </button>
      </form>
    </div>
  );
}
