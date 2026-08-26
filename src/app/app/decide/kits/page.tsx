import Link from 'next/link';
import { requireViewer } from '@/lib/auth/user';
import { KIT_PERSONAS } from '@/lib/kits/personas';

export const metadata = {
  title: 'Kits — what to actually run',
  description:
    'A costed tool kit per role: one pick per job, a monthly total, and the cells not yet covered.',
};

export default async function KitsPage() {
  await requireViewer();
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Kits</h1>
      <p className="mt-2 text-ink-4">
        Pick the role that fits. Each kit is one pick per job at a cost tier, with a monthly total
        and honest gaps where nothing is verified yet.
      </p>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {KIT_PERSONAS.map((p) => (
          <li key={p.slug} className="rounded-lg border border-line p-4">
            <Link href={`/app/decide/kits/${p.slug}`} className="font-medium hover:underline">
              {p.label}
            </Link>
            <p className="mt-1 text-sm text-ink-4">{p.blurb}</p>
            <p className="mt-2 text-xs text-ink-4">
              {p.routes.length} jobs · default {p.defaultTier}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
