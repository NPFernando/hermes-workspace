export const DEFAULT_PROFIT_LOCK_THRESHOLD_USDT = 5
export const DEFAULT_WITHDRAWAL_REVIEW_THRESHOLD_USDT = 10
export const PROFIT_WITHDRAWAL_SHARE = 0.5

export type CapitalProtectionAction =
  | 'normal'
  | 'lock_profit_reduce_exposure'
  | 'pause_after_loss_manual_review'

export interface CapitalProtectionDecision {
  action: CapitalProtectionAction
  newEntriesAllowed: boolean
  reduceExposure: boolean
  exposureMultiplier: number
  manualReviewRequired: boolean
  withdrawalEligible: boolean
  recommendedWithdrawalQuote: number
  detail: string
}

export function evaluateCapitalProtection(input: {
  executionMode: string | null
  dailyPnlQuote: number
  totalRealizedPnlQuote: number
  allocationCapUsdt: number
  profitLockThresholdUsdt?: number
  withdrawalReviewThresholdUsdt?: number
}): CapitalProtectionDecision {
  const profitLockThreshold =
    input.profitLockThresholdUsdt ?? DEFAULT_PROFIT_LOCK_THRESHOLD_USDT
  const withdrawalThreshold =
    input.withdrawalReviewThresholdUsdt ??
    DEFAULT_WITHDRAWAL_REVIEW_THRESHOLD_USDT
  const isLive = input.executionMode === 'live'
  const withdrawalEligible =
    isLive && input.totalRealizedPnlQuote >= withdrawalThreshold
  const recommendedWithdrawalQuote = withdrawalEligible
    ? Math.max(
        0,
        (input.totalRealizedPnlQuote - withdrawalThreshold) *
          PROFIT_WITHDRAWAL_SHARE,
      )
    : 0

  if (isLive && input.dailyPnlQuote < 0) {
    return {
      action: 'pause_after_loss_manual_review',
      newEntriesAllowed: false,
      reduceExposure: false,
      exposureMultiplier: 1,
      manualReviewRequired: true,
      withdrawalEligible: false,
      recommendedWithdrawalQuote: 0,
      detail: `live realized loss today (${input.dailyPnlQuote.toFixed(2)} USDT) requires manual review before new entries`,
    }
  }

  if (isLive && input.dailyPnlQuote >= profitLockThreshold) {
    return {
      action: 'lock_profit_reduce_exposure',
      newEntriesAllowed: true,
      reduceExposure: true,
      exposureMultiplier: 0.5,
      manualReviewRequired: withdrawalEligible,
      withdrawalEligible,
      recommendedWithdrawalQuote,
      detail: `profit lock active at ${input.dailyPnlQuote.toFixed(2)} USDT today; new exposure is limited to 50% of the configured cap`,
    }
  }

  return {
    action: 'normal',
    newEntriesAllowed: true,
    reduceExposure: false,
    exposureMultiplier: 1,
    manualReviewRequired: false,
    withdrawalEligible: false,
    recommendedWithdrawalQuote: 0,
    detail: `no live capital-protection trigger; allocation cap ${input.allocationCapUsdt.toFixed(2)} USDT`,
  }
}
