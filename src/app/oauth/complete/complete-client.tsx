'use client';

import { useEffect } from 'react';
import CopyButton from '@/components/CopyButton';
import { scheduleLoopbackHandoff } from '@/lib/oauth-loopback';

/** Loopback handoff UI — auto-send the code, copy/paste if the port is down. */
export default function CompleteClient(props: { callbackUrl: string }) {
  useEffect(() => {
    return scheduleLoopbackHandoff(props.callbackUrl, (url) => {
      window.location.href = url;
    }, 400);
  }, [props.callbackUrl]);

  function handoff() {
    window.location.href = props.callbackUrl;
  }

  return (
    <div className="mt-5 space-y-4">
      <p className="text-[13px] leading-relaxed text-[var(--ink-2)]">
        Sending the authorization code to your editor now. If the browser shows{' '}
        <strong className="text-[var(--ink)]">connection refused</strong>, go back and copy the
        callback URL below into Cursor / VS Code / Kimi when prompted.
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
        Keep Cursor / VS Code / Kimi open while you authorize. Codes expire in 5 minutes.
      </p>
    </div>
  );
}
