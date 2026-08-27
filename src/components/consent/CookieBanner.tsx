'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE,
  parseConsent,
  serializeConsent,
  type Consent,
} from '@/lib/consent';
import { paths } from '@/lib/urls';
import { Button } from '@/components/ui/button';

function readConsent(): Consent | null {
  const prefix = `${CONSENT_COOKIE}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return parseConsent(decodeURIComponent(trimmed.slice(prefix.length)));
    }
  }
  return null;
}

function writeConsent(c: Consent) {
  document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(serializeConsent(c))}; max-age=${CONSENT_MAX_AGE}; path=/; samesite=lax`;
  window.dispatchEvent(new Event('radar-consent'));
}

export function CookiesButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={`cursor-pointer border-0 bg-transparent p-0 font-[inherit] uppercase tracking-[0.08em] ${className ?? ''}`}
      onClick={() => window.dispatchEvent(new Event('radar-consent-open'))}
    >
      Cookies
    </button>
  );
}

export function CookieBanner() {
  const [mounted, setMounted] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [forced, setForced] = React.useState(false);
  const [customizing, setCustomizing] = React.useState(false);
  const [analytics, setAnalytics] = React.useState(false);
  const [errors, setErrors] = React.useState(false);

  const show = React.useCallback((force = false) => {
    const current = readConsent();
    setAnalytics(current?.analytics ?? false);
    setErrors(current?.errors ?? false);
    setCustomizing(false);
    setForced(force);
    setOpen(force || current === null);
  }, []);

  React.useEffect(() => {
    setMounted(true);
    show(false);
    const reopen = () => show(true);
    window.addEventListener('radar-consent-open', reopen);
    return () => window.removeEventListener('radar-consent-open', reopen);
  }, [show]);

  function save(c: Consent) {
    writeConsent(c);
    setForced(false);
    setCustomizing(false);
    setOpen(false);
  }

  if (!mounted || !open) return null;

  return (
    <aside
      role="dialog"
      aria-labelledby="cookie-banner-title"
      aria-describedby="cookie-banner-copy"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-grat bg-[var(--header-bg)] backdrop-blur"
    >
      <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 py-4 sm:px-6">
        <div>
          <h2 id="cookie-banner-title" className="mono text-[11px] font-semibold uppercase tracking-[0.16em]">
            Cookies
          </h2>
          <p id="cookie-banner-copy" className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-ink-3">
            Session and payments cookies are necessary. Analytics (Plausible) and error reports (Sentry) are optional.{' '}
            <Link href={paths.privacy} className="text-ink-2 underline-offset-2 hover:underline">
              Privacy
            </Link>
            .
          </p>
        </div>

        {customizing && (
          <div className="flex flex-col gap-2 text-[12.5px] text-ink-2">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--phosphor)]"
              />
              Analytics — Plausible pageviews
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={errors}
                onChange={(e) => setErrors(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--phosphor)]"
              />
              Error reports — Sentry on this device
            </label>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => save({ analytics: true, errors: true })}>
            Accept all
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => save({ analytics: false, errors: false })}
          >
            Necessary only
          </Button>
          {customizing ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => save({ analytics, errors })}
            >
              Save
            </Button>
          ) : (
            <Button type="button" size="sm" variant="ghost" onClick={() => setCustomizing(true)}>
              Customize
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
