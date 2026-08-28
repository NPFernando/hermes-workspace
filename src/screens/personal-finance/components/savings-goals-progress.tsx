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

/** Visual progress-bar view of savings goals — sits above the full editable DataTable. */
export function SavingsGoalsProgress({ payload }: { payload: PersonalFinancePayload }) {
  const goals = payload.data.savings_goals
  if (goals.length === 0) return null

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold text-[var(--theme-text)]">Savings goal progress</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {goals.map((goal, index) => {
          const target = numberField(goal, 'targetAmount')
          const current = numberField(goal, 'currentAmount')
          const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0
          const tone = toneFor(percent)
          const name = stringField(goal, 'name') || 'Goal'
          const targetDate = stringField(goal, 'targetDate')
          const remaining = target - current
          let requiredLine: { text: string; tone: string } | null = null
          if (remaining > 0 && targetDate) {
            const daysUntil = Math.ceil((Date.parse(targetDate) - Date.now()) / (24 * 60 * 60 * 1000))
            if (Number.isFinite(daysUntil)) {
              if (daysUntil <= 0) {
                requiredLine = { text: 'Target date passed', tone: 'text-red-300' }
              } else {
                const monthsUntil = Math.max(1, Math.ceil(daysUntil / 30))
                requiredLine = {
                  text: `Needs ${formatLkr(remaining / monthsUntil)}/mo to reach by ${targetDate}`,
                  tone: 'text-[var(--theme-muted)]',
                }
              }
            }
          }
          return (
            <div key={String(goal.id ?? index)} className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3">
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
              {requiredLine && <p className={`mt-1 text-xs ${requiredLine.tone}`}>{requiredLine.text}</p>}
            </div>
          )
        })}
      </div>
    </section>
  )
}
