import SectionHeader from '@/components/SectionHeader';
import { BENCH_METHODOLOGY, type Capability, type StoredBenchModel } from '@/lib/science/composite-bench';

export interface BenchCompositeView {
  capability: Capability;
  label: string;
  date: string | null;
  models: StoredBenchModel[];
}

/**
 * The Radar composite benchmarks: per capability, models ranked by their
 * average standing over many independent benchmarks. Inputs are CC BY (Epoch
 * AI) / open (LiveBench) only — never Artificial Analysis — so this is safe to
 * show anonymous visitors; the credit line is the CC BY attribution.
 */
export default function BenchComposite({ composites }: { composites: BenchCompositeView[] }) {
  const shown = composites.filter((c) => c.models.length > 0);
  if (shown.length === 0) return null;
  return (
    <section id="bench" className="scroll-mt-24">
      <div className="mt-10">
        <SectionHeader label="Benchmark composite — the average of many benchmarks" />
      </div>
      <p className="mt-2 max-w-3xl text-[12.5px] leading-relaxed text-ink-3">
        Any single AI benchmark is noisy and can be gamed. We average each model&rsquo;s standing across many
        independent ones, so no single benchmark decides a rank. Models measured on few benchmarks are pulled toward
        the middle and flagged.
      </p>
      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        {shown.map((c) => (
          <div key={c.capability}>
            <div className="readout mb-1 text-ink-3">
              {c.label}
              {c.date && <span className="ml-2 text-ink-4">as of {c.date}</span>}
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th className="w-6">#</th>
                  <th>Model</th>
                  <th className="num">Score</th>
                  <th className="num" title="independent benchmarks averaged">
                    n
                  </th>
                </tr>
              </thead>
              <tbody>
                {c.models.slice(0, 10).map((m, i) => (
                  <tr key={m.entity}>
                    <td className="mono text-[11px] text-ink-4">{i + 1}</td>
                    <td className="text-ink">
                      {m.entity}
                      {m.unstable && (
                        <span className="mono ml-1.5 text-[10px] text-ink-4" title="the score moves a lot if one benchmark is dropped">
                          hinges on 1 benchmark
                        </span>
                      )}
                    </td>
                    <td className="num mono text-ink">{m.score.toFixed(1)}</td>
                    <td className="num mono text-ink-3">{m.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <details className="mt-3 max-w-3xl text-[12px] text-ink-3">
        <summary className="cursor-pointer text-ink-3">How we score</summary>
        <p className="mt-1 leading-relaxed">{BENCH_METHODOLOGY}</p>
      </details>
    </section>
  );
}
