import type { ProviderUsageResult, UsageLine } from './provider-usage'

export type ProviderBudgetMode = 'advisory' | 'enforce'

export type ProviderBudgetRule = {
  limitUsd: number
  reservationUsd: number
}

export type ProviderSchedule = {
  provider: string
  usedUsd: number | null
  limitUsd: number | null
  reservationUsd: number
  requestedTasks: number
  remainingUsd: number | null
  maxConcurrent: number | null
  status: 'ok' | 'warning' | 'blocked' | 'unconfigured' | 'no_data'
}

export type ProviderScheduleDecision = {
  allowed: boolean
  mode: ProviderBudgetMode
  schedules: Array<ProviderSchedule>
  blockedProviders: Array<string>
  message: string
}

export type ProviderBudgetConfig = {
  rules: Record<string, ProviderBudgetRule>
  concurrency: Record<string, number>
  mode: ProviderBudgetMode
}

function positiveNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function providerKey(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized.includes('claude') || normalized.includes('anthropic'))
    return 'claude'
  if (normalized.includes('codex') || normalized.includes('openai'))
    return 'codex'
  if (normalized.includes('copilot')) return 'copilot'
  if (normalized.includes('hermes')) return 'hermes'
  if (normalized.includes('openrouter')) return 'openrouter'
  return normalized.replace(/[^a-z0-9_-]+/g, '-').slice(0, 64) || 'unknown'
}

export function providerKeyForWorkerModel(model: string): string {
  return providerKey(model)
}

function parseJsonObject(value: string | undefined): Record<string, unknown> {
  if (!value?.trim()) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function readProviderBudgetConfig(
  env: NodeJS.ProcessEnv = process.env,
): ProviderBudgetConfig {
  const rules: Record<string, ProviderBudgetRule> = {}
  for (const [rawProvider, rawRule] of Object.entries(
    parseJsonObject(env.HERMES_PROVIDER_DAILY_BUDGETS_JSON),
  )) {
    const provider = providerKey(rawProvider)
    const limitUsd =
      typeof rawRule === 'object' && rawRule !== null
        ? positiveNumber((rawRule as Record<string, unknown>).limitUsd)
        : positiveNumber(rawRule)
    if (limitUsd === null) continue
    const reservationUsd =
      typeof rawRule === 'object' && rawRule !== null
        ? positiveNumber((rawRule as Record<string, unknown>).reservationUsd) ?? 0
        : positiveNumber(env.HERMES_PROVIDER_RESERVATION_USD) ?? 0
    rules[provider] = { limitUsd, reservationUsd }
  }
  const concurrency: Record<string, number> = {}
  for (const [rawProvider, rawLimit] of Object.entries(
    parseJsonObject(env.HERMES_PROVIDER_CONCURRENCY_JSON),
  )) {
    const value = Number(rawLimit)
    if (Number.isInteger(value) && value > 0 && value <= 12)
      concurrency[providerKey(rawProvider)] = value
  }
  return {
    rules,
    concurrency,
    mode: env.HERMES_PROVIDER_BUDGET_MODE?.trim().toLowerCase() === 'enforce'
      ? 'enforce'
      : 'advisory',
  }
}

function spendFromLine(line: UsageLine): number | null {
  if (line.type === 'progress' && line.measure === 'spend') {
    return typeof line.used === 'number' && Number.isFinite(line.used)
      ? Math.max(0, line.used)
      : null
  }
  if (line.measure !== 'spend' || typeof line.value !== 'string') return null
  const match = line.value.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/)
  return match ? Number(match[1]) : null
}

export function dailySpendByProvider(
  providers: Array<ProviderUsageResult>,
): Map<string, number> {
  const result = new Map<string, number>()
  for (const provider of providers) {
    for (const line of provider.lines) {
      const used = spendFromLine(line)
      if (used === null) continue
      const key = providerKey(provider.provider || provider.displayName)
      result.set(key, (result.get(key) ?? 0) + used)
    }
  }
  return result
}

export function decideProviderSchedule(input: {
  providers: Array<string>
  usedUsdByProvider?: Map<string, number>
  config?: ProviderBudgetConfig
}): ProviderScheduleDecision {
  const config = input.config ?? readProviderBudgetConfig()
  const requested = new Map<string, number>()
  for (const provider of input.providers) {
    const key = providerKey(provider)
    requested.set(key, (requested.get(key) ?? 0) + 1)
  }
  const schedules: Array<ProviderSchedule> = []
  const blockedProviders: Array<string> = []
  for (const [provider, requestedTasks] of requested) {
    const rule = Object.prototype.hasOwnProperty.call(config.rules, provider)
      ? config.rules[provider]
      : undefined
    if (!rule) {
      schedules.push({
        provider,
        usedUsd: null,
        limitUsd: null,
        reservationUsd: 0,
        requestedTasks,
        remainingUsd: null,
        maxConcurrent: config.concurrency[provider] ?? null,
        status: 'unconfigured',
      })
      if (config.mode === 'enforce') blockedProviders.push(provider)
      continue
    }
    const usedUsd = input.usedUsdByProvider?.get(provider)
    const projectedUsd =
      usedUsd === undefined
        ? null
        : usedUsd + requestedTasks * rule.reservationUsd
    const blocked = projectedUsd === null || projectedUsd > rule.limitUsd
    const remainingUsd =
      projectedUsd === null ? null : Math.max(0, rule.limitUsd - projectedUsd)
    schedules.push({
      provider,
      usedUsd: usedUsd ?? null,
      limitUsd: rule.limitUsd,
      reservationUsd: rule.reservationUsd,
      requestedTasks,
      remainingUsd,
      maxConcurrent: config.concurrency[provider] ?? null,
      status: blocked
        ? projectedUsd === null
          ? 'no_data'
          : 'blocked'
        : projectedUsd >= rule.limitUsd * 0.75
          ? 'warning'
          : 'ok',
    })
    if (config.mode === 'enforce' && blocked) blockedProviders.push(provider)
  }
  const allowed = config.mode !== 'enforce' || blockedProviders.length === 0
  return {
    allowed,
    mode: config.mode,
    schedules,
    blockedProviders,
    message: allowed
      ? config.mode === 'enforce'
        ? 'Per-provider scheduling policy allows this dispatch.'
        : 'Per-provider scheduling policy is advisory; the dispatch is allowed.'
      : `Per-provider daily budget or usage data blocks: ${blockedProviders.join(', ')}.`,
  }
}

export function hasProviderBudgetPolicy(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Object.keys(readProviderBudgetConfig(env).rules).length > 0
}
