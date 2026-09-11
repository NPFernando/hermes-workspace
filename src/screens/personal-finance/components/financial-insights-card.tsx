import { dangerTone, neutralTone, warningTone } from '../shared-styles'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { buildMonthlyFinanceReport } from './financial-report'
import type { PersonalFinancePayload } from '../types'

export type FinancialInsight = {
  level: 'critical' | 'warning' | 'info'
  title: string
  detail: string
  evidence: string
}

const INSIGHT_TONE: Record<FinancialInsight['level'], string> = {
  critical: dangerTone,
  warning: warningTone,
  info: neutralTone,
}

/** PF-415: deterministic, evidence-linked insight summary; it does not call an LLM. */
export function buildFinancialInsights(
  payload: PersonalFinancePayload,
): Array<FinancialInsight> {
  const insights: Array<FinancialInsight> = []
  const seen = new Set<string>()
  const add = (insight: FinancialInsight) => {
    if (seen.has(insight.title) || insights.length >= 4) return
    seen.add(insight.title)
    insights.push(insight)
  }

  for (const alert of payload.alerts) {
    if (alert.level === 'critical' || alert.level === 'warning') {
      add({
        level: alert.level,
        title: alert.title,
        detail: alert.detail,
        evidence: 'Existing finance alert',
      })
    }
  }

  const components = [...payload.financialHealth.components].sort(
    (a, b) => a.score / a.maxScore - b.score / b.maxScore,
  )
  if (components.length > 0) {
    const weakest = components[0]
    if (weakest.score / weakest.maxScore < 0.6) {
      add({
        level: weakest.score / weakest.maxScore < 0.35 ? 'critical' : 'warning',
        title: `${weakest.label} needs attention`,
        detail: weakest.detail,
        evidence: `Financial health component: ${Math.round(weakest.score)}/${weakest.maxScore}`,
      })
    }
  }

  const overBudget = payload.budgetVsActual
    .filter((row) => row.overBudget)
    .sort((a, b) => b.percentUsed - a.percentUsed)
  if (overBudget[0]) {
    add({
      level: 'warning',
      title: `${overBudget[0].category} is over budget`,
      detail: `${Math.round(overBudget[0].percentUsed)}% of the recorded budget has been used for ${overBudget[0].month}.`,
      evidence: 'Budget versus actual',
    })
  }

  if (payload.safeToSpend.configured && payload.safeToSpend.amountLkr < 0) {
    add({
      level: 'critical',
      title: 'Safe-to-spend estimate is negative',
      detail: 'The configured reserve and recorded commitments exceed the currently available cash estimate.',
      evidence: 'Safe-to-spend calculation',
    })
  }

  if (insights.length === 0) {
    add({
      level: 'info',
      title: 'No priority issue detected',
      detail: 'The current alerts, health components, budgets, and safe-to-spend estimate do not identify a priority issue.',
      evidence: 'Current finance snapshot',
    })
  }
  return insights
}

export function FinancialInsightsCard({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (payload: PersonalFinancePayload) => void
}) {
  const insights = buildFinancialInsights(payload)
  const { run: post, busy, error } = useFinanceAction<PersonalFinancePayload>(onPayload)
  const proactiveEnabled = payload.proactiveInsightsEnabled === true
  const downloadReport = () => {
    const month = new Date().toISOString().slice(0, 7)
    const blob = new Blob([buildMonthlyFinanceReport(payload, month)], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `finance-report-${month}.md`
    anchor.click()
    URL.revokeObjectURL(url)
  }
  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--theme-text)]">Insight summary</h2>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Evidence-linked priorities from your current finance snapshot. This is guidance, not automated action.
          </p>
        </div>
        <span className="rounded-full border border-[var(--theme-border)] px-2 py-1 text-[10px] text-[var(--theme-muted)]">
          {insights.length} {insights.length === 1 ? 'insight' : 'insights'}
        </span>
        <button
          type="button"
          className="rounded-xl border border-[var(--theme-border)] px-3 py-2 text-xs font-medium"
          onClick={downloadReport}
        >
          Download monthly report
        </button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {insights.map((insight) => (
          <div key={insight.title} className={`rounded-2xl border p-3 ${INSIGHT_TONE[insight.level]}`}>
            <p className="text-sm font-medium text-[var(--theme-text)]">{insight.title}</p>
            <p className="mt-1 text-xs text-[var(--theme-muted)]">{insight.detail}</p>
            <p className="mt-2 text-[10px] uppercase tracking-wide text-[var(--theme-muted)]">{insight.evidence}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--theme-border)]/70 p-3">
        <label className="flex items-center gap-2 text-xs text-[var(--theme-muted)]">
          <input
            type="checkbox"
            checked={proactiveEnabled}
            disabled={busy === 'proactive-policy'}
            onChange={(event) =>
              void post(
                { action: 'set_proactive_insights', enabled: event.target.checked },
                'proactive-policy',
              )
            }
          />
          Allow review-only proactive finance tasks
        </label>
        {proactiveEnabled && (
          <button
            type="button"
            className="rounded-xl border border-[var(--theme-border)] px-3 py-2 text-xs font-medium"
            disabled={busy === 'proactive-review'}
            onClick={() =>
              void post(
                { action: 'queue_proactive_finance_review' },
                'proactive-review',
              )
            }
          >
            {busy === 'proactive-review' ? 'Queueing…' : 'Queue review task'}
          </button>
        )}
        <span className="text-[11px] text-[var(--theme-muted)]">
          Creates an auditable Finance Manager task awaiting approval; it never changes records or places trades.
        </span>
      </div>
      {error && <p className="mt-2 text-xs text-[var(--theme-danger)]">{error}</p>}
    </section>
  )
}
