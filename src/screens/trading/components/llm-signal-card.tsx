import { useCallback, useEffect, useState } from 'react'
import { MiniStat } from './mini-stat'

interface LlmSignalConfig {
  enabled: boolean
  symbols: Array<string>
  quotePerTrade: number
  minConfidence: number
  maxOpenPositions: number
}
interface LlmPosition {
  id: string
  symbol: string
  entryPrice: number
  quantity: number
  entryQuote: number
  openedAt: string
  reasoning: string
}
interface LlmTrade {
  id: string
  symbol: string
  side: 'BUY' | 'SELL'
  price: number
  notionalQuote: number
  pnlQuote?: number
  reasoning: string
  createdAt: string
}
interface LlmResponse {
  ok: boolean
  config: LlmSignalConfig
  positions: Array<LlmPosition>
  trades: Array<LlmTrade>
  error?: string
}

export function LlmSignalCard() {
  const [data, setData] = useState<LlmResponse | null>(null)
  const [running, setRunning] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/demo-trading-llm', { cache: 'no-store' })
      if (res.ok) setData((await res.json()) as LlmResponse)
    } catch {
      /* transient */
    }
  }, [])

  useEffect(() => {
    void load()
    // Small fixed offset so this panel's poll is staggered relative to the
    // other trading panels (council/grid/rebalance each poll a different
    // endpoint every 30s; staggering spreads the resulting requests instead
    // of bursting them all at once).
    let id: number | undefined
    const offset = window.setTimeout(() => {
      id = window.setInterval(load, 30_000)
    }, 6_000)
    return () => {
      window.clearTimeout(offset)
      if (id !== undefined) window.clearInterval(id)
    }
  }, [load])

  const runCycle = useCallback(async () => {
    setRunning(true)
    setNote(null)
    try {
      const res = await fetch('/api/demo-trading-llm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'run_cycle' }),
      })
      const result = await res.json()
      if (!result.ok) setNote(result.error || 'Cycle failed')
      else if (!result.result?.ran)
        setNote(`Idle: ${result.result?.reason ?? 'not run'}`)
      else
        setNote(
          result.result?.trade
            ? `Trade: ${result.result.trade.side}`
            : 'Ran — no trade',
        )
      await load()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setRunning(false)
    }
  }, [load])

  const toggleEnabled = useCallback(async () => {
    if (!data?.config) return
    setToggling(true)
    setNote(null)
    try {
      const nextEnabled = !data.config.enabled
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'set_llm_config',
          config: { enabled: nextEnabled },
        }),
      })
      const result = await res.json()
      if (result.ok === false) setNote(result.error || 'Failed to update')
      await load()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setToggling(false)
    }
  }, [data, load])

  const config = data?.config
  const positions = data?.positions ?? []
  const trades = data?.trades ?? []

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--theme-text)]">
            LLM signal engine
          </h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Hourly LLM-driven decisions via free-tier OpenRouter routing (HARP).
            Every decision includes a plain-language reason below.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void toggleEnabled()}
            disabled={toggling || !config}
            className={`rounded-xl border px-4 py-2 text-sm font-medium disabled:opacity-50 ${
              config?.enabled
                ? 'border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_15%,transparent)] text-[var(--theme-danger)] hover:bg-[color-mix(in_srgb,var(--theme-danger)_25%,transparent)]'
                : 'border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-text)] hover:bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)]'
            }`}
          >
            {toggling ? 'Updating…' : config?.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            type="button"
            onClick={runCycle}
            disabled={running}
            className="rounded-xl border border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] px-4 py-2 text-sm font-medium text-[var(--theme-success)] hover:bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] disabled:opacity-50"
          >
            {running ? 'Running…' : 'Run one cycle'}
          </button>
        </div>
      </div>
      {note && <p className="mt-2 text-xs text-[var(--theme-muted)]">{note}</p>}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniStat
          label="Enabled"
          value={config ? (config.enabled ? 'yes' : 'no') : '—'}
        />
        <MiniStat
          label="Min confidence"
          value={config ? `${(config.minConfidence * 100).toFixed(0)}%` : '—'}
        />
        <MiniStat label="Open positions" value={String(positions.length)} />
        <MiniStat label="Trades logged" value={String(trades.length)} />
      </div>

      {positions.length > 0 && (
        <>
          <h3 className="mt-4 text-sm font-semibold text-[var(--theme-text)]">
            Open positions
          </h3>
          <div className="mt-2 space-y-2">
            {positions.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-[var(--theme-border)]/60 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-2.5 text-xs"
              >
                <div className="font-medium text-[var(--theme-text)]">
                  {p.symbol} · entry {p.entryPrice.toFixed(2)} · {p.quantity}{' '}
                  units
                </div>
                <div className="mt-1 text-[var(--theme-muted)]">
                  {p.reasoning}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 className="mt-4 text-sm font-semibold text-[var(--theme-text)]">
        Recent decisions
      </h3>
      <div className="mt-2 space-y-2">
        {trades.slice(0, 10).map((t) => (
          <div
            key={t.id}
            className="rounded-xl border border-[var(--theme-border)]/40 bg-[color-mix(in_srgb,var(--theme-text)_4%,transparent)] p-2.5 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className={`font-medium ${t.side === 'BUY' ? 'text-[var(--theme-success)]' : 'text-[var(--theme-danger)]'}`}
              >
                {t.symbol} {t.side}
              </span>
              {typeof t.pnlQuote === 'number' && (
                <span
                  className={`tabular-nums ${t.pnlQuote >= 0 ? 'text-[var(--theme-success)]' : 'text-[var(--theme-danger)]'}`}
                >
                  {t.pnlQuote >= 0 ? '+' : ''}
                  {t.pnlQuote.toFixed(2)} USDT
                </span>
              )}
            </div>
            <div className="mt-1 text-[var(--theme-muted)]">{t.reasoning}</div>
            <div className="mt-1 text-[10px] text-[var(--theme-muted)]/70">
              {new Date(t.createdAt).toLocaleString()}
            </div>
          </div>
        ))}
        {!trades.length && (
          <p className="text-xs text-[var(--theme-muted)]">
            No decisions logged yet.
          </p>
        )}
      </div>
    </section>
  )
}
