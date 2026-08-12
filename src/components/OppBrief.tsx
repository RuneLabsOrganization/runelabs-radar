// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import Link from 'next/link';
import type { OppBrief } from '@/lib/opportunities/brief';

/** The launchable brief: who pays, MVP scope, stack, unit economics, GTM, risks. */
export default function OppBrief({ brief }: { brief: OppBrief }) {
  const ue = brief.unitEconomics;
  return (
    <div className="anim-in mt-4 border-t border-[var(--grat-soft)] pt-4">
      <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
        <div>
          <div className="readout mb-1.5">who pays</div>
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>{brief.icp}</p>
        </div>
        <div>
          <div className="readout mb-1.5">mvp scope — 1-2 weeks</div>
          <ul className="flex flex-col gap-1 text-[13px]" style={{ color: 'var(--ink-2)' }}>
            {brief.mvp.map((m, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden style={{ color: 'var(--phosphor)' }}>▸</span>
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="readout mb-1.5">stack</div>
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
            {brief.stackVenture ? (
              <>
                <Link href="/stacks" className="underline decoration-[var(--grat-strong)] underline-offset-2" style={{ color: 'var(--ink)' }}>
                  {brief.stackVenture}
                </Link>{' '}
                playbook{brief.stackNotes ? ` — ${brief.stackNotes}` : ''}
              </>
            ) : (
              brief.stackNotes ?? '—'
            )}
          </p>
        </div>
        <div>
          <div className="readout mb-1.5">unit economics</div>
          <div className="mono flex flex-wrap gap-x-5 gap-y-1 text-[11px]" style={{ color: 'var(--ink-2)' }}>
            {ue.monthlyCostUsd !== null && (
              <span>
                <span style={{ color: 'var(--ink-4)' }}>run</span> ${ue.monthlyCostUsd}/mo
              </span>
            )}
            {ue.suggestedPriceUsd !== null && (
              <span>
                <span style={{ color: 'var(--ink-4)' }}>price</span> ${ue.suggestedPriceUsd}/mo
              </span>
            )}
            {ue.breakEvenCustomers !== null && (
              <span>
                <span style={{ color: 'var(--ink-4)' }}>break-even</span> {ue.breakEvenCustomers} customers
              </span>
            )}
          </div>
          {ue.assumptions.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-0.5 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
              {ue.assumptions.map((a, i) => (
                <li key={i}>· {a}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="readout mb-1.5">go to market</div>
          <ul className="flex flex-col gap-1 text-[13px]" style={{ color: 'var(--ink-2)' }}>
            {brief.gtm.map((g, i) => (
              <li key={i}>· {g}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="readout mb-1.5">risks</div>
          <ul className="flex flex-col gap-1 text-[13px]" style={{ color: 'var(--ink-2)' }}>
            {brief.risks.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden style={{ color: 'var(--amber)' }}>◆</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
