/** Hard first-pilot limits, independent from larger sandbox limits. */
export const DEFAULT_LIVE_ALLOCATION_CAP_USDT = 25
export const DEFAULT_LIVE_DAILY_LOSS_CAP_USDT = 2.5
export const MAX_LIVE_ALLOCATION_CAP_USDT = 25
export const MAX_LIVE_DAILY_LOSS_CAP_USDT = 2.5

export interface LiveRiskCaps {
  allocationCapUsdt: number
  dailyLossCapUsdt: number
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** Malformed settings can only reduce the pilot caps at runtime. */
export function resolveLiveRiskCaps(
  settings: Record<string, unknown>,
): LiveRiskCaps {
  const allocation = positiveFinite(settings.liveAllocationCapUsdt)
    ? Math.min(settings.liveAllocationCapUsdt, MAX_LIVE_ALLOCATION_CAP_USDT)
    : DEFAULT_LIVE_ALLOCATION_CAP_USDT
  const dailyLoss = positiveFinite(settings.liveDailyLossCapUsdt)
    ? Math.min(settings.liveDailyLossCapUsdt, MAX_LIVE_DAILY_LOSS_CAP_USDT)
    : DEFAULT_LIVE_DAILY_LOSS_CAP_USDT
  return { allocationCapUsdt: allocation, dailyLossCapUsdt: dailyLoss }
}

export function liveRiskCapsAreValid(
  settings: Record<string, unknown>,
): boolean {
  const allocation = settings.liveAllocationCapUsdt
  const dailyLoss = settings.liveDailyLossCapUsdt
  return (
    (allocation === undefined ||
      (positiveFinite(allocation) && allocation <= MAX_LIVE_ALLOCATION_CAP_USDT)) &&
    (dailyLoss === undefined ||
      (positiveFinite(dailyLoss) && dailyLoss <= MAX_LIVE_DAILY_LOSS_CAP_USDT))
  )
}
