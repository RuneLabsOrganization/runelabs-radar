import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { sources } from '@/lib/db/schema';
import { getCurrentUser } from '@/lib/auth/user';

const SOURCE_TYPES = ['rss', 'hn', 'reddit', 'arxiv', 'huggingface', 'github', 'brave'] as const;
type SourceType = (typeof SOURCE_TYPES)[number];

function isSourceType(s: unknown): s is SourceType {
  return typeof s === 'string' && (SOURCE_TYPES as readonly string[]).includes(s);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const { type, name, config, domainHints, enabled } = (body ?? {}) as {
    type?: unknown;
    name?: unknown;
    config?: unknown;
    domainHints?: unknown;
    enabled?: unknown;
  };

  if (!isSourceType(type)) {
    return NextResponse.json(
      { error: `type must be one of: ${SOURCE_TYPES.join(', ')}` },
      { status: 400 },
    );
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 });
  }
  if (config !== undefined && !isPlainObject(config)) {
    return NextResponse.json({ error: 'config must be an object' }, { status: 400 });
  }
  if (domainHints !== undefined && !isStringArray(domainHints)) {
    return NextResponse.json({ error: 'domainHints must be an array of strings' }, { status: 400 });
  }
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
  }

  const trimmedName = name.trim();
  const db = getDb();

  const existing = db
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.name, trimmedName))
    .get();
  if (existing) {
    return NextResponse.json({ error: 'a source with that name already exists' }, { status: 409 });
  }

  try {
    const inserted = db
      .insert(sources)
      .values({
        type,
        name: trimmedName,
        config: JSON.stringify(config ?? {}),
        domainHints: JSON.stringify(domainHints ?? []),
        enabled: enabled ?? true,
      })
      .returning({ id: sources.id })
      .get();
    return NextResponse.json({ ok: true, id: inserted.id });
  } catch {
    // Unique constraint race fallback
    return NextResponse.json({ error: 'a source with that name already exists' }, { status: 409 });
  }
}
