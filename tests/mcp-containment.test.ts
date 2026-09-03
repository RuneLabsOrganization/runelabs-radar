import { describe, expect, it, vi } from 'vitest';
import { contained, installProcessGuards, type ContainableResponse } from '../mcp/lib/contain';

/**
 * Error containment (mcp/server.ts): transport handling runs inside
 * contained(), and the process installs guards that log instead of exiting.
 */

function fakeRes() {
  const state = { wroteHead: false, status: 0, body: '', ended: false };
  const res: ContainableResponse = {
    get headersSent() {
      return state.wroteHead;
    },
    writeHead(status) {
      state.wroteHead = true;
      state.status = status;
    },
    end(body) {
      state.body = body;
      state.ended = true;
    },
  };
  return { res, state };
}

describe('contained', () => {
  it('turns a throwing handler into a 500 JSON response instead of propagating', async () => {
    const { res, state } = fakeRes();
    await expect(
      contained(async () => {
        throw new Error('transport exploded');
      }, res),
    ).resolves.toBeUndefined();
    expect(state.status).toBe(500);
    expect(state.ended).toBe(true);
    expect(JSON.parse(state.body)).toEqual({ error: 'internal error' });
  });

  it('does not touch the response when the handler succeeds', async () => {
    const { res, state } = fakeRes();
    await contained(async () => {}, res);
    expect(state.wroteHead).toBe(false);
    expect(state.ended).toBe(false);
  });

  it('still ends the response when headers were already sent', async () => {
    const { res, state } = fakeRes();
    state.wroteHead = true; // a partial response went out before the throw
    await contained(async () => {
      throw new Error('mid-stream failure');
    }, res);
    expect(state.status).toBe(0); // no second writeHead
    expect(state.ended).toBe(true);
  });
});

describe('installProcessGuards', () => {
  it('installs log-only handlers and dispose removes exactly those', () => {
    const beforeRejection = process.listeners('unhandledRejection');
    const beforeException = process.listeners('uncaughtException');
    const log = vi.fn();

    const guards = installProcessGuards(log);
    const addedRejection = process
      .listeners('unhandledRejection')
      .filter((l) => !beforeRejection.includes(l));
    const addedException = process
      .listeners('uncaughtException')
      .filter((l) => !beforeException.includes(l));
    expect(addedRejection).toHaveLength(1);
    expect(addedException).toHaveLength(1);

    // invoke the handlers directly: they log and return — no process.exit
    (addedRejection[0] as (err: unknown) => void)(new Error('stray rejection'));
    (addedException[0] as (err: Error) => void)(new Error('stray exception'));
    expect(log).toHaveBeenCalledWith('[mcp] unhandled rejection:', expect.any(Error));
    expect(log).toHaveBeenCalledWith('[mcp] uncaught exception:', expect.any(Error));

    guards.dispose();
    expect(process.listeners('unhandledRejection')).toHaveLength(beforeRejection.length);
    expect(process.listeners('uncaughtException')).toHaveLength(beforeException.length);
  });
});
