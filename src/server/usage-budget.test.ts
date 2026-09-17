import { afterEach, describe, expect, it } from 'vitest'
import { buildMonthlyUsageBudget, buildSharedUsageBudget } from './usage-budget'
import type { ProviderUsageResult } from './provider-usage'

const original = process.env.HERMES_SHARED_DAILY_BUDGET_USD
const originalMonthly = process.env.HERMES_SHARED_MONTHLY_BUDGET_USD
const originalConfig = process.env.HERMES_CONFIG_PATH
const originalConfigMode = process.env.HERMES_SHARED_BUDGET_CONFIG

afterEach(() => {
  if (original === undefined) delete process.env.HERMES_SHARED_DAILY_BUDGET_USD
  else process.env.HERMES_SHARED_DAILY_BUDGET_USD = original
  if (originalMonthly === undefined)
    delete process.env.HERMES_SHARED_MONTHLY_BUDGET_USD
  else process.env.HERMES_SHARED_MONTHLY_BUDGET_USD = originalMonthly
  if (originalConfig === undefined) delete process.env.HERMES_CONFIG_PATH
  else process.env.HERMES_CONFIG_PATH = originalConfig
  if (originalConfigMode === undefined)
    delete process.env.HERMES_SHARED_BUDGET_CONFIG
  else process.env.HERMES_SHARED_BUDGET_CONFIG = originalConfigMode
})

function provider(used: number): ProviderUsageResult {
  return {
    provider: 'openrouter',
    displayName: 'OpenRouter',
    status: 'ok',
    updatedAt: Date.now(),
    lines: [
      {
        type: 'text',
        label: 'Daily key spend',
        measure: 'spend',
        value: `$${used.toFixed(2)}`,
      },
    ],
  }
}

describe('shared usage budget', () => {
  it('is explicit when no budget policy is configured', () => {
    delete process.env.HERMES_SHARED_DAILY_BUDGET_USD
    process.env.HERMES_CONFIG_PATH = '/tmp/hermes-no-budget-config'
    process.env.HERMES_SHARED_BUDGET_CONFIG = 'disabled'
    expect(buildSharedUsageBudget([provider(1)])).toMatchObject({
      level: 'unconfigured',
      usedUsd: null,
    })
  })

  it('aggregates observed daily spend and emits threshold levels', () => {
    process.env.HERMES_SHARED_DAILY_BUDGET_USD = '10'
    expect(buildSharedUsageBudget([provider(4), provider(4)])).toMatchObject({
      level: 'warning',
      usedUsd: 8,
      remainingUsd: 2,
      percentUsed: 80,
    })
    expect(buildSharedUsageBudget([provider(10)])).toMatchObject({
      level: 'exhausted',
      percentUsed: 100,
    })
  })

  it('does not convert missing provider readings into zero data', () => {
    process.env.HERMES_SHARED_DAILY_BUDGET_USD = '10'
    expect(
      buildSharedUsageBudget([{ ...provider(0), lines: [] }]),
    ).toMatchObject({ level: 'no_data', usedUsd: null })
  })

  it('aggregates monthly spend history and keeps missing history explicit', () => {
    process.env.HERMES_SHARED_MONTHLY_BUDGET_USD = '100'
    expect(
      buildMonthlyUsageBudget([
        {
          provider: 'openrouter',
          displayName: 'OpenRouter',
          label: 'Daily spend',
          measure: 'spend',
          used: 40,
          day: '2026-09-01',
        },
        {
          provider: 'openai',
          displayName: 'OpenAI',
          label: 'Daily spend',
          measure: 'spend',
          used: 40,
          day: '2026-09-02',
        },
      ]),
    ).toMatchObject({ level: 'warning', usedUsd: 80, remainingUsd: 20 })
    expect(
      buildMonthlyUsageBudget([
        {
          provider: 'openrouter',
          displayName: 'OpenRouter',
          label: 'Quota',
          measure: 'quota',
          used: 99,
          day: '2026-09-01',
        },
      ]),
    ).toMatchObject({ level: 'no_data', usedUsd: null })
  })
})
