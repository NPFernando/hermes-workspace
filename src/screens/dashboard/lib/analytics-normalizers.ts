/* eslint-disable @typescript-eslint/no-unnecessary-condition -- analytics is untrusted runtime JSON */
import type { DashboardAnalyticsSection } from '@/server/dashboard-aggregator'

export function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function safeAnalyticsModels(
  analytics: DashboardAnalyticsSection,
): DashboardAnalyticsSection['topModels'] {
  // The gateway may return a structurally partial object during upgrades or
  // while a provider is reconnecting. Keep cards renderable even when the
  // response does not satisfy the server-side TypeScript contract.
  const models = Array.isArray(analytics.topModels) ? analytics.topModels : []
  return models.map((model) => ({
    id: typeof model?.id === 'string' ? model.id : 'unknown',
    tokens: safeNumber(model?.tokens),
    calls: safeNumber(model?.calls),
    cost: safeNumber(model?.cost),
    sessions: safeNumber(model?.sessions),
  }))
}

export function safeAnalyticsDaily(
  analytics: DashboardAnalyticsSection,
): DashboardAnalyticsSection['daily'] {
  const daily = Array.isArray(analytics.daily) ? analytics.daily : []
  return daily.map((day) => ({
    day: typeof day?.day === 'string' ? day.day : '',
    inputTokens: safeNumber(day?.inputTokens),
    outputTokens: safeNumber(day?.outputTokens),
    cacheReadTokens: safeNumber(day?.cacheReadTokens),
    reasoningTokens: safeNumber(day?.reasoningTokens),
    sessions: safeNumber(day?.sessions),
    apiCalls: safeNumber(day?.apiCalls),
    estimatedCost: safeNumber(day?.estimatedCost),
  }))
}

/**
 * Keep the trend selector honest when the gateway returns a larger window
 * than the chart currently displays. The gateway normally emits ascending
 * dates, but sorting here keeps the UI correct across providers and older
 * payloads that arrive in reverse order.
 */
export function selectAnalyticsDailyPeriod(
  daily: DashboardAnalyticsSection['daily'],
  period: 7 | 14 | 30,
): DashboardAnalyticsSection['daily'] {
  return [...daily]
    .sort((a, b) => {
      const aTime = Date.parse(a.day)
      const bTime = Date.parse(b.day)
      if (!Number.isFinite(aTime) || !Number.isFinite(bTime)) return 0
      return aTime - bTime
    })
    .slice(-period)
}
