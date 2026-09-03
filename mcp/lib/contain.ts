/** The slice of ServerResponse that containment needs (structural, for tests). */
export interface ContainableResponse {
  headersSent: boolean;
  writeHead(status: number, headers?: Record<string, string>): unknown;
  end(body: string): unknown;
}

/**
 * Error containment around request handling: a throwing handler gets a 500
 * JSON body instead of an unhandled rejection that would take the process
 * (and every in-flight request) down.
 */
export async function contained(fn: () => Promise<void>, res: ContainableResponse): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error('[mcp] request handling failed:', err);
    try {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'internal error' }));
    } catch {
      /* socket already gone — nothing left to answer */
    }
  }
}

/**
 * Last-resort containment: stray async failures deep in the SDK (or a tool)
 * are logged, never fatal. Returns a disposer so tests can uninstall the
 * handlers they added.
 */
export function installProcessGuards(log: (msg: string, err: unknown) => void = (m, e) => console.error(m, e)): {
  dispose: () => void;
} {
  const onRejection = (err: unknown) => log('[mcp] unhandled rejection:', err);
  const onException = (err: Error) => log('[mcp] uncaught exception:', err);
  process.on('unhandledRejection', onRejection);
  process.on('uncaughtException', onException);
  return {
    dispose: () => {
      process.off('unhandledRejection', onRejection);
      process.off('uncaughtException', onException);
    },
  };
}
