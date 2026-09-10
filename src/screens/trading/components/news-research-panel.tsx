/**
 * News research + intelligence-summary panels for the Trading section.
 * Extracted verbatim from trading-screen.tsx (2026-09-10).
 */
import { useState } from 'react'
import { formatDateTime } from '../format-helpers'
import type { FinancePayload } from '../trading-types'

type NewsResearchItem = {
  id: string
  sourceName: string
  sourceUrl: string | null
  publishDate: string | null
  relatedSymbol: string
  summary: string
}

type NewsIngestion = {
  fetched: number
  stored: number
}

type IntelligenceRefresh = {
  researchOnly: boolean
  composite: {
    symbol: string
    score: number | null
    label: 'positive' | 'neutral' | 'negative' | 'mixed' | 'unknown'
    confidence: number
    freshness: number
    sourceIds: Array<string>
    disagreement: boolean
    blockers: Array<string>
    observedAt: string
  }
  stored: {
    stored: boolean
    risk: {
      riskLevel: string
      riskScore: number
    }
  }
}

const DEFAULT_NEWS_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
const BINANCE_SYMBOL_PATTERN = /^[A-Z0-9]{5,20}$/

function normalizeBinanceSymbol(value: string): string {
  return value.trim().toUpperCase()
}

function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function normalizedNewsItem(
  value: Record<string, unknown>,
): NewsResearchItem | null {
  const summary = typeof value.summary === 'string' ? value.summary.trim() : ''
  const sourceName =
    typeof value.sourceName === 'string' ? value.sourceName.trim() : ''
  const relatedSymbol =
    typeof value.relatedSymbol === 'string'
      ? normalizeBinanceSymbol(value.relatedSymbol)
      : ''
  if (!summary || !sourceName || !BINANCE_SYMBOL_PATTERN.test(relatedSymbol))
    return null
  const publishDate =
    typeof value.publishDate === 'string' ? value.publishDate : null
  return {
    id:
      typeof value.id === 'string'
        ? value.id
        : `${relatedSymbol}:${sourceName}:${summary}`,
    sourceName,
    sourceUrl: safeExternalUrl(value.sourceUrl),
    publishDate:
      publishDate && !Number.isNaN(Date.parse(publishDate))
        ? publishDate
        : null,
    relatedSymbol,
    summary,
  }
}

function formatNewsTime(value: string | null): string {
  if (!value) return 'Publication time unavailable'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function NewsResearchPanel({
  payload,
  onPayload,
}: {
  payload: FinancePayload
  onPayload: (payload: FinancePayload) => void
}) {
  const configuredSymbols = Array.isArray(
    (payload.settings.demoTrading as Record<string, unknown> | undefined)
      ?.symbols,
  )
    ? (
        (payload.settings.demoTrading as Record<string, unknown>)
          .symbols as Array<unknown>
      )
        .filter((value): value is string => typeof value === 'string')
        .map(normalizeBinanceSymbol)
        .filter((value) => BINANCE_SYMBOL_PATTERN.test(value))
    : []
  const symbols = Array.from(
    new Set([...configuredSymbols, ...DEFAULT_NEWS_SYMBOLS]),
  )
  const [symbolInput, setSymbolInput] = useState(symbols[0] ?? 'BTCUSDT')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<NewsIngestion | null>(null)
  const symbol = normalizeBinanceSymbol(symbolInput)
  const isValidSymbol = BINANCE_SYMBOL_PATTERN.test(symbol)
  const newsItems = payload.data.news_items
    .map(normalizedNewsItem)
    .filter(
      (item): item is NewsResearchItem =>
        item !== null && item.relatedSymbol === symbol,
    )
    .sort(
      (left, right) =>
        (right.publishDate ? Date.parse(right.publishDate) : 0) -
        (left.publishDate ? Date.parse(left.publishDate) : 0),
    )
    .slice(0, 6)

  async function fetchNews() {
    if (!isValidSymbol) {
      setError(
        'Enter a Binance spot symbol using 5–20 letters or numbers, for example BTCUSDT.',
      )
      return
    }
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const response = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fetch_news', symbol }),
      })
      const data = (await response.json()) as FinancePayload & {
        error?: string
        newsIngestion?: NewsIngestion
      }
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${response.status}`)
      }
      onPayload(data)
      setResult(data.newsIngestion ?? { fetched: 0, stored: 0 })
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'News research request failed',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="mt-6 rounded-3xl border border-[color-mix(in_srgb,var(--theme-accent-secondary)_25%,transparent)] bg-[var(--theme-panel)]/70 p-5"
      aria-label="Trading news research"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color-mix(in_srgb,var(--theme-accent-secondary)_80%,transparent)]">
            Research only
          </p>
          <h2 className="mt-1 text-lg font-semibold">News Research</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--theme-muted)]">
            Fetches public Google News RSS for a Binance spot symbol. This does
            not create plans, orders, or executions.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs font-medium text-[var(--theme-muted)]">
            Binance symbol
            <input
              list="finance-news-symbols"
              value={symbolInput}
              onChange={(event) => setSymbolInput(event.target.value)}
              className="w-36 rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-2 text-sm text-[var(--theme-text)]"
              aria-invalid={!isValidSymbol}
              aria-describedby="finance-news-symbol-help"
              placeholder="BTCUSDT"
            />
          </label>
          <datalist id="finance-news-symbols">
            {symbols.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          <button
            type="button"
            onClick={() => void fetchNews()}
            disabled={busy || !isValidSymbol}
            className="rounded-xl bg-[color-mix(in_srgb,var(--theme-accent-secondary)_20%,transparent)] px-4 py-2 text-sm font-semibold text-[var(--theme-accent-secondary)] transition-colors hover:bg-[color-mix(in_srgb,var(--theme-accent-secondary)_30%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Fetching…' : 'Fetch news'}
          </button>
        </div>
      </div>
      <p
        id="finance-news-symbol-help"
        className="mt-2 text-xs text-[var(--theme-muted)]"
      >
        Choose a configured symbol or enter a 5–20 character Binance spot
        symbol.
      </p>
      {error && (
        <p
          className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] px-3 py-2 text-sm text-[var(--theme-danger)]"
          role="alert"
        >
          {error}
        </p>
      )}
      {result && (
        <p
          className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] px-3 py-2 text-sm text-[var(--theme-success)]"
          role="status"
        >
          Research refreshed for {symbol}: fetched {result.fetched}, stored{' '}
          {result.stored} new item{result.stored === 1 ? '' : 's'}.
        </p>
      )}
      <div className="mt-4 space-y-2" aria-live="polite">
        {newsItems.length === 0 ? (
          <p className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3 text-sm text-[var(--theme-muted)]">
            No normalized news items stored for {symbol}. Fetch research to
            refresh this list.
          </p>
        ) : (
          newsItems.map((item) => (
            <article
              key={item.id}
              className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3"
            >
              <p className="text-sm leading-5 text-[var(--theme-text)]">
                {item.summary}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--theme-muted)]">
                <span>{item.sourceName}</span>
                <time dateTime={item.publishDate ?? undefined}>
                  {formatNewsTime(item.publishDate)}
                </time>
                {item.sourceUrl && (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--theme-accent-secondary)] underline underline-offset-2 hover:text-[var(--theme-accent-secondary)]"
                  >
                    Open publisher
                  </a>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  )
}

export function IntelligenceSummaryPanel({
  onPayload,
}: {
  onPayload: (payload: FinancePayload) => void
}) {
  const [symbol, setSymbol] = useState(DEFAULT_NEWS_SYMBOLS[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [intelligence, setIntelligence] = useState<IntelligenceRefresh | null>(
    null,
  )

  async function refresh() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh_intelligence', symbol }),
      })
      const data = (await response.json()) as FinancePayload & {
        error?: string
        intelligence?: IntelligenceRefresh
      }
      if (!response.ok || data.ok === false)
        throw new Error(data.error || `HTTP ${response.status}`)
      onPayload(data)
      setIntelligence(data.intelligence ?? null)
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Intelligence refresh failed',
      )
    } finally {
      setBusy(false)
    }
  }

  const composite = intelligence?.composite
  return (
    <section
      className="mt-6 rounded-3xl border border-[color-mix(in_srgb,var(--theme-accent)_25%,transparent)] bg-[var(--theme-panel)]/70 p-5"
      aria-label="Intelligence summary"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color-mix(in_srgb,var(--theme-accent)_80%,transparent)]">
            Research only
          </p>
          <h2 className="mt-1 text-lg font-semibold">Intelligence Summary</h2>
          <p className="mt-1 text-sm text-[var(--theme-muted)]">
            Derived from stored news. It does not create plans, orders, or
            executions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={symbol}
            onChange={(event) =>
              setSymbol(normalizeBinanceSymbol(event.target.value))
            }
            className="rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-2 text-sm text-[var(--theme-text)]"
            aria-label="Intelligence symbol"
          >
            {DEFAULT_NEWS_SYMBOLS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
            className="rounded-xl bg-[color-mix(in_srgb,var(--theme-accent)_20%,transparent)] px-4 py-2 text-sm font-semibold text-[var(--theme-accent)] transition-colors hover:bg-[color-mix(in_srgb,var(--theme-accent)_30%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      {error && (
        <p className="mt-3 text-sm text-[var(--theme-danger)]" role="alert">
          {error}
        </p>
      )}
      {composite ? (
        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <p>
            Sentiment: <strong>{composite.label}</strong> (
            {composite.score ?? 'unavailable'})
          </p>
          <p>
            Confidence:{' '}
            <strong>{Math.round(composite.confidence * 100)}%</strong>
          </p>
          <p>
            Freshness: <strong>{Math.round(composite.freshness * 100)}%</strong>
          </p>
          <p>
            Research risk: <strong>{intelligence.stored.risk.riskLevel}</strong>
          </p>
          <p className="sm:col-span-2">
            Evidence: {composite.sourceIds.length} stored source
            {composite.sourceIds.length === 1 ? '' : 's'}
          </p>
          <p className="sm:col-span-2">
            Updated: {formatDateTime(composite.observedAt)}
          </p>
          {composite.blockers.length > 0 && (
            <p className="sm:col-span-2 text-[var(--theme-warning)]">
              Caution: {composite.blockers.join('; ')}.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-[var(--theme-muted)]">
          Refresh to summarize the latest stored research for this symbol.
        </p>
      )}
    </section>
  )
}

/** Background refresh cadence for the whole trading payload. This is a live
 * automated-trading dashboard (5/15-min engine cycles, guardian blocks,
 * position P&L) — mount-only load left it showing frozen state until the user
 * happened to click something. Kept conservative because /api/finance is a
 * heavy response, and paused entirely while the tab is hidden. */
