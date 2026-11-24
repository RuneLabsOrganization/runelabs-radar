import * as React from 'react';
import type { CommercialProfile } from '@/lib/opportunities/commercial';
import type { OppKpis } from '@/lib/opportunities/engine';
import { safeHttpUrl } from '@/lib/safe-url';

const dollars = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumSignificantDigits: 4,
});
const counts = new Intl.NumberFormat('en-US');

function Scenario({ label, range, format }: {
  label: string;
  range: { low: number; base: number; high: number };
  format: Intl.NumberFormat;
}) {
  return (
    <div>
      <span className="font-medium text-ink">{label}</span>
      <span className="mono ml-2">{format.format(range.base)} base</span>
      <span className="ml-2 text-ink-3">({format.format(range.low)} low · {format.format(range.high)} high)</span>
    </div>
  );
}

interface ResearchProps {
  profile?: CommercialProfile;
  audience?: OppKpis['audience'];
}

export function AudienceSummary({ profile, audience }: ResearchProps) {
  const fields = [
    ['Business model', profile?.businessModel ?? audience?.businessModel],
    ['Industry', profile?.industry ?? audience?.industry],
    ['User', profile?.user ?? audience?.user],
    ['Payer', profile?.payer ?? audience?.payer],
  ].filter(([, value]) => value && value !== 'unknown' && value !== 'Unspecified');
  if (!fields.length) return null;
  return (
    <dl aria-label="Target audience" className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
      {fields.map(([label, value]) => (
        <div key={label}><dt className="inline">{label} </dt><dd className="inline text-ink-2">{value}</dd></div>
      ))}
    </dl>
  );
}

export default function CommercialResearch({ profile, audience }: ResearchProps) {
  const citations = (ids: string[]) => ids.map((id) => {
    const source = profile?.sources.find((s) => s.id === id);
    const url = safeHttpUrl(source?.url);
    return url && <a key={id} href={url} className="mono ml-1 text-ink-3 underline" aria-label={source?.title}>[{id}]</a>;
  });
  const ai = profile?.execution?.ai;
  return (
    <section aria-label="Commercial research" className="mt-4 space-y-2 border-t border-[var(--grat-soft)] pt-3 text-[12px] leading-relaxed text-ink-2">
      <h3 className="readout">Commercial research</h3>
      <AudienceSummary profile={profile} audience={audience} />
      {profile ? (
        <>
          <p className="mono text-[11px]">Research geography · {profile.geography} · researched {profile.researchedAt.slice(0, 10)}</p>
          <p>Scenario estimates depend on the buyer, channel and usage assumptions below.</p>
          {profile.market ? (
            <div>
              <Scenario label="Reachable buyers" range={profile.market.buyerCounts} format={counts} />
              <p>{profile.market.buyer} · {profile.market.assumptions} {citations(profile.market.sourceIds)}</p>
            </div>
          ) : <p className="text-ink-3">Reachable buyer count unknown.</p>}
          {profile.cac ? (
            <div>
              <Scenario label="Customer acquisition cost (CAC)" range={profile.cac.usd} format={dollars} />
              <p>{profile.cac.channel} · {profile.cac.assumptions} {citations(profile.cac.sourceIds)}</p>
            </div>
          ) : <p className="text-ink-3">Customer acquisition cost unknown.</p>}
          {profile.execution && (
            <p><strong>Estimated pilot</strong> · {profile.execution.pilotDays} days · {profile.execution.assumptions}</p>
          )}
          {ai && (
            <div>
              <strong>Estimated AI cost</strong> · {dollars.format(ai.costPerTaskUsd)} per task · {ai.task}
              <p>{ai.model} · {counts.format(ai.inputTokens)} input and {counts.format(ai.outputTokens)} output tokens per attempt
                {' '}at {dollars.format(ai.inputUsdPerMillion)} and {dollars.format(ai.outputUsdPerMillion)} per million, respectively.
                {' '}{ai.attemptsPerTask} attempts per task · {counts.format(ai.tasksPerCustomerMonth)} tasks per customer per month.
                {citations(ai.sourceIds)}</p>
            </div>
          )}
          {profile.competition?.map((entry) => (
            <p key={entry.name}><strong>Competitor</strong> · {entry.name} · {entry.offering} {citations(entry.sourceIds)}</p>
          ))}
          {profile.sources.length > 0 && (
            <details>
              <summary className="cursor-pointer text-ink">Research sources ({profile.sources.length})</summary>
              <ul className="mt-2 space-y-2">
                {profile.sources.map((s) => (
                  <li key={s.id} className="break-words">
                    <a className="underline" href={safeHttpUrl(s.url) ?? undefined}>[{s.id}] {s.title}</a>
                    <span className="ml-2 text-ink-3">{new URL(s.url).hostname} · {s.publishedAt ? `published ${s.publishedAt.slice(0, 10)}` : 'publication date unknown'}</span>
                    <p>{s.snippet}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : <p>Commercial research unavailable. This provisional score uses only the stored flip and hold assessments.</p>}
      <details>
        <summary className="cursor-pointer text-ink-3">How commercial rank is calculated</summary>
        <p className="mt-1">Flip and hold contribute up to 25 points each. Estimated unit margin adds up to 5 points, accounting
          for monthly AI and operating costs. Acquisition payback adds up to 15 using high CAC and that margin.
          Market headroom adds up to 10 using the low buyer count relative to the customer target.
          Shorter pilots add up to 10, and cited evidence for market, acquisition, competition and AI pricing adds up to 10.
          Missing inputs earn no points for that factor. Rejected openings rank last.</p>
      </details>
    </section>
  );
}
