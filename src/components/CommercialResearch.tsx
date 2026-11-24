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
  const mix = profile?.channelMix;
  const bootstrap = profile?.bootstrap;
  return (
    <section aria-label="Commercial research" className="mt-4 space-y-2 border-t border-[var(--grat-soft)] pt-3 text-[12px] leading-relaxed text-ink-2">
      <h3 className="readout">Commercial research</h3>
      <AudienceSummary profile={profile} audience={audience} />
      {profile ? (
        <>
          <p className="mono text-[11px]">Research geography · {profile.geography} · researched {profile.researchedAt.slice(0, 10)}</p>
          <p>Scenario estimates depend on the buyer, channel and usage assumptions below.</p>
          {profile.sectorSpending && (
            <p><strong>Observed sector spending</strong> · {dollars.format(profile.sectorSpending.usd)} · {profile.sectorSpending.category}
              {' · '}{profile.sectorSpending.period} {citations(profile.sectorSpending.sourceIds)}. Revenue available to this product is unknown.</p>
          )}
          {profile.marketReference && (
            <p><strong>Observed reference population</strong> · {counts.format(profile.marketReference.population)}{' '}
              {profile.marketReference.unit} · {profile.marketReference.period} {citations(profile.marketReference.sourceIds)}</p>
          )}
          {profile.market ? (
            <div>
              <Scenario label={profile.market.scope === 'comparable-cohort' ? 'Reachable prospects in comparable cohort' : 'Reachable buyers'}
                range={profile.market.buyerCounts} format={counts} />
              <p>{profile.market.buyer} · {profile.market.assumptions} {citations(profile.market.sourceIds)}</p>
              {profile.market.scope === 'comparable-cohort' && <p className="text-ink-3">Ranking uses the low estimate from this identifiable pool. Buyers reached through other products or channels are outside its scope.</p>}
            </div>
          ) : <p className="text-ink-3">Reachable buyer count unknown.</p>}
          {profile.cacReferences?.map(ref => (
            <div key={ref.sourceIds.join('-')}>
              <p><strong>{ref.unit !== 'paying customer' ? 'Paid-channel benchmark'
                : ref.scope === 'matched' ? 'Matched paying-customer CAC benchmark' : 'External paying-customer CAC benchmark'}</strong>
                {' · '}{dollars.format(ref.usd)} per {ref.unit} {citations(ref.sourceIds)}</p>
              <p>{ref.publisher} · {ref.cohort} · {ref.geography} · {ref.period}</p>
              <p>{ref.channel} · {ref.methodology}</p>
              {ref.scope === 'external' && <p className="text-ink-3">Excluded from payback for {profile.geography}.</p>}
              {mix && ref.scope === 'matched' && ref.unit === 'paying customer' && <p className="text-ink-3">Cohort evidence only.</p>}
            </div>
          ))}
          {profile.cac?.kind === 'observed' ? (
            <p><strong>Observed CAC for the matched cohort</strong> · {dollars.format(profile.cac.usd.base)} per paying customer.
              {' '}{profile.cac.assumptions} {citations(profile.cac.sourceIds)} The opportunity’s own CAC is unknown.
              {' '}{mix ? 'Cohort evidence only.' : `Payback uses the observed CAC of ${dollars.format(profile.cac.usd.high)} per paying customer.`}</p>
          ) : profile.cac && !profile.cacChannels && !mix ? (
            <div>
              <Scenario label="Customer acquisition cost (CAC) scenario" range={profile.cac.usd} format={dollars} />
              <p>{profile.cac.channel} · {profile.cac.assumptions} {citations(profile.cac.sourceIds)}</p>
              <p className="text-ink-3">Payback uses the high CAC of {dollars.format(profile.cac.usd.high)} per new paying customer.</p>
            </div>
          ) : !profile.cac && !mix && <p className="text-ink-3">Customer acquisition cost unknown.</p>}
          {mix && (
            <div className="space-y-1">
              <Scenario label="Blended CAC" range={mix.usd} format={dollars} />
              <p>Payback uses the high blended CAC of {dollars.format(mix.usd.high)} per new paying customer.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-right tabular-nums [&_td]:pl-2">
                  <caption className="pb-1 text-left text-ink-3">Channel shares · % of new paying customers acquired via modeled routes</caption>
                  <thead className="border-b border-[var(--grat-soft)] text-ink">
                    <tr>
                      <th scope="col" className="pr-2 text-left">Channel</th>
                      <th scope="col" className="pl-2">Favorable</th>
                      <th scope="col" className="pl-2">Base</th>
                      <th scope="col" className="pl-2">Adverse</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mix.weights.map(w => (
                      <tr key={w.channel}>
                        <th scope="row" className="pr-2 text-left font-normal">{w.channel}</th>
                        <td>{w.favorable}%</td><td>{w.base}%</td><td>{w.adverse}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>{mix.assumptions} {citations(mix.sourceIds)}</p>
            </div>
          )}
          {profile.cacChannels && (
            <div className="space-y-2">
              <strong>Estimated CAC by channel · {profile.geography}</strong>
              {profile.cacChannels.map((c, index) => (
                <div key={c.channel}>
                  <Scenario label={c.channel} range={c.usd} format={dollars} />
                  <p>{c.assumptions} {citations(c.sourceIds)}</p>
                  {!mix && index === 0 && profile.cac?.kind === 'scenario' && (
                    <p className="text-ink-3">Primary channel for ranking. Payback uses {dollars.format(c.usd.high)} per new paying customer.</p>
                  )}
                </div>
              ))}
            </div>
          )}
          {profile.execution && (
            <p><strong>Estimated pilot</strong> · {profile.execution.pilotDays} days · {profile.execution.assumptions}</p>
          )}
          {bootstrap && (
            <div>
              <strong>Bootstrapping</strong> · <span className="mono">{bootstrap.points}/10 points</span>
              <dl className="flex flex-wrap gap-x-4 gap-y-1">
                <div><dt>Initial cash estimate</dt><dd className="mono">{bootstrap.initialCostUsd === null ? 'Unknown' : dollars.format(bootstrap.initialCostUsd)}</dd></div>
                <div><dt>Monthly cash estimate</dt><dd className="mono">{bootstrap.monthlyCostUsd === null ? 'Unknown' : dollars.format(bootstrap.monthlyCostUsd)}</dd></div>
                <div><dt>{bootstrap.daysBasis ? `Time to ${bootstrap.daysBasis}` : 'Time estimate'}</dt>
                  <dd className="mono">{bootstrap.days === null ? 'Unknown' : `${bootstrap.days} ${bootstrap.days === 1 ? 'day' : 'days'}`}</dd></div>
              </dl>
              <p>{bootstrap.assumptions}</p>
            </div>
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
            <p key={entry.name}><strong>Competitor</strong> · {entry.name} · {entry.offering} {citations(entry.sourceIds)}
              <span className="ml-2 text-ink-3">{entry.availability === 'confirmed'
                ? `Available in ${profile.geography}` : `Local availability unconfirmed (${profile.geography})`}</span>
            </p>
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
                    {s.comparableEvidence && <p>{s.comparableEvidence.snippet}</p>}
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
          for monthly AI and operating costs. Acquisition payback adds up to 15 using {mix ? 'the high blended CAC'
            : profile?.cac?.kind === 'observed' ? 'the matched cohort’s observed CAC' : 'high CAC'} and that margin.
          Market headroom adds up to 10 using the low buyer count relative to the customer target.
          {' '}{bootstrap ? 'Bootstrapping adds up to 10 points using initial cash, monthly costs and time to a paid pilot or MVP.'
            : 'Shorter pilots add up to 10 points.'} Cited evidence for market, acquisition, competition and AI pricing adds up to 10.
          Missing inputs earn no points for that factor. Rejected openings rank last.</p>
      </details>
    </section>
  );
}
