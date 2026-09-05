import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatUsdt } from '../format-helpers'

export type LedgerEngine = 'council' | 'grid' | 'llm' | 'rebalance'
export type LedgerStatus = 'open' | 'closed'
export type LedgerSide = 'BUY' | 'SELL'

export interface LedgerRecord {
  id: string
  engine: LedgerEngine
  status: LedgerStatus
  symbol: string
  strategy: string | null
  executionMode: string | null
  side: LedgerSide | null
  openedAt: string | null
  closedAt: string | null
  quantity: number | null
  entryPrice: number | null
  exitPrice: number | null
  entryQuote: number | null
  exitQuote: number | null
  feesQuote: number | null
  realizedPnlQuote: number | null
  unrealizedPnlQuote: number | null
  sourceId: string
}

interface LedgerResponse {
  ok: boolean
  records: Array<LedgerRecord>
  total: number
  page: number
  pageSize: number
  hasMore: boolean
  asOf: string
  counts: Record<LedgerEngine, number>
  error?: string
}

const PAGE_SIZE = 25
const ENGINE_LABEL: Record<LedgerEngine, string> = {
  council: 'Council',
  grid: 'Grid',
  llm: 'LLM Signal',
  rebalance: 'Rebalance',
}

function fmtNum(value: number | null): string {
  return value === null ? '—' : value.toFixed(value < 1 ? 4 : 2)
}

function fmtDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—'
}

function fmtPnl(record: LedgerRecord): { text: string; tone: string } {
  const value = record.realizedPnlQuote ?? record.unrealizedPnlQuote
  if (value === null) return { text: '—', tone: 'text-[var(--theme-muted)]' }
  const label = record.realizedPnlQuote !== null ? '' : ' (unreal.)'
  return {
    text: `${formatUsdt(value)}${label}`,
    tone:
      value >= 0 ? 'text-[var(--theme-success)]' : 'text-[var(--theme-danger)]',
  }
}

/**
 * Combined holdings/history view over all four trading engines, backed by
 * the single neutral GET /api/trading/ledger endpoint (see
 * src/routes/api/trading/ledger.ts / src/server/trading-ledger.ts). This is
 * a browse-on-demand table, not a live dashboard tile — it only fetches
 * when the user changes a filter/page or presses Refresh, deliberately with
 * no setInterval poll loop. Every other panel on this screen already polls
 * its own engine endpoint every ~30s (staggered — see use-trading-summary.ts
 * and the individual panels' own comments); adding a second timer here just
 * to re-fetch a paginated table the user is actively reading would be
 * redundant load for no benefit, so this intentionally opts out of that
 * pattern instead of adding a 5th duplicate poller.
 */
export function TradingLedgerPanel() {
  const [engine, setEngine] = useState<LedgerEngine | ''>('')
  const [status, setStatus] = useState<LedgerStatus | ''>('')
  const [symbol, setSymbol] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<LedgerResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (engine) params.set('engine', engine)
    if (status) params.set('status', status)
    if (symbol.trim()) params.set('symbol', symbol.trim())
    params.set('page', String(page))
    params.set('pageSize', String(PAGE_SIZE))
    return params.toString()
  }, [engine, status, symbol, page])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/trading/ledger?${query}`, {
        cache: 'no-store',
      })
      const body = (await res.json()) as LedgerResponse
      if (!res.ok || !body.ok) {
        setError(body.error || `HTTP ${res.status}`)
        return
      }
      setData(body)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    void load()
  }, [load])

  // Any filter change should snap back to page 1 — staying on e.g. page 4
  // of a now much-shorter filtered result would just show an empty page.
  const updateFilter = useCallback((apply: () => void) => {
    apply()
    setPage(1)
  }, [])

  const csvHref = `/api/trading/ledger?${query}&format=csv`
  const counts = data?.counts

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--theme-text)]">
            Trading ledger — holdings &amp; history
          </h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Every engine&rsquo;s current holdings and complete trade history,
            normalized into one read-only view. Filters apply across council,
            grid, LLM signal, and rebalance records alike.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={csvHref}
            className="rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-4 py-2 text-sm font-medium text-[var(--theme-text)] hover:bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)]"
          >
            Export CSV (this page)
          </a>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-4 py-2 text-sm font-medium text-[var(--theme-text)] hover:bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <select
          value={engine}
          onChange={(e) =>
            updateFilter(() => setEngine(e.target.value as LedgerEngine | ''))
          }
          className="rounded-xl border border-[var(--theme-border)] bg-transparent px-3 py-1.5 text-xs text-[var(--theme-text)]"
        >
          <option value="">All engines</option>
          <option value="council">Council</option>
          <option value="grid">Grid</option>
          <option value="llm">LLM Signal</option>
          <option value="rebalance">Rebalance</option>
        </select>
        <select
          value={status}
          onChange={(e) =>
            updateFilter(() => setStatus(e.target.value as LedgerStatus | ''))
          }
          className="rounded-xl border border-[var(--theme-border)] bg-transparent px-3 py-1.5 text-xs text-[var(--theme-text)]"
        >
          <option value="">Open + closed</option>
          <option value="open">Open (current holdings)</option>
          <option value="closed">Closed (history)</option>
        </select>
        <input
          value={symbol}
          onChange={(e) => updateFilter(() => setSymbol(e.target.value))}
          placeholder="Symbol (e.g. BTCUSDT)"
          className="rounded-xl border border-[var(--theme-border)] bg-transparent px-3 py-1.5 text-xs text-[var(--theme-text)] placeholder:text-[var(--theme-muted)]"
        />
      </div>

      {counts && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--theme-muted)]">
          {(Object.keys(ENGINE_LABEL) as Array<LedgerEngine>).map((id) => (
            <span
              key={id}
              className="rounded-full border border-[var(--theme-border)]/60 px-2 py-0.5"
            >
              {ENGINE_LABEL[id]}: {counts[id]}
            </span>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-3 text-xs text-[var(--theme-danger)]">{error}</p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-[var(--theme-muted)]">
              <th className="pb-1 pr-4 font-medium">Engine</th>
              <th className="pb-1 pr-4 font-medium">Status</th>
              <th className="pb-1 pr-4 font-medium">Symbol</th>
              <th className="pb-1 pr-4 font-medium">Strategy</th>
              <th className="pb-1 pr-4 font-medium">Side</th>
              <th className="pb-1 pr-4 font-medium">Qty</th>
              <th className="pb-1 pr-4 font-medium">Entry</th>
              <th className="pb-1 pr-4 font-medium">Exit</th>
              <th className="pb-1 pr-4 font-medium">P&amp;L</th>
              <th className="pb-1 pr-4 font-medium">Opened</th>
              <th className="pb-1 font-medium">Closed</th>
            </tr>
          </thead>
          <tbody>
            {(data?.records ?? []).map((r) => {
              const pnl = fmtPnl(r)
              return (
                <tr
                  key={r.id}
                  className="border-t border-[var(--theme-border)]/40"
                >
                  <td className="py-1.5 pr-4 text-[var(--theme-text)]">
                    {ENGINE_LABEL[r.engine]}
                  </td>
                  <td className="py-1.5 pr-4 text-[var(--theme-text)]">
                    {r.status}
                  </td>
                  <td className="py-1.5 pr-4 text-[var(--theme-text)]">
                    {r.symbol}
                  </td>
                  <td className="py-1.5 pr-4 text-[var(--theme-muted)]">
                    {r.strategy ?? '—'}
                  </td>
                  <td
                    className={`py-1.5 pr-4 ${
                      r.side === 'SELL'
                        ? 'text-[var(--theme-danger)]'
                        : 'text-[var(--theme-success)]'
                    }`}
                  >
                    {r.side ?? '—'}
                  </td>
                  <td className="py-1.5 pr-4 tabular-nums text-[var(--theme-text)]">
                    {fmtNum(r.quantity)}
                  </td>
                  <td className="py-1.5 pr-4 tabular-nums text-[var(--theme-text)]">
                    {fmtNum(r.entryPrice)}
                  </td>
                  <td className="py-1.5 pr-4 tabular-nums text-[var(--theme-text)]">
                    {fmtNum(r.exitPrice)}
                  </td>
                  <td className={`py-1.5 pr-4 tabular-nums ${pnl.tone}`}>
                    {pnl.text}
                  </td>
                  <td className="py-1.5 pr-4 text-[var(--theme-muted)]">
                    {fmtDate(r.openedAt)}
                  </td>
                  <td className="py-1.5 text-[var(--theme-muted)]">
                    {fmtDate(r.closedAt)}
                  </td>
                </tr>
              )
            })}
            {!loading && !data?.records.length && (
              <tr>
                <td colSpan={11} className="py-2 text-[var(--theme-muted)]">
                  No ledger records match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--theme-muted)]">
        <span>
          {data
            ? `Page ${data.page} · ${data.records.length} of ${data.total} record(s) · as of ${new Date(data.asOf).toLocaleTimeString()}`
            : ' '}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={loading || page <= 1}
            className="rounded-lg border border-[var(--theme-border)] px-3 py-1 disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={loading || !data?.hasMore}
            className="rounded-lg border border-[var(--theme-border)] px-3 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </section>
  )
}
