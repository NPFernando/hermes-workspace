// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  lastSevenUtcDays,
  providerFreshness,
  quotaAlert,
} from './ai-usage-panel'
import { codexCreditsUsageLine } from '../../../server/provider-usage'
import { AiUsagePanel } from './ai-usage-panel'

const { queryState } = vi.hoisted(() => ({
  queryState: {
    data: null as unknown,
    isError: false,
    isFetching: false,
    isPending: false,
    error: { message: '' },
    refetch: vi.fn(),
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => queryState,
}))

let root: Root | undefined

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  await cleanupPanel()
  queryState.data = null
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
})

async function renderPanel() {
  const host = document.createElement('div')
  document.body.append(host)
  const mountedRoot = createRoot(host)
  root = mountedRoot
  const today = lastSevenUtcDays().at(-1)!
  await act(async () => {
    mountedRoot.render(
      React.createElement(AiUsagePanel, {
        hermesUsage: { sessions: 2, tokens: 1200 },
        copilotUsage: {
          requests24h: 3,
          requests7d: 12,
          sessions7d: 2,
          inputTokens7d: 800,
          outputTokens7d: 400,
          aiu7d: 0.5,
          lastEventAt: null,
        },
        copilotDailyUsage: [
          {
            day: today,
            requests: 3,
            sessions: 2,
            inputTokens: 800,
            outputTokens: 400,
            aiu: 0.5,
          },
        ],
        hermesDailyUsage: [
          {
            day: today,
            sessions: 2,
            tokens: 1200,
            billedCostUsd: 0.2,
            estimatedCostUsd: 0.5,
          },
        ],
      }),
    )
  })
}

async function cleanupPanel() {
  const mountedRoot = root
  if (mountedRoot) await act(async () => mountedRoot.unmount())
  root = undefined
  document.body.replaceChildren()
}

describe('quotaAlert', () => {
  const line = (used: number, limit = 100) => ({
    type: 'progress' as const,
    label: 'Weekly',
    measure: 'quota' as const,
    used,
    limit,
    format: 'percent' as const,
  })

  it('warns at 75 percent and marks 90 percent as critical', () => {
    expect(quotaAlert(line(74.9))).toBeNull()
    expect(quotaAlert(line(75))).toBe('warning')
    expect(quotaAlert(line(90))).toBe('critical')
  })

  it('marks exhausted and over-limit usage as reached', () => {
    expect(quotaAlert(line(100))).toBe('limit')
    expect(quotaAlert(line(125))).toBe('limit')
  })

  it('does not alert on text, badges, or unusable limits', () => {
    expect(
      quotaAlert({ type: 'text', label: 'Tokens', used: 100, limit: 100 }),
    ).toBeNull()
    expect(quotaAlert(line(10, 0))).toBeNull()
    expect(quotaAlert({ ...line(95), measure: 'usage' })).toBeNull()
  })

  it('shows a Codex credits balance without inventing a quota ceiling', () => {
    const credits = codexCreditsUsageLine(1250)

    expect(credits).toMatchObject({
      type: 'text',
      label: 'Credits balance',
      value: '1,250',
    })
    expect(quotaAlert(credits)).toBeNull()
  })
})

describe('providerFreshness', () => {
  it('marks provider snapshots stale after the ten-minute freshness window', () => {
    expect(providerFreshness(100_000, 700_000)).toBe('current')
    expect(providerFreshness(99_999, 700_000)).toBe('stale')
  })
})

describe('lastSevenUtcDays', () => {
  it('returns seven calendar dates in UTC across month and year boundaries', () => {
    expect(lastSevenUtcDays(Date.UTC(2026, 0, 2, 1))).toEqual([
      '2025-12-27',
      '2025-12-28',
      '2025-12-29',
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
      '2026-01-02',
    ])
  })
})

describe('AiUsagePanel rendered provider dashboard', () => {
  it('labels missing feeds, source and estimates without inventing a shared budget', async () => {
    queryState.data = {
      ok: true,
      updatedAt: Date.now(),
      providers: [
        {
          provider: 'codex',
          displayName: 'Codex',
          status: 'ok',
          plan: 'Plus',
          source: 'Undocumented account endpoint',
          sourceKind: 'provider_api',
          lines: [
            { type: 'text', label: 'Credits balance', value: '1000', measure: 'balance' },
          ],
          updatedAt: Date.now(),
        },
        {
          provider: 'claude',
          displayName: 'Claude',
          status: 'missing_credentials',
          message: 'No Claude credentials found.',
          source: 'OAuth usage endpoint',
          lines: [],
          updatedAt: Date.now(),
        },
      ],
      history: [
        {
          day: lastSevenUtcDays().at(-1),
          provider: 'codex',
          displayName: 'Codex',
          label: 'Weekly session usage',
          measure: 'quota',
          used: 60,
          limit: 100,
          percent: 60,
          sampledAt: Date.now(),
          source: 'Undocumented account endpoint',
        },
      ],
    }

    try {
      await renderPanel()
      const text = document.body.textContent ?? ''
      expect(text).toContain('Not configured')
      expect(text).toContain('No Claude credentials found.')
      expect(text).toContain('Source: Undocumented account endpoint')
      expect(text).toContain('provider limits unavailable')
      expect(text).toContain('Copilot requests')
      expect(text).toContain('Hermes gateway sessions')
      expect(text).toContain('actual where available; otherwise estimated')
      expect(text).toContain('Codex · Weekly session usage snapshot')
      expect(text).toContain('Missing days mean no source data was observed, not zero usage.')
      expect(text).toContain('Provider limits are separate and are not a combined budget')
    } finally {
      await cleanupPanel()
    }
  })
})
