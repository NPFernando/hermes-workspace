// @vitest-environment jsdom
import React from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardOverview } from '@/server/dashboard-aggregator'
import { DashboardRefreshProvider } from '@/screens/dashboard/lib/dashboard-refresh-context'
import { AnalyticsChartCard } from './analytics-chart-card'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('recharts', () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children)
  const Chart = () => null

  return {
    Area: Passthrough,
    AreaChart: Chart,
    Bar: Passthrough,
    BarChart: Chart,
    CartesianGrid: Passthrough,
    ResponsiveContainer: Passthrough,
    Tooltip: Passthrough,
    XAxis: Passthrough,
    YAxis: Passthrough,
  }
})

const analytics: NonNullable<DashboardOverview['analytics']> = {
  windowDays: 7,
  totalTokens: 1200,
  inputTokens: 800,
  outputTokens: 400,
  cacheReadTokens: 100,
  reasoningTokens: 0,
  totalSessions: 2,
  totalApiCalls: 4,
  topModels: [],
  daily: [
    {
      day: '2026-09-09',
      inputTokens: 800,
      outputTokens: 400,
      cacheReadTokens: 100,
      reasoningTokens: 0,
      sessions: 2,
      apiCalls: 4,
      estimatedCost: 0,
    },
  ],
  estimatedCostUsd: 0,
  costLabel: 'included',
  source: 'analytics',
}

describe('AnalyticsChartCard', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('recovers from unavailable telemetry without changing hook order', () => {
    const rootElement = document.createElement('div')
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    const props = {
      analytics: null,
      insights: [],
      period: 7 as const,
      onPeriodChange: vi.fn(),
      loading: false,
    }

    React.act(() => {
      root.render(
        React.createElement(
          DashboardRefreshProvider,
          { refresh: vi.fn() },
          React.createElement(AnalyticsChartCard, {
            ...props,
            unavailable: true,
          }),
        ),
      )
    })

    expect(rootElement.textContent).toContain('Usage analytics')

    React.act(() => {
      root.render(
        React.createElement(
          DashboardRefreshProvider,
          { refresh: vi.fn() },
          React.createElement(AnalyticsChartCard, {
            ...props,
            analytics,
            unavailable: false,
          }),
        ),
      )
    })

    expect(rootElement.textContent).toContain('Usage trend · 7d')
    expect(rootElement.textContent).toContain('1.2K tokens')
    expect(rootElement.textContent).toContain('First telemetry point recorded')

    React.act(() => root.unmount())
    rootElement.remove()
  })

  it('renders partial analytics payloads without taking down the dashboard', () => {
    const rootElement = document.createElement('div')
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)
    const partialAnalytics = {
      ...analytics,
      totalApiCalls: undefined,
      daily: [
        {
          day: undefined,
          inputTokens: undefined,
          outputTokens: undefined,
          cacheReadTokens: undefined,
          reasoningTokens: undefined,
          sessions: undefined,
          apiCalls: undefined,
          estimatedCost: undefined,
        },
      ],
      topModels: [
        {
          id: 'partial-model',
          tokens: undefined,
          calls: undefined,
          cost: undefined,
          sessions: undefined,
        },
      ],
    } as unknown as NonNullable<DashboardOverview['analytics']>

    React.act(() => {
      root.render(
        React.createElement(AnalyticsChartCard, {
          analytics: partialAnalytics,
          insights: [],
          period: 7,
          onPeriodChange: vi.fn(),
          loading: false,
        }),
      )
    })

    expect(rootElement.textContent).toContain('Usage trend · 7d')
    expect(rootElement.textContent).toContain('0 calls')

    React.act(() => root.unmount())
    rootElement.remove()
  })
})
