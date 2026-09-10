/** Trading-screen layout primitives: NextRecommendationCard + the
 * DashboardGroup/AdvancedDashboardGroup collapsible section wrappers.
 * Extracted verbatim from trading-screen.tsx. */
import type { ReactNode } from 'react'
import type { NextTradingRecommendation } from '../trading-types'

export function NextRecommendationCard({
  recommendation,
}: {
  recommendation: NextTradingRecommendation
}) {
  const accent =
    recommendation.decision === 'live_requires_manual_review'
      ? 'amber'
      : recommendation.decision === 'sandbox_evidence_only'
        ? 'sky'
        : 'emerald'

  const accentClass =
    accent === 'amber'
      ? 'border-[color-mix(in_srgb,var(--theme-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] text-[var(--theme-warning)]'
      : accent === 'sky'
        ? 'border-[color-mix(in_srgb,var(--theme-accent-secondary)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-accent-secondary)_10%,transparent)] text-[var(--theme-accent-secondary)]'
        : 'border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)]'

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--theme-muted)]">
            Next execution recommendation
          </p>
          <h2 className="mt-1 text-xl font-semibold">
            {recommendation.decision === 'stay_paper_only'
              ? 'Stay in paper mode'
              : recommendation.decision === 'sandbox_evidence_only'
                ? 'Stay in sandbox evidence mode'
                : 'Require manual live review'}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--theme-muted)]">
            {recommendation.summary}
          </p>
        </div>
        <div className={`rounded-2xl border px-4 py-3 text-sm font-medium ${accentClass}`}>
          Current mode: <strong>{recommendation.currentMode}</strong>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_7%,transparent)] p-3 text-sm text-[var(--theme-muted)]">
          <div className="font-medium text-[var(--theme-text)]">Recommended next action</div>
          <div className="mt-1 leading-6">{recommendation.nextAction}</div>
        </div>
        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_7%,transparent)] p-3 text-sm text-[var(--theme-muted)]">
          <div className="font-medium text-[var(--theme-text)]">Safe sandbox caps</div>
          <div className="mt-1">
            {recommendation.safeSandboxCaps.durationMinutes} min ·{' '}
            {recommendation.safeSandboxCaps.maxCycles} cycles ·{' '}
            {recommendation.safeSandboxCaps.maxTrades} trades ·{' '}
            ${recommendation.safeSandboxCaps.maxExposureUsdt} max exposure
          </div>
          <div className="mt-2 text-xs uppercase tracking-[0.12em] text-[var(--theme-muted)]">
            {recommendation.requiresExplicitApproval
              ? 'Explicit approval required'
              : 'No approval required'}
          </div>
        </div>
      </div>
    </section>
  )
}

export const modules = [
  'Accounts, income, expenses, transfers, liabilities',
  'Budgets, cash-flow, recurring bills, low-balance alerts',
  'Savings goals, tax reserve, monthly progress tracking',
  'Tax records with LKR conversion and confirmation flags',
  'Binance market observation, paper trading, testnet, and gated live spot',
  'IBKR parked as a future feature and no longer blocks finance work',
  'News, sentiment, risk scoring, decision logging',
  'Paper/testnet/live Binance modes with emergency stop and shadow paper tracking',
]

export const phases = [
  'Phase 1: finance records and secure local database — active',
  'Phase 2: Binance-first market observation and trading engine — active',
  'Phase 3: news and risk engine — data model ready',
  'Phase 4: paper trading and shadow learning loop — active',
  'Phase 5+: Binance testnet/live modes — gated by explicit approval',
]

export function DashboardGroup({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="mt-8">
      <div className="mb-3 px-1">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-[var(--theme-muted)]">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

export function AdvancedDashboardGroup({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <details className="mt-8 group">
      <summary className="cursor-pointer list-none rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 px-4 py-3 transition hover:bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-[var(--theme-muted)]">
              {description}
            </p>
          </div>
          <span className="text-xs text-[var(--theme-muted)] group-open:hidden">
            Expand
          </span>
          <span className="hidden text-xs text-[var(--theme-muted)] group-open:inline">
            Collapse
          </span>
        </div>
      </summary>
      <div className="space-y-4 pt-1">{children}</div>
    </details>
  )
}
