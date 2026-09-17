import { describe, expect, it } from 'vitest'
import { decideUsageBudget } from './usage-budget-guard'
import type { MonthlyUsageBudget, SharedUsageBudget } from './usage-budget'

const daily = (level: SharedUsageBudget['level']): SharedUsageBudget => ({
  level,
  limitUsd: level === 'unconfigured' ? null : 10,
  usedUsd: level === 'no_data' || level === 'unconfigured' ? null : 10,
  remainingUsd: level === 'no_data' || level === 'unconfigured' ? null : 0,
  percentUsed: level === 'no_data' || level === 'unconfigured' ? null : 100,
  source: null,
  observed: [],
  message: '',
})

const monthly = (level: MonthlyUsageBudget['level']): MonthlyUsageBudget => ({
  ...daily(level),
  periodDays: 31,
})

describe('usage budget enforcement', () => {
  it('keeps the default advisory mode non-blocking', () => {
    expect(
      decideUsageBudget({ daily: daily('exhausted'), monthly: monthly('ok') }),
    ).toMatchObject({
      allowed: true,
      mode: 'advisory',
      blockedPeriod: 'daily',
    })
  })

  it('blocks an exhausted daily budget in enforce mode', () => {
    expect(
      decideUsageBudget({
        mode: 'enforce',
        daily: daily('exhausted'),
        monthly: monthly('ok'),
      }),
    ).toMatchObject({
      allowed: false,
      blockedPeriod: 'daily',
    })
  })

  it('blocks an exhausted monthly budget when daily remains available', () => {
    expect(
      decideUsageBudget({
        mode: 'enforce',
        daily: daily('warning'),
        monthly: monthly('exhausted'),
      }),
    ).toMatchObject({
      allowed: false,
      blockedPeriod: 'monthly',
    })
  })

  it('allows missing usage data without treating it as zero', () => {
    expect(
      decideUsageBudget({
        mode: 'enforce',
        daily: daily('no_data'),
        monthly: monthly('no_data'),
      }),
    ).toMatchObject({
      allowed: true,
      blockedPeriod: null,
    })
  })
})
