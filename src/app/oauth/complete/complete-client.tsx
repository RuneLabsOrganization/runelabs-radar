'use client';

import CopyButton from '@/components/CopyButton';

/** Loopback handoff UI — copy/paste fallback when the editor's callback port is down. */
export default function CompleteClient(props: { callbackUrl: string }) {
  function handoff() {
    window.location.href = props.callbackUrl;
  }

  return (
    <div className="mt-5 space-y-4">
      <p className="text-[13px] leading-relaxed text-[var(--ink-2)]">
        Your editor starts a tiny local server to receive the authorization code. If that port
        is not listening yet, the browser will show <strong className="text-[var(--ink)]">connection refused</strong>{' '}
        — that is expected. Copy the callback URL below and paste it into Kimi Code / VS Code when
        prompted.
      </p>
      <pre className="mono overflow-x-auto rounded-md border border-grat bg-scope-2 p-3 text-[11px] leading-relaxed text-ink-2">
        {props.callbackUrl}
      </pre>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={handoff} className="btn btn-primary justify-center">
          Try local callback
        </button>
        <CopyButton text={props.callbackUrl} label="copy callback url" />
      </div>
      <p className="readout">
        Keep Kimi / VS Code open while you authorize. Codes expire in 5 minutes.
      </p>
    </div>
  );
}
