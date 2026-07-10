import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { SESSION_COOKIE, signSession } from '@/lib/auth/session';

const SESSION_MAX_AGE_S = 30 * 24 * 3600;

// Compared against when the user does not exist, so response timing does not
// leak whether a name is registered.
const DUMMY_HASH = bcrypt.hashSync('invalid-password-placeholder', 10);

// In-memory brute-force limiter (single-instance deployment): after
// MAX_FAILURES failed attempts per (ip, name) within the window, reject early.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; resetAt: number }>();

function clientKey(req: Request, name: string): string {
  const fwd = req.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0].trim() : 'local';
  return `${ip}|${name.toLowerCase()}`;
}

function isLocked(key: string): boolean {
  const e = failures.get(key);
  return !!e && e.resetAt > Date.now() && e.count >= MAX_FAILURES;
}

function recordFailure(key: string): void {
  if (failures.size > 1000) {
    for (const [k, v] of failures) if (v.resetAt < Date.now()) failures.delete(k);
  }
  const e = failures.get(key);
  if (!e || e.resetAt < Date.now()) {
    failures.set(key, { count: 1, resetAt: Date.now() + WINDOW_MS });
  } else {
    e.count++;
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const { name, password } = (body ?? {}) as { name?: unknown; password?: unknown };
  if (typeof name !== 'string' || typeof password !== 'string' || !name || !password) {
    return NextResponse.json({ error: 'name and password required' }, { status: 400 });
  }

  const key = clientKey(req, name);
  if (isLocked(key)) {
    return NextResponse.json({ error: 'too many attempts, try again later' }, { status: 429 });
  }

  const db = getDb();
  const user = db.select().from(users).where(eq(users.name, name)).get();

  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    recordFailure(key);
    return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
  }

  failures.delete(key);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, signSession(user.id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
}
