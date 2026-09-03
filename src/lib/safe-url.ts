/**
 * Feed- and LLM-supplied URLs are untrusted input: only http(s) URLs may be
 * rendered into an <a href> (blocks javascript:, data:, vbscript:, etc.).
 */
export function safeHttpUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  const t = u.trim();
  return /^https?:\/\//i.test(t) ? t : null;
}

/** Loopback / private / link-local IPv4 ranges a server-side fetch must never reach. */
function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map(Number);
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets;
  return (
    a === 0 || // 0.0.0.0/8 "this host"
    a === 10 || // 10.0.0.0/8 private
    a === 127 || // 127.0.0.0/8 loopback
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 private
    (a === 192 && b === 168) || // 192.168.0.0/16 private
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local (cloud metadata)
    (a === 100 && b >= 64 && b <= 127) // 100.64.0.0/10 carrier-grade NAT
  );
}

function isPrivateIpv6(host: string): boolean {
  // URL keeps the brackets on IPv6 literals and serializes canonical compressed form
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::' || h === '::1') return true; // unspecified / loopback
  if (/^fe[89ab]/.test(h)) return true; // fe80::/10 link-local
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // fc00::/7 unique-local
  // IPv4-mapped: URL serializes to hex ('::ffff:7f00:1'); dotted form defensively too
  const mapped = h.match(/^::ffff:([0-9a-f:.]+)$/);
  if (mapped) {
    const rest = mapped[1];
    if (rest.includes('.')) return isPrivateIpv4(rest);
    const hextets = rest.split(':');
    if (hextets.length === 2) {
      const hi = parseInt(hextets[0], 16);
      const lo = parseInt(hextets[1], 16);
      if (Number.isNaN(hi) || Number.isNaN(lo)) return false;
      const ipv4 = [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff].join('.');
      return isPrivateIpv4(ipv4);
    }
  }
  return false;
}

/**
 * Server-side fetch URLs are SSRF surface: an admin-configured feed URL (or a
 * redirect target supplied by a compromised feed domain) must not reach
 * loopback, private or link-local addresses. Returns the URL when it is an
 * http(s) URL on a public host, else null. Checks the host literally (IP
 * literals, localhost) — a public hostname that DNS-resolves to a private IP
 * is out of scope.
 */
export function safePublicHttpUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  let url: URL;
  try {
    url = new URL(u.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return null;
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) return null;
  return url.toString();
}
