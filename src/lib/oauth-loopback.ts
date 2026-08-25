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
