import { beforeEach, describe, expect, it, vi } from 'vitest';
import { performLogout, runLogout } from '@/components/LogoutButton';

const mocks = vi.hoisted(() => ({ signOut: vi.fn() }));

vi.mock('@/lib/auth/client', () => ({ authClient: { signOut: mocks.signOut } }));

// The component imports next/navigation for useRouter; never rendered here, but
// the real module must not load under vitest's node environment.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function router() {
  return { push: vi.fn(), refresh: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signOut.mockResolvedValue({ data: { success: true }, error: null });
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
});

describe('logout', () => {
  it('ends the better-auth session and the legacy cookie, then navigates', async () => {
    const r = router();
    await expect(runLogout(r)).resolves.toBe(true);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    expect(r.push).toHaveBeenCalledWith('/login');
    expect(r.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not navigate when the legacy POST answers non-ok', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    const r = router();
    await expect(runLogout(r)).resolves.toBe(false);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(r.push).not.toHaveBeenCalled();
    expect(r.refresh).not.toHaveBeenCalled();
  });

  it('does not navigate on network failure — the session cookie is still valid', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const r = router();
    await expect(runLogout(r)).resolves.toBe(false);
    expect(r.push).not.toHaveBeenCalled();
  });

  it('still clears the legacy cookie but does not navigate when signOut fails', async () => {
    mocks.signOut.mockResolvedValue({ data: null, error: { message: 'no session' } });
    const r = router();
    await expect(runLogout(r)).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    expect(r.push).not.toHaveBeenCalled();
  });

  it('does not navigate when signOut throws', async () => {
    mocks.signOut.mockRejectedValue(new Error('network down'));
    const r = router();
    await expect(runLogout(r)).resolves.toBe(false);
    expect(r.push).not.toHaveBeenCalled();
  });

  it('performLogout reports true only when both sessions ended', async () => {
    await expect(performLogout()).resolves.toBe(true);
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    await expect(performLogout()).resolves.toBe(false);
  });
});
