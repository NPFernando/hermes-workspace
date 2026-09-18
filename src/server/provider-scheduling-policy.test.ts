import { describe, expect, it } from 'vitest'
import {
  dailySpendByProvider,
  decideProviderSchedule,
  providerKeyForWorkerModel,
  readProviderBudgetConfig,
} from './provider-scheduling-policy'

describe('provider scheduling policy', () => {
  it('normalizes worker models into provider buckets', () => {
    expect(providerKeyForWorkerModel('anthropic/claude-sonnet')).toBe('claude')
    expect(providerKeyForWorkerModel('openai-codex:gpt-5')).toBe('codex')
    expect(providerKeyForWorkerModel('GitHub Copilot')).toBe('copilot')
  })

  it('reads limits, reservations, and concurrency without exposing secrets', () => {
    expect(
      readProviderBudgetConfig({
        HERMES_PROVIDER_DAILY_BUDGETS_JSON: JSON.stringify({
          codex: { limitUsd: 10, reservationUsd: 0.25 },
        }),
        HERMES_PROVIDER_CONCURRENCY_JSON: JSON.stringify({ codex: 2 }),
        HERMES_PROVIDER_BUDGET_MODE: 'enforce',
      }),
    ).toEqual({
      mode: 'enforce',
      rules: { codex: { limitUsd: 10, reservationUsd: 0.25 } },
      concurrency: { codex: 2 },
    })
  })

  it('aggregates daily spend by provider', () => {
    const spend = dailySpendByProvider([
      {
        provider: 'openrouter',
        displayName: 'OpenRouter',
        status: 'ok',
        updatedAt: Date.now(),
        lines: [
          {
            type: 'text',
            label: 'Daily key spend',
            measure: 'spend',
            value: '$1.25',
          },
        ],
      },
    ])
    expect(spend.get('openrouter')).toBe(1.25)
  })

  it('blocks projected reservations in enforce mode', () => {
    const decision = decideProviderSchedule({
      providers: ['codex', 'codex'],
      usedUsdByProvider: new Map([['codex', 9.6]]),
      config: {
        mode: 'enforce',
        rules: { codex: { limitUsd: 10, reservationUsd: 0.25 } },
        concurrency: { codex: 1 },
      },
    })
    expect(decision.allowed).toBe(false)
    expect(decision.blockedProviders).toEqual(['codex'])
    expect(decision.schedules[0]).toMatchObject({
      status: 'blocked',
      maxConcurrent: 1,
      remainingUsd: 0,
    })
  })

  it('keeps missing readings explicit instead of treating them as zero', () => {
    const decision = decideProviderSchedule({
      providers: ['claude'],
      config: {
        mode: 'enforce',
        rules: { claude: { limitUsd: 10, reservationUsd: 0 } },
        concurrency: {},
      },
    })
    expect(decision.allowed).toBe(false)
    expect(decision.schedules[0].status).toBe('no_data')
  })
})
