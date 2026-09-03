const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * DNS-rebinding guard (the MCP spec requires Origin validation). Anonymous
 * mode has no bearer to check, so without this any webpage could POST to a
 * locally-running server and burn the machine's anonymous LLM/rate budget —
 * reflecting loopback origins for CORS only hides the response, the request
 * still runs.
 *
 * Allowed: no Origin header (non-browser clients don't send one), loopback
 * origins, and the configured public origin (MCP_PUBLIC_URL) when set.
 */
export function isAllowedOrigin(origin: string | undefined, publicUrl?: string): boolean {
  if (!origin) return true;
  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return false;
  }
  if (LOOPBACK_HOSTNAMES.has(hostname)) return true;
  if (publicUrl) {
    try {
      if (new URL(publicUrl).hostname === hostname) return true;
    } catch {
      /* bad MCP_PUBLIC_URL config — fall through to reject */
    }
  }
  return false;
}
