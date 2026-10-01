import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ProviderUsageResult, UsageLine } from './provider-usage'

export type SharedBudgetLevel =
  'unconfigured' | 'no_data' | 'ok' | 'warning' | 'critical' | 'exhausted'

export type SharedUsageBudget = {
  level: SharedBudgetLevel
  limitUsd: number | null
  usedUsd: number | null
  remainingUsd: number | null
  percentUsed: number | null
  source: string | null
  observed: Array<{ provider: string; label: string; usedUsd: number }>
  message: string
}

export type MonthlyUsageBudget = {
  level: SharedBudgetLevel
  limitUsd: number | null
  usedUsd: number | null
  remainingUsd: number | null
  percentUsed: number | null
  source: string | null
  observed: Array<{ provider: string; label: string; usedUsd: number }>
  periodDays: number
  message: string
}

export type UsageAnomaly = {
  provider: string
  displayName: string
  label: string
  measure: 'quota' | 'spend'
  day: string
  used: number
  baseline: number
  ratio: number
  severity: 'warning' | 'critical'
  message: string
}

export type UsageHistorySample = {
  day: string
  provider: string
  displayName: string
  label: string
  measure: 'quota' | 'spend'
  used: number
}

/**
 * Detect large latest-day spikes against the same provider/metric's recent
 * aggregate baseline. The detector needs at least three prior samples and
 * never treats missing data as zero, avoiding false alerts after outages.
 */
export function detectUsageAnomalies(
  samples: Array<UsageHistorySample>,
  options: { minimumRatio?: number; criticalRatio?: number } = {},
): Array<UsageAnomaly> {
  const minimumRatio = options.minimumRatio ?? 2.25
  const criticalRatio = options.criticalRatio ?? 3
  const groups = new Map<string, Array<UsageHistorySample>>()
  for (const sample of samples) {
    if (!Number.isFinite(sample.used) || sample.used < 0) continue
    const key = `${sample.provider}:${sample.label}:${sample.measure}`
    const group = groups.get(key) ?? []
    group.push(sample)
    groups.set(key, group)
  }
  const anomalies: Array<UsageAnomaly> = []
  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) => a.day.localeCompare(b.day))
    if (ordered.length < 4) continue
    const latest = ordered.at(-1)!
    const prior = ordered.slice(Math.max(0, ordered.length - 8), -1)
    if (prior.length < 3) continue
    const baseline =
      prior.reduce((sum, sample) => sum + sample.used, 0) / prior.length
    if (baseline <= 0) continue
    const ratio = latest.used / baseline
    if (ratio < minimumRatio) continue
    const severity = ratio >= criticalRatio ? 'critical' : 'warning'
    anomalies.push({
      provider: latest.provider,
      displayName: latest.displayName,
      label: latest.label,
      measure: latest.measure,
      day: latest.day,
      used: latest.used,
      baseline,
      ratio,
      severity,
      message: `${latest.displayName} ${latest.label} is ${ratio.toFixed(1)}× its recent baseline.`,
    })
  }
  return anomalies.sort((a, b) => b.ratio - a.ratio).slice(0, 12)
}

function finitePositive(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function configuredLimit(period: 'daily' | 'monthly'): {
  limitUsd: number | null
  source: string | null
} {
  if (process.env.HERMES_SHARED_BUDGET_CONFIG === 'disabled') {
    return { limitUsd: null, source: null }
  }
  const envKey =
    period === 'daily'
      ? 'HERMES_SHARED_DAILY_BUDGET_USD'
      : 'HERMES_SHARED_MONTHLY_BUDGET_USD'
  const fromEnv = finitePositive(process.env[envKey])
  if (fromEnv !== null) {
    return { limitUsd: fromEnv, source: envKey }
  }

  const candidates = [
    process.env.HERMES_CONFIG_PATH,
    join(homedir(), '.hermes-data', 'config.yaml'),
    join(homedir(), '.hermes', 'config.yaml'),
  ].filter((value): value is string => Boolean(value))
  for (const path of candidates) {
    if (!existsSync(path)) continue
    try {
      const contents = readFileSync(path, 'utf8')
      const key = period === 'daily' ? 'daily' : 'monthly'
      const match = contents.match(
        new RegExp(
          `^\\s*paid_budget_${key}_usd:\\s*([0-9]+(?:\\.[0-9]+)?)\\s*$`,
          'm',
        ),
      )
      const limitUsd = finitePositive(match?.[1])
      if (limitUsd !== null) return { limitUsd, source: path }
    } catch {
      // A missing or unreadable local policy must never break usage reporting.
    }
  }
  return { limitUsd: null, source: null }
}

function lineUsd(line: UsageLine): number | null {
  if (line.type === 'progress' && line.measure === 'spend') {
    return finitePositive(line.used) ?? (line.used === 0 ? 0 : null)
  }
  if (line.measure !== 'spend' || typeof line.value !== 'string') return null
  const match = line.value.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/)
  return match ? Number(match[1]) : null
}

function isDailySpend(line: UsageLine): boolean {
  const label = line.label.toLowerCase()
  return label.includes('daily') || label.includes('extra usage')
}

export function buildSharedUsageBudget(
  providers: Array<ProviderUsageResult>,
): SharedUsageBudget {
  const configured = configuredLimit('daily')
  const observed = providers.flatMap((provider) =>
    provider.lines.flatMap((line) => {
      if (!isDailySpend(line)) return []
      const usedUsd = lineUsd(line)
      return usedUsd === null || !Number.isFinite(usedUsd)
        ? []
        : [{ provider: provider.displayName, label: line.label, usedUsd }]
    }),
  )
  if (configured.limitUsd === null) {
    return {
      level: 'unconfigured',
      limitUsd: null,
      usedUsd: null,
      remainingUsd: null,
      percentUsed: null,
      source: null,
      observed,
      message:
        'Shared daily budget is not configured; provider readings remain advisory.',
    }
  }
  if (observed.length === 0) {
    return {
      level: 'no_data',
      limitUsd: configured.limitUsd,
      usedUsd: null,
      remainingUsd: null,
      percentUsed: null,
      source: configured.source,
      observed,
      message:
        'No daily spend reading is available from the configured providers.',
    }
  }
  const usedUsd = observed.reduce((total, item) => total + item.usedUsd, 0)
  const percentUsed = (usedUsd / configured.limitUsd) * 100
  const level: SharedBudgetLevel =
    percentUsed >= 100
      ? 'exhausted'
      : percentUsed >= 90
        ? 'critical'
        : percentUsed >= 75
          ? 'warning'
          : 'ok'
  const message =
    level === 'exhausted' || level === 'critical'
      ? 'Pause paid fallback work and route low-risk tasks to local or subscription providers.'
      : level === 'warning'
        ? 'Approaching the shared budget; prefer local or subscription providers for routine work.'
        : 'Observed daily spend is within the configured shared budget.'
  return {
    level,
    limitUsd: configured.limitUsd,
    usedUsd,
    remainingUsd: Math.max(0, configured.limitUsd - usedUsd),
    percentUsed,
    source: configured.source,
    observed,
    message,
  }
}

export type MonthlySpendSample = {
  provider: string
  displayName: string
  label: string
  measure: 'quota' | 'spend'
  used: number
  day: string
}

export function buildMonthlyUsageBudget(
  samples: Array<MonthlySpendSample>,
  periodDays = 31,
): MonthlyUsageBudget {
  const configured = configuredLimit('monthly')
  const observed = samples
    .filter(
      (sample) =>
        sample.measure === 'spend' &&
        Number.isFinite(sample.used) &&
        sample.used >= 0,
    )
    .map((sample) => ({
      provider: sample.displayName || sample.provider,
      label: `${sample.label} · ${sample.day}`,
      usedUsd: sample.used,
    }))
  if (configured.limitUsd === null) {
    return {
      level: 'unconfigured',
      limitUsd: null,
      usedUsd: null,
      remainingUsd: null,
      percentUsed: null,
      source: null,
      observed,
      periodDays,
      message:
        'Shared monthly budget is not configured; provider readings remain advisory.',
    }
  }
  if (observed.length === 0) {
    return {
      level: 'no_data',
      limitUsd: configured.limitUsd,
      usedUsd: null,
      remainingUsd: null,
      percentUsed: null,
      source: configured.source,
      observed,
      periodDays,
      message:
        'No monthly spend history is available from the configured providers.',
    }
  }
  const usedUsd = observed.reduce((total, item) => total + item.usedUsd, 0)
  const percentUsed = (usedUsd / configured.limitUsd) * 100
  const level: SharedBudgetLevel =
    percentUsed >= 100
      ? 'exhausted'
      : percentUsed >= 90
        ? 'critical'
        : percentUsed >= 75
          ? 'warning'
          : 'ok'
  return {
    level,
    limitUsd: configured.limitUsd,
    usedUsd,
    remainingUsd: Math.max(0, configured.limitUsd - usedUsd),
    percentUsed,
    source: configured.source,
    observed,
    periodDays,
    message:
      level === 'exhausted' || level === 'critical'
        ? 'Monthly budget is nearly exhausted; pause paid fallback work and prefer local or subscription providers.'
        : level === 'warning'
          ? 'Monthly budget is approaching its limit; prefer local or subscription providers for routine work.'
          : 'Observed monthly spend is within the configured shared budget.',
  }
}
