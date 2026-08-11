// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import Link from 'next/link';
import type { FactoryFunnel } from '@/lib/analytics';

/**
 * The reason this product exists, as one strip: the factory path from a
 * detected opening to evergreen revenue, each stage a live count.
 */
export default function FactoryPipeline({ funnel }: { funnel: FactoryFunnel }) {
  const stages: { n: number; label: string; sub: string; href: string; accent?: boolean }[] = [
    { n: funnel.openings, label: 'detected', sub: 'active openings', href: '/opportunities', accent: true },
    { n: funnel.briefed, label: 'briefed', sub: 'launch briefs drafted', href: '/opportunities' },
    { n: funnel.stacksReady, label: 'stack-ready', sub: 'venture playbooks', href: '/stacks' },
    { n: funnel.launches7d, label: 'launch waves', sub: 'market launches · 7d', href: '/' },
    { n: funnel.comps, label: 'evergreen', sub: 'money comps banked', href: '/board' },
  ];
  return (
    <div className="card !px-5 !py-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
        {stages.map((s, i) => (
          <React.Fragment key={s.label}>
            {i > 0 && (
              <span aria-hidden className="mono px-1 text-[14px]" style={{ color: 'var(--ink-4)' }}>
                ›
              </span>
            )}
            <Link href={s.href} className="hover-raise group min-w-[96px]">
              <div
                className="mono text-[22px] leading-none tracking-tight"
                style={{ color: s.accent ? 'var(--phosphor)' : 'var(--ink)' }}
              >
                {s.n}
              </div>
              <div className="readout mt-1" style={{ color: s.accent ? 'var(--phosphor)' : undefined }}>
                {s.label}
              </div>
              <div className="mono mt-0.5 text-[10px]" style={{ color: 'var(--ink-4)' }}>
                {s.sub}
              </div>
            </Link>
          </React.Fragment>
        ))}
        <span className="mono ml-auto hidden max-w-[190px] text-right text-[10px] leading-relaxed lg:block" style={{ color: 'var(--ink-4)' }}>
          the factory path — every stage feeds the next, detection to evergreen revenue
        </span>
      </div>
    </div>
  );
}
