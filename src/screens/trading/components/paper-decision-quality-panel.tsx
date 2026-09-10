/** PaperDecisionQualityPanel — extracted verbatim from trading-screen.tsx. */
import { StatCard } from '../../finance/components/stat-card'
import type { PaperDecisionQualityReport } from '../trading-types'

export function PaperDecisionQualityPanel({
  report,
}: {
  report: PaperDecisionQualityReport
}) {
  const rate = (value: number | null) =>
    value == null ? '—' : `${(value * 100).toFixed(1)}%`
  const adverseMove = (value: number | null) =>
    value == null ? '—' : `${value.toFixed(2)}%`
  const hasCoverage = report.coveredSampleCount > 0
  const evidenceMessage =
    report.sampleCount === 0
      ? 'No paper decisions have been recorded, so there is no execution activity to evaluate.'
      : !hasCoverage
        ? 'No eligible outcomes yet. Decisions remain abstained until the outcome horizon and candles provide coverage.'
        : report.coveredSampleCount < 5
          ? 'Evidence is still limited; use these paper-only measurements for observation, not execution changes.'
          : 'Evidence is observational only and does not authorize or trigger execution.'

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Paper decision quality</h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Read-only directional evidence from the paper decision journal.
          </p>
        </div>
        <span className="rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-xs text-[var(--theme-muted)]">
          No execution
        </span>
      </div>

      <p className="mt-3 rounded-2xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3 text-sm text-[var(--theme-muted)]">
        {evidenceMessage}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Sample"
          value={`${report.coveredSampleCount} covered / ${report.sampleCount}`}
          tone={hasCoverage ? 'good' : 'warn'}
        />
        <StatCard label="Coverage" value={rate(report.coverage)} />
        <StatCard
          label="Abstention"
          value={`${rate(report.abstentionRate)} · ${report.abstainedSampleCount}`}
          tone={report.abstainedSampleCount > 0 ? 'warn' : 'neutral'}
        />
        <StatCard
          label="Directional hit rate"
          value={rate(report.directionalHitRate)}
        />
        <StatCard
          label="Average adverse move"
          value={adverseMove(report.averageAdverseMovePct)}
          tone={report.averageAdverseMovePct == null ? 'neutral' : 'warn'}
        />
        <StatCard
          label="Worst adverse move"
          value={adverseMove(report.worstAdverseMovePct)}
          tone={report.worstAdverseMovePct == null ? 'neutral' : 'danger'}
        />
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-semibold">
          Calibration by score magnitude
        </h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {report.calibrationBuckets.map((bucket) => (
            <div
              key={bucket.label}
              className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3"
            >
              <div className="text-xs text-[var(--theme-muted)]">
                Score {bucket.label}
              </div>
              <div className="mt-1 text-sm font-semibold">
                {rate(bucket.directionalHitRate)}
              </div>
              <div className="mt-1 text-xs text-[var(--theme-muted)]">
                {bucket.sampleCount} covered samples
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
