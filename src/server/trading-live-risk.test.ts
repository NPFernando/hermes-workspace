import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LIVE_ALLOCATION_CAP_USDT,
  DEFAULT_LIVE_DAILY_LOSS_CAP_USDT,
  MAX_LIVE_ALLOCATION_CAP_USDT,
  MAX_LIVE_DAILY_LOSS_CAP_USDT,
  liveRiskCapsAreValid,
  resolveLiveRiskCaps,
} from './trading-live-risk'

describe('live pilot risk caps', () => {
  it('provides tiny safe defaults', () => {
    expect(resolveLiveRiskCaps({})).toEqual({
      allocationCapUsdt: DEFAULT_LIVE_ALLOCATION_CAP_USDT,
      dailyLossCapUsdt: DEFAULT_LIVE_DAILY_LOSS_CAP_USDT,
    })
  })

  it('clamps malformed or oversized runtime values down', () => {
    expect(
      resolveLiveRiskCaps({
        liveAllocationCapUsdt: 1000,
        liveDailyLossCapUsdt: 1000,
      }),
    ).toEqual({
      allocationCapUsdt: MAX_LIVE_ALLOCATION_CAP_USDT,
      dailyLossCapUsdt: MAX_LIVE_DAILY_LOSS_CAP_USDT,
    })
  })

  it('rejects oversized operator settings before approval', () => {
    expect(
      liveRiskCapsAreValid({ liveAllocationCapUsdt: 25.01 }),
    ).toBe(false)
    expect(
      liveRiskCapsAreValid({ liveDailyLossCapUsdt: 2.51 }),
    ).toBe(false)
    expect(
      liveRiskCapsAreValid({ liveAllocationCapUsdt: 25, liveDailyLossCapUsdt: 2.5 }),
    ).toBe(true)
  })
})
