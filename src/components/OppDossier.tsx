// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import Link from 'next/link';
import { DOMAIN_COLORS, DOMAIN_LABELS, isDomain } from '@/lib/domains';
import { fmtUsd } from '@/lib/costs';
import { SUB_KEYS, type SubScores } from '@/lib/opportunities/axes';
import type { OppKpis } from '@/lib/opportunities/engine';
import type { OppBrief as OppBriefType } from '@/lib/opportunities/brief';
import type { EvidenceItem } from '@/lib/opportunities/evidence';
import SpiderChart from './SpiderChart';
import { gradeColor } from '@/lib/opportunities/axes';

export type Verdict = 'pursue' | 'watch' | 'reject';

export interface OppReview {
  killRisks: string[];
  flags: string[];
  capsApplied: { play: 'flip' | 'hold'; rule: string; from: number; to: number }[];
  criticUnavailable?: boolean;
}

export interface OppView {
  id: number;
  title: string;
  thesis: string;
  sector: string | null;
  window: string | null;
  flipScore: number;
  holdScore: number;
  verdict: Verdict;
  confidence: number;
  review: OppReview | null;
  sub: SubScores;
  kpis: OppKpis | null;
  /** row predates the 10-axis assessment — full dossier arrives on the next sweep */
  legacy: boolean;
  evidence: EvidenceItem[];
  brief: OppBriefType | null;
  firstSeenLabel: string;
  isNew: boolean;
}

const VERDICT_STYLE: Record<Verdict, { color: string; label: string; hint: string }> = {
  pursue: { color: 'var(--phosphor)', label: 'pursue', hint: 'the red team endorses this one' },
  watch: { color: 'var(--amber)', label: 'watch', hint: 'real, but with open risks — read the red-team notes' },
  reject: { color: 'var(--alert)', label: 'reject', hint: 'the red team advises against this one' },
};

/** The red team's verdict, one glance — the third opinion after flip/hold. */
export function VerdictChip({ verdict }: { verdict: Verdict }) {
  const s = VERDICT_STYLE[verdict];
  return (
    <span
      className="mono inline-block rounded-[3px] border px-1.5 py-px text-[9px] uppercase tracking-[0.08em]"
      style={{ color: s.color, borderColor: s.color, opacity: 0.9 }}
      title={s.hint}
    >
      {s.label}
    </span>
  );
}

const CHECK_LABELS: Record<keyof SubScores, string> = {
  demand: 'demand',
  buildability: 'buildable',
  margin: 'margin',
  competition: 'open field',
  timing: 'timing',
  moat: 'moat',
  regClear: 'regulation',
  platformSafe: 'platform',
  distribution: 'reach',
  qualityBar: 'quality',
};
const CHECK_PASS = 12; // an axis at 12+/20 clears its launch check

const EVIDENCE_GLYPH: Record<string, string> = {
  pain: '●',
  pattern: '▲',
  entity: '↗',
  story: '▪',
  market: '$',
  launches: '⚑',
};

/** Simply-Wall-St checks pattern: N/10 clear, each glyph hoverable. */
export function LaunchChecks({ sub }: { sub: SubScores }) {
  const results = SUB_KEYS.map((k) => ({ k, v: sub[k] ?? 0, pass: (sub[k] ?? 0) >= CHECK_PASS }));
  const passed = results.filter((r) => r.pass).length;
  return (
    <div
      className="mt-2 flex items-center gap-2"
      role="img"
      aria-label={`${passed} of ${SUB_KEYS.length} launch checks clear`}
    >
      <span className="readout text-[10px]">checks</span>
      <span className="mono text-[11px]" style={{ color: gradeColor((passed / SUB_KEYS.length) * 100) }}>
        {passed}/{SUB_KEYS.length}
      </span>
      <span className="mono flex gap-[3px] text-[10px]" aria-hidden>
        {results.map(({ k, v, pass }) => (
          <span
            key={k}
            title={`${CHECK_LABELS[k]}: ${v}/20 ${pass ? '✓' : '✗'}`}
            style={{ color: pass ? 'var(--phosphor)' : 'var(--ink-4)', cursor: 'default' }}
          >
            {pass ? '✓' : '✗'}
          </span>
        ))}
      </span>
    </div>
  );
}

export function ScoreBar({ label, value, emphasized }: { label: string; value: number; emphasized: boolean }) {
  return (
    <span className="flex items-center gap-2" title={`${label} score ${value}/100`}>
      <span className="mono w-8 text-[10px] tracking-[0.1em] uppercase" style={{ color: emphasized ? 'var(--phosphor)' : 'var(--ink-4)' }}>
        {label}
      </span>
      <span className="h-[4px] min-w-16 flex-1 rounded-[1px]" style={{ background: 'var(--grat-soft)' }}>
        <span
          className="anim-bar block h-full rounded-[1px]"
          style={{ width: `${value}%`, background: emphasized ? gradeColor(value) : 'var(--grat-strong)', opacity: 0.85 }}
        />
      </span>
      <span className="mono w-7 text-[12px]" style={{ color: emphasized ? 'var(--ink)' : 'var(--ink-3)' }}>
        {value}
      </span>
    </span>
  );
}

function KpiTile({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-[86px]">
      <div className="readout text-[10px]">{label}</div>
      <div className="mono mt-0.5 text-[13px]" style={{ color: value ? 'var(--ink)' : 'var(--ink-4)' }}>
        {value ?? '—'}
      </div>
    </div>
  );
}

/** Inverted risk meter: high sub-score = low risk. */
function RiskMeter({ label, sub, note }: { label: string; sub: number; note?: string | null }) {
  const risk = 20 - sub;
  const color = risk <= 6 ? 'var(--phosphor)' : risk <= 12 ? 'var(--amber)' : 'var(--alert)';
  return (
    <div className="flex items-center gap-2" title={note ?? `${label}: risk ${risk}/20`}>
      <span className="readout w-[86px] shrink-0 text-[10px]">{label}</span>
      <span className="h-[4px] w-20 rounded-[1px]" style={{ background: 'var(--grat-soft)' }}>
        <span className="anim-bar block h-full rounded-[1px]" style={{ width: `${(risk / 20) * 100}%`, background: color, opacity: 0.8 }} />
      </span>
      <span className="mono text-[10px]" style={{ color }}>
        {risk <= 6 ? 'low' : risk <= 12 ? 'med' : 'high'}
      </span>
    </div>
  );
}

function Competition({ kpis, sub }: { kpis: OppKpis | null; sub: SubScores }) {
  const count = kpis?.competitorCount ?? null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="readout text-[10px]">competition</span>
      {count !== null ? (
        <>
          <span className="mono text-[11px]" aria-label={`${count} direct competitors`}>
            {Array.from({ length: Math.min(Math.round(count), 8) }, () => '▮').join('')}
            <span style={{ color: 'var(--ink-4)' }}>
              {Array.from({ length: Math.max(0, 8 - Math.round(count)) }, () => '░').join('')}
            </span>
            <span className="ml-1.5" style={{ color: 'var(--ink-3)' }}>
              {Math.round(count)}
              {count > 8 ? '+' : ''} direct
            </span>
          </span>
        </>
      ) : (
        <span className="mono text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
          field openness {sub.competition}/20
        </span>
      )}
      {kpis?.competitionNote && (
        <span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: 'var(--ink-3)' }}>
          {kpis.competitionNote}
        </span>
      )}
    </div>
  );
}

function fmtDays(v: number | null): string | null {
  return v === null ? null : `~${Math.round(v)}d`;
}

/** Evidence row: glyph + label, linked when the label resolves to a page. */
function EvidenceItemRow({ item }: { item: EvidenceItem }) {
  const inner = (
    <>
      <span aria-hidden style={{ color: 'var(--ink-4)' }}>
        {EVIDENCE_GLYPH[item.type] ?? '·'}{' '}
      </span>
      {item.label}
    </>
  );
  return item.href ? (
    <Link href={item.href} title={item.type} className="hover:underline" style={{ color: 'var(--ink-2)' }}>
      {inner}
    </Link>
  ) : (
    <span title={item.type}>{inner}</span>
  );
}

/**
 * The full opportunity dossier, shared by card expansion (list page) and the
 * detail page. Server-rendered; the brief flow lives separately (BriefSection).
 */
export default function OppDossier({ opp, sortKey }: { opp: OppView; sortKey: 'flip' | 'hold' }) {
  const k = opp.kpis;
  return (
    <div className="gap-6 md:grid md:grid-cols-[218px_minmax(0,1fr)]">
      {/* the shape of the launch, at a glance */}
      <div className="mx-auto max-w-[240px] md:mx-0">
        {opp.legacy ? (
          <p className="mono py-8 text-center text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
            full 10-axis dossier
            <br />
            arrives on the next sweep
          </p>
        ) : (
          <SpiderChart sub={opp.sub} grade={sortKey === 'flip' ? opp.flipScore : opp.holdScore} />
        )}
        <div className="mt-1 flex flex-col gap-1.5">
          <ScoreBar label="flip" value={opp.flipScore} emphasized={sortKey === 'flip'} />
          <ScoreBar label="hold" value={opp.holdScore} emphasized={sortKey === 'hold'} />
        </div>
        {!opp.legacy && <LaunchChecks sub={opp.sub} />}
      </div>

      <div className="mt-4 min-w-0 md:mt-0">
        <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          {opp.thesis}
        </p>

        {/* hard numbers */}
        <div className="mt-3.5 flex flex-wrap gap-x-7 gap-y-2.5 border-t border-[var(--grat-soft)] pt-3">
          <KpiTile label="initial cost" value={k?.initialCostUsd !== null && k ? fmtUsd(k.initialCostUsd!) : null} />
          <KpiTile label="run / mo" value={k?.monthlyCostUsd !== null && k ? fmtUsd(k.monthlyCostUsd!) : null} />
          <KpiTile label="price / mo" value={k?.priceUsd !== null && k ? fmtUsd(k.priceUsd!) : null} />
          <KpiTile label="time to mvp" value={fmtDays(k?.timeToMvpDays ?? null)} />
          <KpiTile label="break-even" value={k?.breakEvenCustomers != null ? `${Math.round(k.breakEvenCustomers)} cust` : null} />
          <KpiTile label="window" value={opp.window} />
        </div>

        {/* risk panel */}
        {!opp.legacy && (
          <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1.5">
            <RiskMeter label="regulation" sub={opp.sub.regClear} note={k?.regulatoryNote} />
            <RiskMeter label="platform dep" sub={opp.sub.platformSafe} />
            <RiskMeter label="quality effort" sub={opp.sub.qualityBar} />
          </div>
        )}
        {k?.regulatoryNote && (
          <p className="mono mt-1.5 text-[10.5px]" style={{ color: 'var(--amber)' }}>
            ◆ {k.regulatoryNote}
          </p>
        )}

        <div className="mt-3 border-t border-[var(--grat-soft)] pt-2.5">
          <Competition kpis={k} sub={opp.sub} />
        </div>

        {opp.evidence.length > 0 && (
          <div className="mono mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px]" style={{ color: 'var(--ink-3)' }}>
            {opp.evidence.slice(0, 4).map((e, i) => (
              <EvidenceItemRow key={i} item={e} />
            ))}
            {opp.evidence.length > 4 && <span style={{ color: 'var(--ink-4)' }}>+{opp.evidence.length - 4}</span>}
          </div>
        )}

        {/* the adversarial half of the review — why this might die, and what the gate capped */}
        {opp.review &&
          (opp.review.killRisks.length > 0 ||
            opp.review.capsApplied.length > 0 ||
            opp.review.criticUnavailable) && (
            <div className="mt-3 border-t border-[var(--grat-soft)] pt-2.5">
              <div className="readout mb-1.5">red team</div>
              <div className="flex flex-col gap-1">
                {opp.review.killRisks.map((r, i) => (
                  <p key={i} className="mono text-[10.5px] leading-relaxed" style={{ color: 'var(--alert)' }}>
                    ▲ {r}
                  </p>
                ))}
                {opp.review.capsApplied.map((c, i) => (
                  <p key={`c${i}`} className="mono text-[10px]" style={{ color: 'var(--amber)' }}>
                    ◆ {c.play} capped {c.from} → {c.to} · {c.rule}
                  </p>
                ))}
                {opp.review.criticUnavailable && (
                  <p className="mono text-[10px]" style={{ color: 'var(--ink-4)' }}>
                    · review pending — unverified
                  </p>
                )}
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
