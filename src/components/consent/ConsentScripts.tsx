'use client';

import * as React from 'react';
import { readConsent, type Consent } from '@/lib/consent';

let sentryStarted = false;

function injectPlausible() {
  if (document.getElementById('plausible-script')) return;
  const script = document.createElement('script');
  script.id = 'plausible-script';
  script.defer = true;
  script.dataset.domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ?? 'radar.runelabs.org';
  script.src = 'https://plausible.io/js/script.js';
  document.head.appendChild(script);
}

async function initSentry() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn || sentryStarted) return;
  sentryStarted = true;
  const Sentry = await import('@sentry/nextjs');
  // error reporting only: no tracing integration is wired, so a
  // tracesSampleRate here would be inert config. Re-add both together if the
  // project ever wants client performance traces.
  Sentry.init({ dsn });
}

function applyConsent(c: Consent | null) {
  if (!c) return;
  if (c.analytics) injectPlausible();
  if (c.errors) void initSentry();
}

export function ConsentScripts() {
  React.useEffect(() => {
    applyConsent(readConsent());
    const onChange = () => applyConsent(readConsent());
    window.addEventListener('radar-consent', onChange);
    return () => window.removeEventListener('radar-consent', onChange);
  }, []);

  return null;
}
