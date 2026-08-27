import { useState } from 'react'
import { ConfirmDialog } from '../../../components/confirm-dialog'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { formatLkr } from '../utils'
import type { PersonalFinancePayload } from '../types'

const inputClass =
  'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs text-[var(--theme-text)] outline-none'
const buttonClass =
  'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] hover:bg-black/20 disabled:opacity-40'

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

function numberField(row: Record<string, unknown>, key: string): number {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function optionalNumberField(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
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
  const { run: post, busy, error: err, setError: setErr } = useFinanceAction<PersonalFinancePayload>(onPayload)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [manualPriceDrafts, setManualPriceDrafts] = useState<Record<string, string>>({})
  const [refreshFailedIds, setRefreshFailedIds] = useState<Record<string, boolean>>({})

  const [symbol, setSymbol] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [platform, setPlatform] = useState('')
  const [quantity, setQuantity] = useState('')
  const [buyPrice, setBuyPrice] = useState('')
  const [buyDate, setBuyDate] = useState(new Date().toISOString().slice(0, 10))
  const [currency, setCurrency] = useState('LKR')

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
      const data = (await res.json()) as { ok?: boolean; priceFetchFailed?: boolean; error?: string }
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
        payload: { lastKnownPrice: price, lastPriceUpdatedAt: new Date().toISOString(), priceSource: 'manual' },
      },
      `manual-price-${id}`,
    )
    if (data) {
      setRefreshFailedIds((prev) => ({ ...prev, [id]: false }))
      setManualPriceDrafts((prev) => ({ ...prev, [id]: '' }))
    }
  }

  async function deleteHolding(id: string) {
    const data = await post({ action: 'delete_record', kind: 'stock_holding', id }, `delete-${id}`)
    if (data) setConfirmDeleteId(null)
  }

  const holdings = payload.data.stock_holdings

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold">Stock holdings (Sri Lanka / CSE)</h2>
      <p className="text-xs text-[var(--theme-muted)]">
        Enter what you bought through your broker app. Current price is fetched from CSE when you click Refresh —
        if that fails, you can type it in manually.
      </p>

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
        <input type="date" value={buyDate} onChange={(e) => setBuyDate(e.target.value)} className={inputClass} />
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
          <option value="LKR">LKR</option>
          <option value="USD">USD</option>
        </select>
        <button type="button" disabled={busy === 'holding'} onClick={() => void submitHolding()} className={buttonClass}>
          {busy === 'holding' ? 'Saving…' : 'Add holding'}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}

      <div className="mt-4 grid gap-2">
        {holdings.length === 0 && <p className="text-sm text-[var(--theme-muted)]">No stock holdings added yet.</p>}
        {holdings.map((holding, index) => {
          const id = stringField(holding, 'id') || String(index)
          const qty = numberField(holding, 'quantity')
          const buy = numberField(holding, 'buyPrice')
          const current = optionalNumberField(holding, 'lastKnownPrice')
          const gainLoss = current !== undefined ? (current - buy) * qty : undefined
          const priceSource = stringField(holding, 'priceSource')
          return (
            <div key={id} className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-[var(--theme-text)]">{stringField(holding, 'symbol')}</span>{' '}
                  <span className="text-xs text-[var(--theme-muted)]">
                    · {stringField(holding, 'platform')} · qty {qty} · buy {formatLkr(buy)}
                    {current !== undefined && ` · current ${formatLkr(current)} (${priceSource})`}
                  </span>
                  {gainLoss !== undefined && (
                    <span className={`ml-2 text-xs font-medium ${gainLoss >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {gainLoss >= 0 ? '+' : ''}
                      {formatLkr(gainLoss)}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void refreshPrice(id)}
                    className={buttonClass}
                  >
                    Refresh price
                  </button>
                  <button
                    type="button"
                    disabled={busy === `delete-${id}`}
                    onClick={() => setConfirmDeleteId(id)}
                    className="rounded-xl border border-red-400/30 bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-100 hover:bg-red-500/25 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {refreshFailedIds[id] && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <p className="text-xs text-amber-200">
                    Automatic price fetch failed — enter the current price manually:
                  </p>
                  <input
                    type="number"
                    placeholder="Current price"
                    value={manualPriceDrafts[id] ?? ''}
                    onChange={(e) => setManualPriceDrafts((prev) => ({ ...prev, [id]: e.target.value }))}
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
