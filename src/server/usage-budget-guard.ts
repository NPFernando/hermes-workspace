import { getProviderUsage } from './provider-usage'
import { recordAndReadProviderUsageHistory } from './provider-usage-history'
import { buildMonthlyUsageBudget } from './usage-budget'
import type {
  MonthlySpendSample,
  MonthlyUsageBudget,
  SharedUsageBudget,
} from './usage-budget'

export type UsageBudgetMode = 'advisory' | 'enforce'

export type UsageBudgetDecision = {
  allowed: boolean
  mode: UsageBudgetMode
  blockedPeriod: 'daily' | 'monthly' | null
  daily: SharedUsageBudget
  monthly: MonthlyUsageBudget
  message: string
}

function readMode(): UsageBudgetMode {
  return process.env.HERMES_SHARED_BUDGET_MODE?.trim().toLowerCase() ===
    'enforce'
    ? 'enforce'
    : 'advisory'
}

export function isUsageBudgetEnforced(): boolean {
  return readMode() === 'enforce'
}

export function decideUsageBudget({
  mode = readMode(),
  daily,
  monthly,
}: {
  mode?: UsageBudgetMode
  daily: SharedUsageBudget
  monthly: MonthlyUsageBudget
}): UsageBudgetDecision {
  const dailyExhausted = daily.level === 'exhausted'
  const monthlyExhausted = monthly.level === 'exhausted'
  const blockedPeriod = dailyExhausted
    ? 'daily'
    : monthlyExhausted
      ? 'monthly'
      : null
  const allowed = mode !== 'enforce' || blockedPeriod === null

  return {
    allowed,
    mode,
    blockedPeriod,
    daily,
    monthly,
    message: allowed
      ? mode === 'enforce'
        ? 'Configured budget enforcement allows this request.'
        : 'Budget policy is advisory; the request is allowed.'
      : `Configured ${blockedPeriod} AI budget is exhausted; remote provider requests are temporarily paused.`,
  }
}

/**
 * Read the cached provider usage signals and make one request-boundary
 * decision. Missing or degraded usage remains explicitly non-blocking.
 */
export async function getUsageBudgetDecision(): Promise<UsageBudgetDecision> {
  const payload = await getProviderUsage()
  let history: Array<MonthlySpendSample> = []
  try {
    history = recordAndReadProviderUsageHistory(payload.providers, { days: 31 })
  } catch {
    // Missing history is no-data, never zero spend.
  }
  return decideUsageBudget({
    daily: payload.sharedBudget,
    monthly: buildMonthlyUsageBudget(history),
  })
}
