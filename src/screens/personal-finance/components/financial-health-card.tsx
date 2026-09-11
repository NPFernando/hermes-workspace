import { StatCard } from '../../finance/components/stat-card'
import type { PersonalFinancePayload } from '../types'

const BAND_LABELS: Record<PersonalFinancePayload['financialHealth']['band'], string> = {
  excellent: 'Excellent foundation',
  stable: 'Stable foundation',
  needs_attention: 'Needs attention',
  at_risk: 'At risk',
}

function toneForBand(
  band: PersonalFinancePayload['financialHealth']['band'],
): 'good' | 'warn' | 'danger' | 'neutral' {
  if (band === 'excellent' || band === 'stable') return 'good'
  if (band === 'needs_attention') return 'warn'
  return 'danger'
}

export function FinancialHealthCard({
  payload,
}: {
  payload: PersonalFinancePayload
}) {
  const health = payload.financialHealth
  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Financial health</h2>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            A transparent snapshot based on savings, cash reserves, budgets, debt, and data availability.
          </p>
        </div>
        <StatCard
          label={BAND_LABELS[health.band]}
          value={`${health.score}/100`}
          tone={toneForBand(health.band)}
        />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {health.components.map((component) => (
          <div key={component.key} className="rounded-2xl border border-[var(--theme-border)]/70 p-3">
            <div className="flex items-center justify-between gap-2 text-xs font-medium">
              <span>{component.label}</span>
              <span className="text-[var(--theme-muted)]">
                {Math.round(component.score)}/{component.maxScore}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--theme-text)_14%,transparent)]">
              <div
                className="h-full rounded-full bg-[var(--theme-accent)]"
                style={{ width: `${Math.min(100, (component.score / component.maxScore) * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] leading-4 text-[var(--theme-muted)]">
              {component.detail}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
