import { formatLkr } from '../utils'
import type { PersonalFinancePayload } from '../types'

function numberField(row: Record<string, unknown>, key: string): number {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

function toneFor(percent: number): { bar: string; text: string } {
  if (percent >= 100) return { bar: 'bg-emerald-400', text: 'text-emerald-200' }
  if (percent >= 50) return { bar: 'bg-sky-400', text: 'text-sky-200' }
  return { bar: 'bg-amber-400', text: 'text-amber-200' }
}

/**
 * PF-1007/1008: sinking funds are savings goals earmarked for a specific
 * planned future expense (goalKind: 'sinking'), distinct from open-ended
 * goals shown in SavingsGoalsProgress. The "schedule" here is computed on
 * the fly (required LKR/mo vs. the stored monthlyContribution) rather than
 * a persisted table of dated installments — see roadmap Shipped note.
 */
export function SinkingFundsPanel({ payload }: { payload: PersonalFinancePayload }) {
  const funds = payload.data.savings_goals.filter((row) => stringField(row, 'goalKind') === 'sinking')
  if (funds.length === 0) return null

  const sorted = [...funds].sort((a, b) => numberField(a, 'priority') - numberField(b, 'priority'))

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold text-[var(--theme-text)]">Sinking funds</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {sorted.map((fund, index) => {
          const target = numberField(fund, 'targetAmount')
          const current = numberField(fund, 'currentAmount')
          const monthlyContribution = numberField(fund, 'monthlyContribution')
          const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0
          const tone = toneFor(percent)
          const name = stringField(fund, 'name') || 'Sinking fund'
          const targetDate = stringField(fund, 'targetDate')
          const remaining = target - current

          let scheduleLine: { text: string; tone: string } | null = null
          if (remaining <= 0) {
            scheduleLine = { text: 'Fully funded', tone: 'text-emerald-300' }
          } else if (targetDate) {
            const daysUntil = Math.ceil((Date.parse(targetDate) - Date.now()) / (24 * 60 * 60 * 1000))
            if (Number.isFinite(daysUntil)) {
              if (daysUntil <= 0) {
                scheduleLine = { text: 'Target date passed', tone: 'text-red-300' }
              } else {
                const monthsUntil = Math.max(1, Math.ceil(daysUntil / 30))
                const requiredMonthlyLkr = remaining / monthsUntil
                const onTrack = monthlyContribution >= requiredMonthlyLkr
                scheduleLine = {
                  text: `Needs ${formatLkr(requiredMonthlyLkr)}/mo by ${targetDate} — contributing ${formatLkr(monthlyContribution)}/mo`,
                  tone: onTrack ? 'text-emerald-300' : 'text-amber-300',
                }
              }
            }
          } else {
            scheduleLine = { text: 'No target date set', tone: 'text-[var(--theme-muted)]' }
          }

          return (
            <div key={String(fund.id ?? index)} className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-[var(--theme-text)]">{name}</span>
                <span className={tone.text}>{percent}%</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-black/20">
                <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${percent}%` }} />
              </div>
              <p className="mt-1 text-xs text-[var(--theme-muted)]">
                {formatLkr(current)} / {formatLkr(target)}
              </p>
              {scheduleLine && <p className={`mt-1 text-xs ${scheduleLine.tone}`}>{scheduleLine.text}</p>}
            </div>
          )
        })}
      </div>
    </section>
  )
}
