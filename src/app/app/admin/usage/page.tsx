import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { requireAdmin } from '@/lib/auth/user';
import { CALLS_PER_PLAN, usageReport, type DailyCost } from '@/lib/usage';
import { paths } from '@/lib/urls';

export const metadata = {
  title: 'Usage — LLM cost & margins',
  description:
    'Per-feature and per-user LLM cost attribution from metered calls, plan-generation unit economics, tier margin estimates, and Radar Score calibration.',
};

/** Costs are tiny (a plan call ≈ $0.0001) — scale the digits to the magnitude. */
function fmtUsd(n: number | null): string {
  if (n === null) return '—';
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number | null): string {
  return n === null ? '—' : `${n.toFixed(1)}%`;
}

/** Daily est. cost bars — same idiom as the LlmBudget 14-day trend on /admin. */
function DailyCostChart({ days }: { days: DailyCost[] }) {
  const max = days.reduce((m, d) => Math.max(m, d.costUsd), 0);
  return (
    <div className="flex items-end gap-[3px]" aria-label={`daily LLM cost, last ${days.length} days`}>
      {days.map((d) => (
        <span
          key={d.date}
          title={`${d.date}: ${fmtUsd(d.costUsd)} · ${d.calls} calls`}
          className="w-full rounded-t-[1px]"
          style={{
            height: `${4 + (max > 0 ? (d.costUsd / max) * 26 : 0)}px`,
            background: d.costUsd > 0 ? 'var(--grat-strong)' : 'var(--grat-soft)',
          }}
        />
      ))}
    </div>
  );
}

export default async function AdminUsagePage() {
  await requireAdmin();
  const report = usageReport(30);

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-8 px-6 py-7">
      <div>
        <PageHeader
          kicker="margin observability · metered llm_calls"
          title="Usage"
          description={
            <>
              What every LLM call costs, attributed by feature and user — the monetization prerequisite. Plan
              economics and tier margins are estimates from the last {report.windowDays} days of metered calls.
            </>
          }
        />
        <p className="mono mt-2 text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
          <Link href={paths.admin} className="hover:underline" style={{ color: 'var(--ink-3)' }}>
            &larr; admin
          </Link>
        </p>
      </div>

      <section>
        <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
          <div>
            <SectionHeader label={`Daily cost — ${report.windowDays} days`} className="mt-0" />
            <DailyCostChart days={report.daily} />
            <p className="mono mt-1 text-[10px] text-ink-4">
              est. total {fmtUsd(report.totalCostUsd)} &middot; {report.totalCalls.toLocaleString('en-US')} calls
              {report.totalCalls === 0 && ' — nothing metered yet; rows land on every chatJSON call'}
            </p>
          </div>
          <div>
            <SectionHeader label="Cost per plan" className="mt-0" />
            <Card>
              <CardContent className="pt-4">
              {report.planCost.calls === 0 ? (
                <p className="text-[13px] text-ink-3">
                  No plan generations metered in this window — the first generate_plan call lands here.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  <li className="flex items-baseline justify-between gap-3 text-[12px]">
                    <span className="text-ink-3">plan calls</span>
                    <span className="mono tabular-nums text-ink">{report.planCost.calls.toLocaleString('en-US')}</span>
                  </li>
                  <li className="flex items-baseline justify-between gap-3 text-[12px]">
                    <span className="text-ink-3">total cost</span>
                    <span className="mono tabular-nums text-ink">{fmtUsd(report.planCost.totalCostUsd)}</span>
                  </li>
                  <li className="flex items-baseline justify-between gap-3 text-[12px]">
                    <span className="text-ink-3">avg per call</span>
                    <span className="mono tabular-nums text-ink">{fmtUsd(report.planCost.avgCostPerCallUsd)}</span>
                  </li>
                  <li className="flex items-baseline justify-between gap-3 text-[12px]">
                    <span className="text-ink-3">avg per plan</span>
                    <span className="mono tabular-nums text-phosphor">{fmtUsd(report.planCost.avgCostPerPlanUsd)}</span>
                  </li>
                </ul>
              )}
              <p className="mt-3 border-t border-grat-soft pt-2.5 text-[11.5px] leading-relaxed text-ink-4">
                One plan generation = ~6&ndash;7 calls (frame + 5 phases, +1 when the brief bootstraps); rows have no
                run id, so per-plan = avg per call &times; {CALLS_PER_PLAN}.
              </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section>
        <SectionHeader label="Margin by tier" className="mt-0" />
        <table className="table">
          <thead>
            <tr>
              <th>Tier</th>
              <th className="num">Price/mo</th>
              <th className="num">Quota (plans)</th>
              <th className="num">Est. LLM cost/mo</th>
              <th className="num">Margin</th>
              <th className="num">Margin %</th>
            </tr>
          </thead>
          <tbody>
            {report.margins.map((m) => (
              <tr key={m.tier}>
                <td style={{ color: 'var(--ink-2)' }}>{m.tier}</td>
                <td className="mono text-right text-[11px]">${m.priceUsd}</td>
                <td className="mono text-right text-[11px]">{m.quotaPlans}</td>
                <td className="mono text-right text-[11px]">{fmtUsd(m.estMonthlyCostUsd)}</td>
                <td className="mono text-right text-[11px]">{fmtUsd(m.marginUsd)}</td>
                <td
                  className="mono text-right text-[11px]"
                  style={{
                    color:
                      m.marginPct === null
                        ? 'var(--ink-4)'
                        : m.marginPct >= 0
                          ? 'var(--phosphor)'
                          : 'var(--alert)',
                  }}
                >
                  {fmtPct(m.marginPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mono mt-2 text-[10px]" style={{ color: 'var(--ink-4)' }}>
          cost/mo = measured avg plan cost &times; tier quota at full usage &middot; quotas mirror the Phase 8a
          entitlement defaults (billing.ts becomes the source of truth when it lands)
        </p>
      </section>

      <section>
        <SectionHeader label="By feature" className="mt-0" />
        {report.byFeature.length === 0 ? (
          <p className="muted">No metered calls yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Feature</th>
                <th className="num">Calls</th>
                <th className="num">Prompt tok</th>
                <th className="num">Completion tok</th>
                <th className="num">Est. cost</th>
                <th className="num">Avg ms</th>
              </tr>
            </thead>
            <tbody>
              {report.byFeature.map((f) => (
                <tr key={f.feature}>
                  <td className="mono text-[11px]" style={{ color: 'var(--ink-2)' }}>
                    {f.feature}
                  </td>
                  <td className="mono text-right text-[11px]">{f.calls.toLocaleString('en-US')}</td>
                  <td className="mono text-right text-[11px]">{f.promptTokens.toLocaleString('en-US')}</td>
                  <td className="mono text-right text-[11px]">{f.completionTokens.toLocaleString('en-US')}</td>
                  <td className="mono text-right text-[11px]">{fmtUsd(f.costUsd)}</td>
                  <td className="mono text-right text-[11px]">{f.avgDurationMs.toLocaleString('en-US')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <SectionHeader label="By user" className="mt-0" />
        {report.byUser.length === 0 ? (
          <p className="muted">No metered calls yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th className="num">Calls</th>
                <th className="num">Prompt tok</th>
                <th className="num">Completion tok</th>
                <th className="num">Est. cost</th>
                <th className="num">Avg ms</th>
              </tr>
            </thead>
            <tbody>
              {report.byUser.map((u) => (
                <tr key={u.userId ?? 'pipeline'}>
                  <td className="mono text-[11px]" style={{ color: 'var(--ink-2)' }}>
                    {u.name ?? (u.userId === null ? 'pipeline / anonymous' : `user #${u.userId}`)}
                  </td>
                  <td className="mono text-right text-[11px]">{u.calls.toLocaleString('en-US')}</td>
                  <td className="mono text-right text-[11px]">{u.promptTokens.toLocaleString('en-US')}</td>
                  <td className="mono text-right text-[11px]">{u.completionTokens.toLocaleString('en-US')}</td>
                  <td className="mono text-right text-[11px]">{fmtUsd(u.costUsd)}</td>
                  <td className="mono text-right text-[11px]">{u.avgDurationMs.toLocaleString('en-US')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <SectionHeader label="Radar Score calibration" className="mt-0" />
        <Card>
          <CardContent className="pt-4">
          <p className="text-[12px] leading-relaxed text-ink-3">
            Radar Score calibration in progress — the science job logs the divergence between our composite and AA
            intelligence nightly (<span className="mono text-[11px]">radar-score / aa_divergence</span>). Weights get
            trusted only after 2&ndash;4 weeks of low divergence; big jumps get investigated, not silently accepted.
          </p>
          {report.divergence.length === 0 ? (
            <p className="mono mt-3 text-[10.5px] text-ink-4">
              no divergence points yet — they appear after the first nightly run with radar-score enabled
            </p>
          ) : (
            <ul className="mt-3 flex flex-col">
              {report.divergence.map((d, i) => (
                <li
                  key={`${d.entity}-${d.date}-${i}`}
                  className="flex items-baseline gap-3 border-b border-grat-soft py-[4px] text-[11px] last:border-b-0"
                >
                  <span className="mono min-w-0 flex-1 truncate text-ink-2">{d.entity}</span>
                  <span className="mono shrink-0 tabular-nums text-ink-3">&Delta; {d.value.toFixed(2)}</span>
                  <span className="mono w-20 shrink-0 text-right text-[10px] text-ink-4">{d.date}</span>
                </li>
              ))}
            </ul>
          )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
