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

  const db = getDb();
  const user = db.select().from(users).where(eq(users.name, name)).get();

  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
  }

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
