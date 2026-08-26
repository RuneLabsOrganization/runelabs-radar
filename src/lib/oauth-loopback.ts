/**
 * Normalize loopback hosts for browser redirects after OAuth consent.
 *
 * MCP desktop clients often register `http://127.0.0.1:<port>/callback` (RFC
 * 8252) but bind their local listener to `localhost` (often IPv6 ::1 only).
 * Redirecting the browser to `localhost` keeps token exchange on the registered
 * redirect_uri while letting the client actually receive the callback.
 */
export function isLoopbackRedirectUri(redirectUri: string): boolean {
  try {
    const url = new URL(redirectUri);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function browserLoopbackRedirect(redirectUri: string): string {
  try {
    const url = new URL(redirectUri);
    if (url.hostname === '127.0.0.1' || url.hostname === '[::1]') {
      url.hostname = 'localhost';
    }
    return url.toString();
  } catch {
    return redirectUri;
  }
}

/**
 * After consent, loopback MCP clients land on /oauth/complete (paste-the-URL
 * page) instead of navigating the browser straight at localhost. That page
 * MUST be on the canonical public hub origin (`SITE_URL`). Building it from
 * `req.url` inside Docker uses the container hostname:port
 * (e.g. https://c1949c020530:3000) which NXDOMAINs in the user's browser.
 */
export function oauthCompleteLanding(callbackWithCode: string, publicOrigin: string): string {
  const browserRedirect = browserLoopbackRedirect(callbackWithCode);
  if (!isLoopbackRedirectUri(callbackWithCode) && !isLoopbackRedirectUri(browserRedirect)) {
    return browserRedirect;
  }
  const origin = publicOrigin.replace(/\/+$/, '');
  return `${origin}/oauth/complete?to=${encodeURIComponent(browserRedirect)}`;
}
