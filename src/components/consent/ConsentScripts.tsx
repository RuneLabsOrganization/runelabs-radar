'use client';

import * as React from 'react';
import { CONSENT_COOKIE, parseConsent, type Consent } from '@/lib/consent';

let sentryStarted = false;

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
  Sentry.init({ dsn, tracesSampleRate: 0.05 });
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
