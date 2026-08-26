import * as React from 'react';
import { VerdictChip } from './OppDossier';
import type { DebateView } from '@/lib/opportunities/debate-view';

const ROLE_LABEL: Record<string, string> = {
  advocate: 'the advocate',
  skeptic: 'the skeptic',
  realist: 'the market realist',
  judge: 'the judge',
};

export default function DebateTranscript({ debate }: { debate: DebateView }) {
  return (
    <div className="anim-in border-t border-grat-soft pt-4">
      <div className="flex items-center gap-2.5">
        <VerdictChip verdict={debate.verdict} />
        <span className="mono text-[11px] text-ink-3">confidence {debate.confidence}/100</span>
      </div>
      <div className="mt-4 flex flex-col gap-4">
        {debate.turns.map((t, i) => (
          <div key={i}>
            <div className="readout mb-1.5">{ROLE_LABEL[t.role] ?? t.role}</div>
            <p className="text-[13px] leading-relaxed text-ink-2">{t.text}</p>
          </div>
        ))}
      </div>
      {(debate.killRisks.length > 0 ||
        debate.conditionsToSucceed.length > 0 ||
        debate.strengthenedVariants.length > 0) && (
        <div className="mt-4 grid gap-x-8 gap-y-4 border-t border-grat-soft pt-4 md:grid-cols-2">
          {debate.killRisks.length > 0 && (
            <div>
              <div className="readout mb-1.5">kill risks</div>
              <ul className="flex flex-col gap-1 text-[13px] text-ink-2">
                {debate.killRisks.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden className="text-amber">
                      ◆
                    </span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {debate.conditionsToSucceed.length > 0 && (
            <div>
              <div className="readout mb-1.5">conditions to succeed</div>
              <ul className="flex flex-col gap-1 text-[13px] text-ink-2">
                {debate.conditionsToSucceed.map((c, i) => (
                  <li key={i}>· {c}</li>
                ))}
              </ul>
            </div>
          )}
          {debate.strengthenedVariants.length > 0 && (
            <div>
              <div className="readout mb-1.5">strengthened variants</div>
              <ul className="flex flex-col gap-1 text-[13px] text-ink-2">
                {debate.strengthenedVariants.map((v, i) => (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden className="text-phosphor">
                      ▸
                    </span>
                    <span>{v}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
