import Link from 'next/link';
import { paths } from '@/lib/urls';

/** Branded 404 — dead links (old stories, typos) land here instead of Next's default. */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-[480px] flex-col items-start justify-center px-6 py-16">
      <span aria-hidden className="inline-block h-[14px] w-[3px]" style={{ background: 'var(--phosphor)' }} />
      <h1 className="mt-4 text-[21px] font-semibold tracking-[-0.01em]">Off the radar</h1>
      <p className="mt-2 text-[13.5px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
        That page doesn&rsquo;t exist — it may have moved, or never made it onto the radar.
      </p>
      <nav className="mono mt-6 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.08em]">
        <Link href={paths.app} className="btn">
          Today
        </Link>
        <Link href={paths.brief} className="btn">
          Brief
        </Link>
        <Link href={paths.tools} className="btn">
          Best Tools
        </Link>
        <Link href={paths.search} className="btn">
          Search
        </Link>
      </nav>
    </div>
  );
}
