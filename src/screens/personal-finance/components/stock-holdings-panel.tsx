import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ConfirmDialog } from '../../../components/confirm-dialog'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { formatDateOnly, formatMoney, formatPct } from '../utils'
import { buttonClass, confirmButtonClass, dangerButtonClass, inputClass } from '../shared-styles'
import { numberField, optionalNumberField, stringField } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

function daysSince(dateStr: string | undefined): number | null {
  if (!dateStr) return null
  const then = Date.parse(dateStr)
  if (!Number.isFinite(then)) return null
  return Math.max(0, Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000)))
}

export type StockAllocationRow = {
  currency: string
  symbol: string
  companyName: string
  value: number
  cost: number
  percent: number
  usesBuyPriceFallback: boolean
}

export type StockConcentrationAlert = {
  level: 'warning' | 'critical'
  currency: string
  symbol: string
  percent: number
  detail: string
}

export function buildStockConcentrationAlerts(
  allocation: Array<StockAllocationRow>,
  warningThreshold = 50,
  criticalThreshold = 75,
): Array<StockConcentrationAlert> {
  return allocation
    .filter((row) => row.percent >= warningThreshold)
    .map((row) => ({
      level:
        row.percent >= criticalThreshold ? ('critical' as const) : ('warning' as const),
      currency: row.currency,
      symbol: row.symbol,
      percent: row.percent,
      detail:
        `${row.symbol} is ${row.percent.toFixed(1)}% of the ${row.currency} stock portfolio. ` +
        (row.percent >= criticalThreshold
          ? 'Review concentration before adding more exposure.'
          : 'Consider whether this concentration matches your plan.'),
    }))
    .sort((a, b) => b.percent - a.percent)
}

type DividendDraft = {
  date: string
  amount: string
  exchangeRate: string
  notes: string
}

interface CseMarketSnapshot {
  capturedAt: string
  tradeDate: string | null
  aspi: number | null
  aspiChange: number | null
  sp20: number | null
  sp20Change: number | null
  marketTurnover: number | null
  shareVolume: number | null
  trades: number | null
  marketCap: number | null
  source: 'cse_unofficial'
}

/**
 * Builds a currency-separated allocation view. Cross-currency percentages are
 * intentionally not calculated because the finance model has no authoritative
 * FX conversion source.
 */
export function buildStockAllocation(
  holdings: Array<Record<string, unknown>>,
): Array<StockAllocationRow> {
  const grouped = new Map<
    string,
    Omit<StockAllocationRow, 'percent'>
  >()

  for (const holding of holdings) {
    const quantity = numberField(holding, 'quantity')
    if (quantity <= 0) continue
    const buyPrice = numberField(holding, 'buyPrice')
    const currentPrice = optionalNumberField(holding, 'lastKnownPrice')
    const price = currentPrice ?? buyPrice
    if (price <= 0) continue
    const currency = stringField(holding, 'currency') || 'LKR'
    const symbol = stringField(holding, 'symbol').trim().toUpperCase() || 'Unknown'
    const key = `${currency}:${symbol}`
    const existing = grouped.get(key)
    const value = quantity * price
    const cost = quantity * buyPrice
    if (existing) {
      existing.value += value
      existing.cost += cost
      existing.usesBuyPriceFallback ||= currentPrice === undefined
    } else {
      grouped.set(key, {
        currency,
        symbol,
        companyName: stringField(holding, 'companyName'),
        value,
        cost,
        usesBuyPriceFallback: currentPrice === undefined,
      })
    }
  }

  const totals = new Map<string, number>()
  for (const row of grouped.values()) {
    totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.value)
  }

  return Array.from(grouped.values())
    .map((row) => ({
      ...row,
      percent: (row.value / (totals.get(row.currency) || 1)) * 100,
    }))
    .sort((a, b) =>
      a.currency === b.currency
        ? b.value - a.value
        : a.currency.localeCompare(b.currency),
    )
}

/**
 * Sri Lanka / CSE stock holdings — buy price is always known, current price
 * comes from the unofficial CSE endpoint (refresh_stock_price action) with
 * a manual-entry fallback when that fails, per the plan's decision.
 */
export function StockHoldingsPanel({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (p: PersonalFinancePayload) => void
}) {
  const {
    run: post,
    busy,
    error: err,
    setError: setErr,
  } = useFinanceAction<PersonalFinancePayload>(onPayload)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [manualPriceDrafts, setManualPriceDrafts] = useState<
    Record<string, string>
  >({})
  const [refreshFailedIds, setRefreshFailedIds] = useState<
    Record<string, boolean>
  >({})
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [refreshingMarket, setRefreshingMarket] = useState(false)
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null)
  const [dividendOpenId, setDividendOpenId] = useState<string | null>(null)
  const [attachingHoldingId, setAttachingHoldingId] = useState<string | null>(null)
  const [dividendDrafts, setDividendDrafts] = useState<
    Record<string, DividendDraft>
  >({})
  const [editOpenId, setEditOpenId] = useState<string | null>(null)
  const [editDrafts, setEditDrafts] = useState<
    Record<
      string,
      {
        symbol: string
        companyName: string
        platform: string
        quantity: string
        buyPrice: string
        buyDate: string
        currency: string
        notes: string
      }
    >
  >({})

  const [symbol, setSymbol] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [platform, setPlatform] = useState('')
  const [quantity, setQuantity] = useState('')
  const [buyPrice, setBuyPrice] = useState('')
  const [buyDate, setBuyDate] = useState(new Date().toISOString().slice(0, 10))
  const [currency, setCurrency] = useState('LKR')
  const [notes, setNotes] = useState('')

  const marketQuery = useQuery({
    queryKey: ['cse-market-snapshots'],
    queryFn: async () => {
      const response = await fetch('/api/cse-market', {
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return (await response.json()) as {
        ok: boolean
        latest: CseMarketSnapshot | null
        history: Array<CseMarketSnapshot>
      }
    },
    staleTime: 60_000,
  })

  async function refreshMarket() {
    setRefreshingMarket(true)
    try {
      await fetch('/api/cse-market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      await marketQuery.refetch()
    } finally {
      setRefreshingMarket(false)
    }
  }

  async function submitHolding() {
    if (!symbol.trim() || !platform.trim()) {
      setErr('Symbol and platform are required')
      return
    }
    const data = await post(
      {
        action: 'add_record',
        kind: 'stock_holding',
        payload: {
          symbol: symbol.trim().toUpperCase(),
          companyName: companyName.trim() || undefined,
          platform: platform.trim(),
          quantity: Number(quantity) || 0,
          buyPrice: Number(buyPrice) || 0,
          buyDate,
          currency,
          notes: notes.trim() || undefined,
        },
      },
      'holding',
    )
    if (data) {
      setSymbol('')
      setCompanyName('')
      setPlatform('')
      setQuantity('')
      setBuyPrice('')
      setNotes('')
    }
  }

  async function refreshPrice(id: string) {
    setRefreshFailedIds((prev) => ({ ...prev, [id]: false }))
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'refresh_stock_price', id }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        priceFetchFailed?: boolean
        error?: string
      }
      if (data.ok === false) {
        setErr(data.error || 'Price refresh failed')
        return
      }
      if (data.priceFetchFailed) {
        setRefreshFailedIds((prev) => ({ ...prev, [id]: true }))
      }
      onPayload(data as PersonalFinancePayload)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Price refresh failed')
    }
  }

  async function submitManualPrice(id: string) {
    const price = Number(manualPriceDrafts[id])
    if (!Number.isFinite(price) || price <= 0) {
      setErr('Enter a valid manual price')
      return
    }
    const data = await post(
      {
        action: 'update_record',
        kind: 'stock_holding',
        id,
        payload: {
          lastKnownPrice: price,
          lastPriceUpdatedAt: new Date().toISOString(),
          priceSource: 'manual',
        },
      },
      `manual-price-${id}`,
    )
    if (data) {
      setRefreshFailedIds((prev) => ({ ...prev, [id]: false }))
      setManualPriceDrafts((prev) => ({ ...prev, [id]: '' }))
    }
  }

  function openDividendForm(holding: Record<string, unknown>) {
    const id = stringField(holding, 'id')
    const holdingCurrency = stringField(holding, 'currency') || 'LKR'
    setDividendDrafts((prev) => ({
      ...prev,
      [id]: prev[id] ?? {
        date: new Date().toISOString().slice(0, 10),
        amount: '',
        exchangeRate: holdingCurrency === 'LKR' ? '1' : '',
        notes: '',
      },
    }))
    setDividendOpenId(id)
  }

  async function recordDividend(holding: Record<string, unknown>) {
    const id = stringField(holding, 'id')
    const draft = dividendDrafts[id]
    const amount = Number(draft.amount)
    const exchangeRate = Number(draft.exchangeRate)
    if (!draft.date || !Number.isFinite(amount) || amount <= 0) {
      setErr('Enter a valid dividend amount and date')
      return
    }
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      setErr('Enter a valid exchange rate to LKR')
      return
    }
    const holdingSymbol = stringField(holding, 'symbol') || 'Stock holding'
    const holdingCompanyName = stringField(holding, 'companyName')
    const data = await post(
      {
        action: 'add_record',
        kind: 'income',
        payload: {
          dateReceived: draft.date,
          sourceName: holdingCompanyName || holdingSymbol,
          incomeType: 'Dividend income',
          incomeSubtype: 'dividend',
          stockHoldingId: id,
          originalCurrency: stringField(holding, 'currency') || 'LKR',
          originalAmount: amount,
          exchangeRateUsed: exchangeRate,
          convertedLkrAmount: amount * exchangeRate,
          taxable: true,
          notes: draft.notes.trim() || undefined,
          status: 'cleared',
        },
      },
      `dividend-${id}`,
    )
    if (data) {
      setDividendOpenId(null)
      setDividendDrafts((prev) => ({ ...prev, [id]: { ...prev[id], amount: '', notes: '' } }))
    }
  }

  async function deleteHolding(id: string) {
    const data = await post(
      { action: 'delete_record', kind: 'stock_holding', id },
      `delete-${id}`,
    )
    if (data) setConfirmDeleteId(null)
  }

  async function attachInvestmentDocument(id: string, file: File | undefined) {
    if (!file) return
    setAttachingHoldingId(id)
    setErr(null)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('documentType', 'investment_document')
      form.set('holdingId', id)
      const response = await fetch('/api/finance-upload', { method: 'POST', body: form })
      const data = (await response.json()) as { ok?: boolean; error?: string }
      if (!response.ok || !data.ok) {
        setErr(data.error || 'Could not attach investment document')
        return
      }
      setErr('Investment document linked securely.')
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Could not attach investment document')
    } finally {
      setAttachingHoldingId(null)
    }
  }

  function startEdit(holding: Record<string, unknown>) {
    const id = stringField(holding, 'id')
    setEditDrafts((prev) => ({
      ...prev,
      [id]: {
        symbol: stringField(holding, 'symbol'),
        companyName: stringField(holding, 'companyName'),
        platform: stringField(holding, 'platform'),
        quantity: String(numberField(holding, 'quantity')),
        buyPrice: String(numberField(holding, 'buyPrice')),
        buyDate: stringField(holding, 'buyDate'),
        currency: stringField(holding, 'currency') || 'LKR',
        notes: stringField(holding, 'notes'),
      },
    }))
    setEditOpenId(id)
  }

  function cancelEdit() {
    setEditOpenId(null)
  }

  async function saveEdit(id: string) {
    const draft = editDrafts[id]
    if (!draft.symbol.trim() || !draft.platform.trim()) {
      setErr('Symbol and platform are required')
      return
    }
    const data = await post(
      {
        action: 'update_record',
        kind: 'stock_holding',
        id,
        payload: {
          symbol: draft.symbol.trim().toUpperCase(),
          companyName: draft.companyName.trim() || undefined,
          platform: draft.platform.trim(),
          quantity: Number(draft.quantity) || 0,
          buyPrice: Number(draft.buyPrice) || 0,
          buyDate: draft.buyDate,
          currency: draft.currency,
          notes: draft.notes.trim() || undefined,
        },
      },
      `edit-${id}`,
    )
    if (data) setEditOpenId(null)
  }

  const holdings = payload.data.stock_holdings
  const allocation = buildStockAllocation(holdings)
  const allocationCurrencies = Array.from(
    new Set(allocation.map((row) => row.currency)),
  )
  const concentrationAlerts = buildStockConcentrationAlerts(allocation)

  // Sequential, not concurrent, to go easy on the unofficial CSE endpoint.
  async function refreshAll() {
    setRefreshingAll(true)
    try {
      for (const holding of holdings) {
        const id = stringField(holding, 'id')
        if (id) await refreshPrice(id)
      }
    } finally {
      setRefreshingAll(false)
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          Stock holdings (Sri Lanka / CSE)
        </h2>
        {holdings.length > 0 && (
          <button
            type="button"
            disabled={refreshingAll}
            onClick={() => void refreshAll()}
            className={buttonClass}
          >
            {refreshingAll ? 'Refreshing…' : 'Refresh all'}
          </button>
        )}
      </div>
      <p className="text-xs text-[var(--theme-muted)]">
        Enter what you bought through your broker app. Current price is fetched
        from CSE when you click Refresh — if that fails, you can type it in
        manually.
      </p>

      {payload.cseProviderHealth && (
        <div className="mt-3 rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_5%,transparent)] p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">CSE price provider</span>
            <span className="rounded-lg border border-[var(--theme-border)] px-2 py-0.5 capitalize">
              {payload.cseProviderHealth.status}
            </span>
          </div>
          <p className="mt-1 text-[var(--theme-muted)]">
            {payload.cseProviderHealth.cseQuoteCount}/{payload.cseProviderHealth.holdingsCount} holdings have CSE quotes
            {payload.cseProviderHealth.manualFallbackCount > 0
              ? ` · ${payload.cseProviderHealth.manualFallbackCount} manual fallback`
              : ''}
            {payload.cseProviderHealth.staleQuoteCount > 0
              ? ` · ${payload.cseProviderHealth.staleQuoteCount} stale`
              : ''}
            {payload.cseProviderHealth.latestQuoteAt
              ? ` · latest ${formatDateOnly(payload.cseProviderHealth.latestQuoteAt)}`
              : ''}
          </p>
          <p className="mt-1 text-[10px] text-[var(--theme-muted)]">
            Read-only stored provenance; use Refresh to request a new quote.
          </p>
        </div>
      )}

      <div className="mt-3 rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_5%,transparent)] p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">CSE market snapshot</span>
          <button
            type="button"
            disabled={refreshingMarket}
            onClick={() => void refreshMarket()}
            className={buttonClass}
          >
            {refreshingMarket ? 'Refreshing…' : 'Refresh market'}
          </button>
        </div>
        {marketQuery.data?.latest ? (
          <div className="mt-2 grid gap-1 text-[var(--theme-muted)] sm:grid-cols-2">
            <span>
              ASPI {marketQuery.data.latest.aspi?.toLocaleString() ?? '—'}
              {marketQuery.data.latest.aspiChange != null
                ? ` (${marketQuery.data.latest.aspiChange >= 0 ? '+' : ''}${marketQuery.data.latest.aspiChange})`
                : ''}
            </span>
            <span>
              S&amp;P SL20 {marketQuery.data.latest.sp20?.toLocaleString() ?? '—'}
              {marketQuery.data.latest.sp20Change != null
                ? ` (${marketQuery.data.latest.sp20Change >= 0 ? '+' : ''}${marketQuery.data.latest.sp20Change})`
                : ''}
            </span>
            <span>
              Turnover {marketQuery.data.latest.marketTurnover?.toLocaleString() ?? '—'}
            </span>
            <span>
              {marketQuery.data.latest.trades?.toLocaleString() ?? '—'} trades ·{' '}
              {marketQuery.data.latest.tradeDate
                ? formatDateOnly(marketQuery.data.latest.tradeDate)
                : formatDateOnly(marketQuery.data.latest.capturedAt)}
            </span>
          </div>
        ) : (
          <p className="mt-2 text-[var(--theme-muted)]">
            {marketQuery.isPending
              ? 'No stored market snapshot yet.'
              : 'No market snapshot available. Refresh when the CSE endpoint is reachable.'}
          </p>
        )}
        {marketQuery.data?.history.length ? (
          <p className="mt-1 text-[10px] text-[var(--theme-muted)]">
            {marketQuery.data.history.length} daily snapshot(s) stored locally · source: unofficial CSE endpoint
          </p>
        ) : null}
      </div>

      {allocation.length > 0 && (
        <div className="mt-4 rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_5%,transparent)] p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">Allocation by holding</h3>
            <span className="text-[11px] text-[var(--theme-muted)]">
              Percentages are calculated separately per currency
            </span>
          </div>
          {allocationCurrencies.map((allocationCurrency) => (
            <div key={allocationCurrency} className="mt-3">
              <p className="text-xs font-medium text-[var(--theme-muted)]">
                {allocationCurrency}
              </p>
              <div className="mt-1 grid gap-2">
                {allocation
                  .filter((row) => row.currency === allocationCurrency)
                  .map((row) => (
                    <div key={`${row.currency}:${row.symbol}`}>
                      <div className="flex flex-wrap justify-between gap-2 text-xs">
                        <span>
                          {row.symbol}
                          {row.companyName ? ` · ${row.companyName}` : ''}
                        </span>
                        <span className="text-[var(--theme-muted)]">
                          {formatMoney(row.value, row.currency)} · {formatPct(row.percent)}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--theme-border)]">
                        <div
                          className="h-full rounded-full bg-[var(--theme-accent)]"
                          style={{ width: `${Math.min(100, Math.max(0, row.percent))}%` }}
                        />
                      </div>
                      {row.usesBuyPriceFallback && (
                        <p className="mt-0.5 text-[10px] text-[var(--theme-warning)]">
                          Uses buy price until a current quote is available
                        </p>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ))}
          {concentrationAlerts.length > 0 && (
            <div className="mt-4 border-t border-[var(--theme-border)]/60 pt-3">
              <p className="text-xs font-medium">Concentration review</p>
              <div className="mt-1 grid gap-1">
                {concentrationAlerts.map((alert) => (
                  <p
                    key={`${alert.currency}:${alert.symbol}`}
                    className={`text-xs ${alert.level === 'critical' ? 'text-[var(--theme-danger)]' : 'text-[var(--theme-warning)]'}`}
                  >
                    {alert.detail}
                  </p>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-[var(--theme-muted)]">
                Advisory only; no trading action is taken automatically.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Symbol (e.g. JKH.N0000)"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className={inputClass}
        />
        <input
          type="text"
          placeholder="Company name (optional)"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          className={inputClass}
        />
        <input
          type="text"
          placeholder="Broker / platform"
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className={inputClass}
        />
        <input
          type="number"
          placeholder="Quantity"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className={`${inputClass} w-24`}
        />
        <input
          type="number"
          placeholder="Buy price"
          value={buyPrice}
          onChange={(e) => setBuyPrice(e.target.value)}
          className={`${inputClass} w-28`}
        />
        <input
          type="date"
          value={buyDate}
          onChange={(e) => setBuyDate(e.target.value)}
          className={inputClass}
        />
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className={inputClass}
        >
          <option value="LKR">LKR</option>
          <option value="USD">USD</option>
        </select>
        <input
          type="text"
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={inputClass}
        />
        <button
          type="button"
          disabled={busy === 'holding'}
          onClick={() => void submitHolding()}
          className={buttonClass}
        >
          {busy === 'holding' ? 'Saving…' : 'Add holding'}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-[var(--theme-danger)]">{err}</p>}

      <div className="mt-4 grid gap-2">
        {holdings.length === 0 && (
          <p className="text-sm text-[var(--theme-muted)]">
            No stock holdings added yet.
          </p>
        )}
        {holdings.map((holding, index) => {
          const id = stringField(holding, 'id') || String(index)
          const qty = numberField(holding, 'quantity')
          const buy = numberField(holding, 'buyPrice')
          const current = optionalNumberField(holding, 'lastKnownPrice')
          const gainLoss =
            current !== undefined ? (current - buy) * qty : undefined
          const gainLossPct =
            current !== undefined && buy > 0
              ? ((current - buy) / buy) * 100
              : undefined
          const holdingCurrency = stringField(holding, 'currency') || 'LKR'
          const priceSource = stringField(holding, 'priceSource')
          const dayHigh = optionalNumberField(holding, 'lastPriceHigh')
          const dayLow = optionalNumberField(holding, 'lastPriceLow')
          const dayVolume = optionalNumberField(holding, 'lastPriceVolume')
          const dayTurnover = optionalNumberField(holding, 'lastPriceTurnover')
          const priceHistory = Array.isArray(holding.priceHistory)
            ? holding.priceHistory.filter(
                (point): point is Record<string, unknown> =>
                  typeof point === 'object' && point !== null,
              )
            : []
          const recentHistory = priceHistory.slice(-5).reverse()
          const historyOpen = historyOpenId === id
          const dividendRecords = payload.data.income_records.filter(
            (record) =>
              stringField(record, 'stockHoldingId') === id &&
              stringField(record, 'incomeSubtype') === 'dividend',
          )
          const dividendOriginalTotal = dividendRecords.reduce(
            (sum, record) => sum + numberField(record, 'originalAmount'),
            0,
          )
          const dividendLkrTotal = dividendRecords.reduce(
            (sum, record) => sum + numberField(record, 'convertedLkrAmount'),
            0,
          )
          const dividendOpen = dividendOpenId === id
          const dividendDraft = dividendDrafts[id]
          const portfolioHistory = payload.netWorthSnapshots
            .map((snapshot) => {
              const position = snapshot.portfolioPositions?.find(
                (entry) => entry.holdingId === id,
              )
              return position
                ? { snapshotDate: snapshot.snapshotDate, ...position }
                : null
            })
            .filter(
              (position): position is NonNullable<typeof position> =>
                position !== null,
            )
            .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate))
          const firstPortfolioPoint = portfolioHistory[0]
          const latestPortfolioPoint = portfolioHistory.at(-1)
          const staleDays = daysSince(
            stringField(holding, 'lastPriceUpdatedAt') || undefined,
          )
          const isEditing = editOpenId === id
          return (
            <div
              key={id}
              className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3"
            >
              {isEditing ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    placeholder="Symbol"
                    value={editDrafts[id].symbol}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], symbol: e.target.value },
                      }))
                    }
                    className={inputClass}
                  />
                  <input
                    type="text"
                    placeholder="Company name (optional)"
                    value={editDrafts[id].companyName}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], companyName: e.target.value },
                      }))
                    }
                    className={inputClass}
                  />
                  <input
                    type="text"
                    placeholder="Broker / platform"
                    value={editDrafts[id].platform}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], platform: e.target.value },
                      }))
                    }
                    className={inputClass}
                  />
                  <input
                    type="number"
                    placeholder="Quantity"
                    value={editDrafts[id].quantity}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], quantity: e.target.value },
                      }))
                    }
                    className={`${inputClass} w-24`}
                  />
                  <input
                    type="number"
                    placeholder="Buy price"
                    value={editDrafts[id].buyPrice}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], buyPrice: e.target.value },
                      }))
                    }
                    className={`${inputClass} w-28`}
                  />
                  <input
                    type="date"
                    value={editDrafts[id].buyDate}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], buyDate: e.target.value },
                      }))
                    }
                    className={inputClass}
                  />
                  <select
                    value={editDrafts[id].currency}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], currency: e.target.value },
                      }))
                    }
                    className={inputClass}
                  >
                    <option value="LKR">LKR</option>
                    <option value="USD">USD</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Notes (optional)"
                    value={editDrafts[id].notes}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], notes: e.target.value },
                      }))
                    }
                    className={inputClass}
                  />
                  <button
                    type="button"
                    disabled={busy === `edit-${id}`}
                    onClick={() => void saveEdit(id)}
                    className={confirmButtonClass}
                  >
                    {busy === `edit-${id}` ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className={buttonClass}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium text-[var(--theme-text)]">
                      {stringField(holding, 'symbol')}
                    </span>{' '}
                    <span className="text-xs text-[var(--theme-muted)]">
                      · {stringField(holding, 'platform')} · qty {qty} · buy{' '}
                      {formatMoney(buy, holdingCurrency)}
                      {current !== undefined &&
                        ` · current ${formatMoney(current, holdingCurrency)} (${priceSource}${
                          staleDays !== null
                            ? `, priced ${staleDays === 0 ? 'today' : `${staleDays}d ago`}`
                            : ''
                        })`}
                    </span>
                    {gainLoss !== undefined && (
                      <span
                        className={`ml-2 text-xs font-medium ${gainLoss >= 0 ? 'text-[var(--theme-success)]' : 'text-[var(--theme-danger)]'}`}
                      >
                        {gainLoss >= 0 ? '+' : ''}
                        {formatMoney(gainLoss, holdingCurrency)}
                        {gainLossPct !== undefined &&
                          ` (${gainLoss >= 0 ? '+' : ''}${formatPct(gainLossPct)})`}
                      </span>
                    )}
                    {(dayHigh !== undefined || dayLow !== undefined || dayVolume !== undefined || dayTurnover !== undefined) && (
                      <p className="mt-1 text-[11px] text-[var(--theme-muted)]">
                        Daily quote stats:
                        {dayHigh !== undefined ? ` high ${formatMoney(dayHigh, holdingCurrency)}` : ''}
                        {dayLow !== undefined ? ` · low ${formatMoney(dayLow, holdingCurrency)}` : ''}
                        {dayVolume !== undefined ? ` · volume ${dayVolume.toLocaleString()}` : ''}
                        {dayTurnover !== undefined ? ` · turnover ${formatMoney(dayTurnover, holdingCurrency)}` : ''}
                      </p>
                    )}
                    {stringField(holding, 'notes') && (
                      <p className="mt-1 text-xs text-[var(--theme-muted)]">
                        {stringField(holding, 'notes')}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <label className={`${buttonClass} cursor-pointer`}>
                      {attachingHoldingId === id ? 'Linking…' : 'Attach document'}
                      <input
                        type="file"
                        accept="application/pdf,image/*"
                        className="sr-only"
                        disabled={attachingHoldingId !== null}
                        onChange={(event) => {
                          void attachInvestmentDocument(id, event.target.files?.[0])
                          event.currentTarget.value = ''
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void refreshPrice(id)}
                      className={buttonClass}
                    >
                      Refresh price
                    </button>
                    {priceHistory.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setHistoryOpenId(historyOpen ? null : id)
                        }
                        className={buttonClass}
                      >
                        {historyOpen
                          ? 'Hide history'
                          : `History (${priceHistory.length})`}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        dividendOpen ? setDividendOpenId(null) : openDividendForm(holding)
                      }
                      className={buttonClass}
                    >
                      {dividendOpen ? 'Hide dividend form' : 'Record dividend'}
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(holding)}
                      className={buttonClass}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busy === `delete-${id}`}
                      onClick={() => setConfirmDeleteId(id)}
                      className={dangerButtonClass}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
              {historyOpen && (
                <div className="mt-2 rounded-xl border border-[var(--theme-border)]/60 p-2">
                  <p className="text-[11px] font-medium text-[var(--theme-muted)]">
                    Recent price observations
                  </p>
                  <div className="mt-1 grid gap-1">
                    {recentHistory.map((point, pointIndex) => {
                      const observedAt = stringField(point, 'observedAt')
                      const observedPrice = optionalNumberField(point, 'price')
                      if (!observedAt || observedPrice === undefined) return null
                      const source = stringField(point, 'source') || 'manual'
                      return (
                        <div
                          key={`${observedAt}-${pointIndex}`}
                          className="flex flex-wrap justify-between gap-2 text-[11px] text-[var(--theme-muted)]"
                        >
                          <span>{new Date(observedAt).toLocaleString()}</span>
                          <span>
                            {formatMoney(observedPrice, holdingCurrency)} · {source}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  {priceHistory.length > recentHistory.length && (
                    <p className="mt-1 text-[10px] text-[var(--theme-muted)]">
                      Showing the five most recent observations.
                    </p>
                  )}
                </div>
              )}
              {dividendRecords.length > 0 && (
                <p className="mt-2 text-xs text-[var(--theme-success)]">
                  Dividends: {formatMoney(dividendOriginalTotal, holdingCurrency)}
                  {' · '}
                  {formatMoney(dividendLkrTotal, 'LKR')} LKR ({dividendRecords.length}{' '}
                  record{dividendRecords.length === 1 ? '' : 's'})
                </p>
              )}
              {latestPortfolioPoint !== undefined && portfolioHistory.length >= 2 && (
                <p className="mt-2 text-xs text-[var(--theme-muted)]">
                  Portfolio snapshots: {portfolioHistory.length} · latest{' '}
                  {formatMoney(latestPortfolioPoint.marketValue, holdingCurrency)}{' '}
                  ({formatDateOnly(latestPortfolioPoint.snapshotDate)}) · change{' '}
                  <span
                    className={
                      latestPortfolioPoint.marketValue - firstPortfolioPoint.marketValue >= 0
                        ? 'text-[var(--theme-success)]'
                        : 'text-[var(--theme-danger)]'
                    }
                  >
                    {latestPortfolioPoint.marketValue - firstPortfolioPoint.marketValue >= 0
                      ? '+'
                      : ''}
                    {formatMoney(
                      latestPortfolioPoint.marketValue - firstPortfolioPoint.marketValue,
                      holdingCurrency,
                    )}
                  </span>
                </p>
              )}
              {dividendOpen && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--theme-border)]/60 p-2">
                  <input
                    type="date"
                    value={dividendDraft.date}
                    onChange={(event) =>
                      setDividendDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], date: event.target.value },
                      }))
                    }
                    className={inputClass}
                    aria-label="Dividend received date"
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder={`Amount (${holdingCurrency})`}
                    value={dividendDraft.amount}
                    onChange={(event) =>
                      setDividendDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], amount: event.target.value },
                      }))
                    }
                    className={`${inputClass} w-36`}
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Rate to LKR"
                    title="LKR received per unit of the dividend currency"
                    value={dividendDraft.exchangeRate}
                    onChange={(event) =>
                      setDividendDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], exchangeRate: event.target.value },
                      }))
                    }
                    className={`${inputClass} w-32`}
                  />
                  <input
                    type="text"
                    placeholder="Notes (optional)"
                    value={dividendDraft.notes}
                    onChange={(event) =>
                      setDividendDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], notes: event.target.value },
                      }))
                    }
                    className={inputClass}
                  />
                  <button
                    type="button"
                    disabled={busy === `dividend-${id}`}
                    onClick={() => void recordDividend(holding)}
                    className={confirmButtonClass}
                  >
                    {busy === `dividend-${id}` ? 'Saving…' : 'Save dividend'}
                  </button>
                </div>
              )}
              {refreshFailedIds[id] && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <p className="text-xs text-[var(--theme-warning)]">
                    Automatic price fetch failed — enter the current price
                    manually:
                  </p>
                  <input
                    type="number"
                    placeholder="Current price"
                    value={manualPriceDrafts[id] ?? ''}
                    onChange={(e) =>
                      setManualPriceDrafts((prev) => ({
                        ...prev,
                        [id]: e.target.value,
                      }))
                    }
                    className={`${inputClass} w-28`}
                  />
                  <button
                    type="button"
                    disabled={busy === `manual-price-${id}`}
                    onClick={() => void submitManualPrice(id)}
                    className={buttonClass}
                  >
                    Save price
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete this stock holding?"
          body="This can't be undone."
          confirmLabel="Delete"
          busy={busy === `delete-${confirmDeleteId}`}
          onConfirm={() => void deleteHolding(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </section>
  )
}
