import { NextResponse } from 'next/server';
import { and, eq, ne } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { items, sources } from '@/lib/db/schema';
import { getCurrentUser } from '@/lib/auth/user';
import type { User } from '@/lib/auth/user';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

async function requireApiAdmin(): Promise<{ user: User } | { res: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) {
    return { res: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  if (user.role !== 'admin') {
    return { res: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { user };
}

function parseId(idStr: string): number | null {
  const id = Number(idStr);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAdmin();
  if ('res' in auth) return auth.res;

  const { id: idStr } = await params;
  const id = parseId(idStr);
  if (id === null) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const { name, config, domainHints, enabled } = (body ?? {}) as {
    name?: unknown;
    config?: unknown;
    domainHints?: unknown;
    enabled?: unknown;
  };

  const set: Partial<{ name: string; config: string; domainHints: string; enabled: boolean }> = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 });
    }
    set.name = name.trim();
  }
  if (config !== undefined) {
    if (!isPlainObject(config)) {
      return NextResponse.json({ error: 'config must be an object' }, { status: 400 });
    }
    set.config = JSON.stringify(config);
  }
  if (domainHints !== undefined) {
    if (!isStringArray(domainHints)) {
      return NextResponse.json(
        { error: 'domainHints must be an array of strings' },
        { status: 400 },
      );
    }
    set.domainHints = JSON.stringify(domainHints);
  }
  if (enabled !== undefined) {
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
    }
    set.enabled = enabled;
  }

  if (Object.keys(set).length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
  }

  const db = getDb();
  const source = db.select({ id: sources.id }).from(sources).where(eq(sources.id, id)).get();
  if (!source) {
    return NextResponse.json({ error: 'source not found' }, { status: 404 });
  }

  if (set.name !== undefined) {
    const clash = db
      .select({ id: sources.id })
      .from(sources)
      .where(and(eq(sources.name, set.name), ne(sources.id, id)))
      .get();
    if (clash) {
      return NextResponse.json(
        { error: 'a source with that name already exists' },
        { status: 409 },
      );
    }
  }

  db.update(sources).set(set).where(eq(sources.id, id)).run();
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAdmin();
  if ('res' in auth) return auth.res;

  const { id: idStr } = await params;
  const id = parseId(idStr);
  if (id === null) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const db = getDb();
  const source = db.select({ id: sources.id }).from(sources).where(eq(sources.id, id)).get();
  if (!source) {
    return NextResponse.json({ error: 'source not found' }, { status: 404 });
  }

  const hasItems = db.select({ id: items.id }).from(items).where(eq(items.sourceId, id)).get();
  if (hasItems) {
    // items reference this source — soft-disable instead of breaking the FK
    db.update(sources).set({ enabled: false }).where(eq(sources.id, id)).run();
    return NextResponse.json({ ok: true, softDisabled: true });
  }

  db.delete(sources).where(eq(sources.id, id)).run();
  return NextResponse.json({ ok: true });
}
