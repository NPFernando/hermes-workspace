import { useState } from 'react'
import { ConfirmDialog } from '../../../components/confirm-dialog'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { formatMoney, formatPct } from '../utils'
import { buttonClass, inputClass } from '../shared-styles'
import { numberField, optionalNumberField, stringField } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

function daysSince(dateStr: string | undefined): number | null {
  if (!dateStr) return null
  const then = Date.parse(dateStr)
  if (!Number.isFinite(then)) return null
  return Math.max(0, Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000)))
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

  async function deleteHolding(id: string) {
    const data = await post(
      { action: 'delete_record', kind: 'stock_holding', id },
      `delete-${id}`,
    )
    if (data) setConfirmDeleteId(null)
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

      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}

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
                    className="rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
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
                        className={`ml-2 text-xs font-medium ${gainLoss >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                      >
                        {gainLoss >= 0 ? '+' : ''}
                        {formatMoney(gainLoss, holdingCurrency)}
                        {gainLossPct !== undefined &&
                          ` (${gainLoss >= 0 ? '+' : ''}${formatPct(gainLossPct)})`}
                      </span>
                    )}
                    {stringField(holding, 'notes') && (
                      <p className="mt-1 text-xs text-[var(--theme-muted)]">
                        {stringField(holding, 'notes')}
                      </p>
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
                      onClick={() => startEdit(holding)}
                      className={buttonClass}
                    >
                      Edit
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
              )}
              {refreshFailedIds[id] && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <p className="text-xs text-amber-200">
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
