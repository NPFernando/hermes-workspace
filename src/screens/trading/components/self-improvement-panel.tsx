/** SelfImprovementPanel — extracted verbatim from trading-screen.tsx. */
import { useState } from 'react'
import { formatDateTime, formatFractionPct, formatUsdt } from '../format-helpers'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { StatCard } from '../../finance/components/stat-card'
import type { FinancePayload, LearningCandidate, LearningCandidateStatus, LearningCycleResult, LearningReport } from '../trading-types'

export function SelfImprovementPanel({
  report,
  summary,
  onPayload,
}: {
  report: LearningReport
  summary: FinancePayload['summary']
  onPayload: (payload: FinancePayload) => void
}) {
  const { run, busy, error } = useFinanceAction<
    FinancePayload & {
      learningCycle?: LearningCycleResult
      learningCandidateResult?: {
        candidate: LearningCandidate | null
        applied: boolean
        skippedReason: string | null
      }
    }
  >(onPayload)
  const [message, setMessage] = useState<string | null>(null)
  const latest = report.latestCandidate
  const paperMode = summary.tradingMode === 'paper_trade'
  const testnetMode = summary.tradingMode === 'testnet_execute'
  const canApplyInCurrentMode = paperMode || testnetMode
  const pct = formatFractionPct
  const statusLabel = (status: LearningCandidateStatus) =>
    status.replace(/_/g, ' ')
  const candidateTone = (
    status: LearningCandidateStatus,
  ): 'neutral' | 'good' | 'warn' | 'danger' =>
    status === 'paper_applied' ||
    status === 'testnet_applied' ||
    status === 'testnet_ready' ||
    status === 'live_review_ready'
      ? 'good'
      : status === 'proposed'
        ? 'warn'
        : status === 'rejected'
          ? 'danger'
          : 'neutral'
  const candidateClass = (status: LearningCandidateStatus) =>
    status === 'paper_applied' ||
    status === 'testnet_applied' ||
    status === 'testnet_ready' ||
    status === 'live_review_ready'
      ? 'border-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)]'
      : status === 'proposed'
        ? 'border-[color-mix(in_srgb,var(--theme-warning)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] text-[var(--theme-warning)]'
        : status === 'rejected'
          ? 'border-[color-mix(in_srgb,var(--theme-danger)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] text-[var(--theme-danger)]'
          : 'border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-muted)]'
  const patchLabel = (candidate: LearningCandidate) => {
    const parts: Array<string> = []
    if (candidate.configPatch.quotePerTrade !== undefined) {
      parts.push(`size ${formatUsdt(candidate.configPatch.quotePerTrade)}`)
    }
    if (candidate.strategyOverrides.length > 0) {
      parts.push(
        `${candidate.strategyOverrides.length} strategy override${
          candidate.strategyOverrides.length === 1 ? '' : 's'
        }`,
      )
    }
    return parts.length ? parts.join(' · ') : 'review only'
  }
  const canApplyCandidate = (candidate: LearningCandidate) =>
    candidate.status === 'proposed' && canApplyInCurrentMode

  async function runLearningCycle() {
    setMessage(null)
    const data = await run({ action: 'run_learning_cycle' }, 'run')
    if (data) {
      const cycle = data.learningCycle
      if (cycle?.appliedCandidate) {
        setMessage(
          `Applied ${cycle.appliedCandidate.id}: ${patchLabel(
            cycle.appliedCandidate,
          )}.`,
        )
      } else if (cycle?.generatedCandidate) {
        setMessage(
          `Generated ${statusLabel(cycle.generatedCandidate.status)} candidate ${cycle.generatedCandidate.id}.`,
        )
      } else {
        setMessage(cycle?.skippedReason ?? 'Learning cycle completed.')
      }
    }
  }

  async function applyCandidate(candidateId: string) {
    setMessage(null)
    const data = await run(
      { action: 'apply_learning_candidate', candidateId },
      candidateId,
    )
    if (data) {
      const result = data.learningCandidateResult
      setMessage(
        result?.applied && result.candidate
          ? `Applied ${result.candidate.id}: ${patchLabel(result.candidate)}.`
          : (result?.skippedReason ?? 'Learning candidate was not applied.'),
      )
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Self-improvement loop</h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Closed-trade evidence, paper-only risk reduction, and explicit
            review packages for higher-risk modes.
          </p>
        </div>
        <button
          type="button"
          onClick={runLearningCycle}
          disabled={busy !== null}
          className="rounded-xl border border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] px-4 py-2 text-sm font-medium text-[var(--theme-success)] hover:bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] disabled:opacity-50"
        >
          {busy === 'run' ? 'Running…' : 'Run learning cycle'}
        </button>
      </div>

      {(message || error) && (
        <p
          className={`mt-3 rounded-xl border p-2 text-sm ${error ? 'border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] text-[var(--theme-danger)]' : 'border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)]'}`}
        >
          {error ?? message}
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Policy"
          value={report.policy.enabled ? 'Enabled' : 'Disabled'}
          tone={report.policy.enabled ? 'good' : 'danger'}
        />
        <StatCard
          label="Auto apply"
          value={
            report.policy.autoApplyModes.length === 0
              ? 'Manual'
              : report.policy.autoApplyModes
                  .map((m) => (m === 'paper_trade' ? 'Paper' : 'Testnet'))
                  .join(' + ')
          }
          tone={report.policy.autoApplyModes.length > 0 ? 'good' : 'warn'}
        />
        <StatCard
          label="Stability"
          value={report.stability.passed ? 'Passed' : 'Waiting'}
          tone={report.stability.passed ? 'good' : 'warn'}
        />
        <StatCard
          label="Latest"
          value={latest ? statusLabel(latest.status) : 'None'}
          tone={latest ? candidateTone(latest.status) : 'neutral'}
        />
        <StatCard
          label="Closed trades"
          value={`${report.stability.closedTrades}`}
          tone={report.stability.closedTrades >= 30 ? 'good' : 'warn'}
        />
        <StatCard
          label="Evidence days"
          value={report.stability.evidenceDays.toFixed(1)}
          tone={report.stability.evidenceDays >= 14 ? 'good' : 'warn'}
        />
        <StatCard
          label="Profit factor"
          value={report.stability.profitFactor.toFixed(2)}
          tone={report.stability.profitFactor >= 1.3 ? 'good' : 'warn'}
        />
        <StatCard
          label="Net P/L"
          value={formatUsdt(report.stability.totalPnlQuote)}
          tone={report.stability.totalPnlQuote > 0 ? 'good' : 'danger'}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-4">
          <h3 className="text-sm font-semibold">Gate checks</h3>
          <div className="mt-3 grid gap-2 text-xs">
            <div
              className={`rounded-xl border px-3 py-2 ${
                report.stability.maxDrawdown <=
                report.stability.maxDrawdownLimit
                  ? 'border-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)]'
                  : 'border-[color-mix(in_srgb,var(--theme-danger)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] text-[var(--theme-danger)]'
              }`}
            >
              Drawdown {formatUsdt(report.stability.maxDrawdown)} /{' '}
              {formatUsdt(report.stability.maxDrawdownLimit)}
            </div>
            <div
              className={`rounded-xl border px-3 py-2 ${
                report.stability.hasCriticalFinding
                  ? 'border-[color-mix(in_srgb,var(--theme-danger)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] text-[var(--theme-danger)]'
                  : 'border-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)]'
              }`}
            >
              Critical finding:{' '}
              {report.stability.hasCriticalFinding ? 'yes' : 'no'}
            </div>
            {report.stability.reasons.length === 0 ? (
              <div className="rounded-xl border border-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] px-3 py-2 text-[var(--theme-success)]">
                Conservative gate passed.
              </div>
            ) : (
              report.stability.reasons.map((reason) => (
                <div
                  key={reason}
                  className="rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-2 text-[var(--theme-muted)]"
                >
                  {reason}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Latest candidate</h3>
            {latest ? (
              <span
                className={`rounded-full border px-2.5 py-1 text-xs capitalize ${candidateClass(latest.status)}`}
              >
                {statusLabel(latest.status)}
              </span>
            ) : null}
          </div>
          {latest ? (
            <>
              <p className="mt-2 text-sm text-[var(--theme-text)]">
                {latest.reason}
              </p>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div className="rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-2 text-[var(--theme-muted)]">
                  Created {formatDateTime(latest.createdAt)}
                </div>
                <div className="rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-2 text-[var(--theme-muted)]">
                  Mode {latest.modeAtCreation}
                </div>
                <div className="rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-2 text-[var(--theme-muted)]">
                  Patch {patchLabel(latest)}
                </div>
                <div className="rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-2 text-[var(--theme-muted)]">
                  Promotion {latest.promotion.eligibleFor}
                </div>
                <div className="rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-2 text-[var(--theme-muted)] sm:col-span-2">
                  Validation: {latest.validation.reason}
                </div>
              </div>
              {latest.status === 'proposed' ? (
                <button
                  type="button"
                  onClick={() => void applyCandidate(latest.id)}
                  disabled={busy !== null || !canApplyCandidate(latest)}
                  className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] px-4 py-2 text-sm font-medium text-[var(--theme-success)] hover:bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] disabled:opacity-50"
                >
                  {busy === latest.id
                    ? 'Applying…'
                    : paperMode
                      ? 'Apply paper candidate'
                      : testnetMode
                        ? 'Apply testnet candidate'
                        : 'Paper or testnet mode required'}
                </button>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-sm text-[var(--theme-muted)]">
              No learning candidates yet.
            </p>
          )}
        </div>
      </div>

      {report.candidates.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.18em] text-[var(--theme-muted)]">
              <tr>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Created
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Status
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Evidence
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Patch
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Validation
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {report.candidates.slice(0, 6).map((candidate) => (
                <tr
                  key={candidate.id}
                  className="align-top text-[var(--theme-text)]"
                >
                  <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                    {formatDateTime(candidate.createdAt)}
                  </td>
                  <td className="border-b border-[var(--theme-border)]/60 py-2 pr-4">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs capitalize ${candidateClass(candidate.status)}`}
                    >
                      {statusLabel(candidate.status)}
                    </span>
                  </td>
                  <td className="border-b border-[var(--theme-border)]/60 py-2 pr-4 text-xs text-[var(--theme-muted)]">
                    {candidate.metrics.closedTrades} trades ·{' '}
                    {pct(candidate.metrics.winRate)} win ·{' '}
                    {formatUsdt(candidate.metrics.totalPnlQuote)}
                  </td>
                  <td className="border-b border-[var(--theme-border)]/60 py-2 pr-4 text-xs text-[var(--theme-muted)]">
                    {patchLabel(candidate)}
                  </td>
                  <td className="border-b border-[var(--theme-border)]/60 py-2 pr-4 text-xs text-[var(--theme-muted)]">
                    {candidate.validation.passed ? 'passed' : 'waiting'} ·{' '}
                    {candidate.validation.minBacktestFolds} folds
                  </td>
                  <td className="border-b border-[var(--theme-border)]/60 py-2 pr-4">
                    {candidate.status === 'proposed' ? (
                      <button
                        type="button"
                        onClick={() => void applyCandidate(candidate.id)}
                        disabled={
                          busy !== null || !canApplyCandidate(candidate)
                        }
                        className="rounded-xl border border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--theme-success)] hover:bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] disabled:opacity-50"
                      >
                        {busy === candidate.id
                          ? 'Applying…'
                          : canApplyInCurrentMode
                            ? 'Apply'
                            : 'Paper/testnet only'}
                      </button>
                    ) : (
                      <span className="text-xs text-[var(--theme-muted)]">
                        {candidate.promotion.requiresApproval
                          ? 'Review'
                          : 'Done'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
