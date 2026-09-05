import { useCallback, useEffect, useState } from 'react'
import { MiniStat } from './mini-stat'

interface RebalanceConfig {
  enabled: boolean
  symbols: Array<string>
  targetWeights?: Record<string, number>
  driftThresholdPct: number
  minRebalanceIntervalMinutes: number
}
interface RebalanceState {
  lastRebalanceAt: string | null
}
interface RebalanceTrade {
  id: string
  symbol: string
  side: 'BUY' | 'SELL'
  notionalQuote: number
  createdAt: string
}
interface RebalancePlanItem {
  symbol: string
  actualWeight: number
  targetWeight: number
  actualValueQuote: number
  targetValueQuote: number
  diffQuote: number
}
interface RebalanceResponse {
  ok: boolean
  config: RebalanceConfig
  state: RebalanceState | null
  trades: Array<RebalanceTrade>
  error?: string
}

export function RebalanceCard() {
  const [data, setData] = useState<RebalanceResponse | null>(null)
  const [plan, setPlan] = useState<Array<RebalancePlanItem> | null>(null)
  const [running, setRunning] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/demo-trading-rebalance', {
        cache: 'no-store',
      })
      if (res.ok) setData((await res.json()) as RebalanceResponse)
    } catch {
      /* transient */
    }
  }, [])

  useEffect(() => {
    void load()
    // Small fixed offset so this panel's poll is staggered relative to the
    // other trading panels (council/grid/llm each poll a different endpoint
    // every 30s; staggering spreads the resulting requests instead of
    // bursting them all at once).
    let id: number | undefined
    const offset = window.setTimeout(() => {
      id = window.setInterval(load, 30_000)
    }, 9_000)
    return () => {
      window.clearTimeout(offset)
      if (id !== undefined) window.clearInterval(id)
    }
  }, [load])

  const runCycle = useCallback(async () => {
    setRunning(true)
    setNote(null)
    try {
      const res = await fetch('/api/demo-trading-rebalance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'run_cycle' }),
      })
      const result = await res.json()
      if (!result.ok) setNote(result.error || 'Cycle failed')
      else if (!result.result?.ran)
        setNote(`Idle: ${result.result?.reason ?? 'not run'}`)
      else {
        const count = result.result.trades?.length ?? 0
        setNote(
          count
            ? `${count} rebalance trade(s) this cycle`
            : 'Ran — no trades needed',
        )
      }
      if (result.result?.plan)
        setPlan(result.result.plan as Array<RebalancePlanItem>)
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
          action: 'set_rebalance_config',
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
  const state = data?.state
  const trades = data?.trades ?? []

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--theme-text)]">
            Rebalance engine
          </h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Portfolio-level drift rebalancer — buys underweight / sells
            overweight symbols against a target allocation. Not a directional
            strategy, so it has no P&L concept of its own.
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
            onClick={() => void runCycle()}
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
          label="Drift threshold"
          value={config ? `${config.driftThresholdPct.toFixed(1)}%` : '—'}
        />
        <MiniStat
          label="Last rebalanced"
          value={
            state?.lastRebalanceAt
              ? new Date(state.lastRebalanceAt).toLocaleString()
              : 'never'
          }
        />
        <MiniStat label="Trades logged" value={String(trades.length)} />
      </div>

      <h3 className="mt-4 text-sm font-semibold text-[var(--theme-text)]">
        Per-asset drift {plan ? '' : '(run a cycle to see the latest snapshot)'}
      </h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-[var(--theme-muted)]">
              <th className="pb-1 pr-4 font-medium">Symbol</th>
              <th className="pb-1 pr-4 font-medium">Actual weight</th>
              <th className="pb-1 pr-4 font-medium">Target weight</th>
              <th className="pb-1 font-medium">Diff</th>
            </tr>
          </thead>
          <tbody>
            {(plan ?? []).map((p) => (
              <tr
                key={p.symbol}
                className="border-t border-[var(--theme-border)]/40"
              >
                <td className="py-1.5 pr-4 text-[var(--theme-text)]">
                  {p.symbol}
                </td>
                <td className="py-1.5 pr-4 tabular-nums text-[var(--theme-text)]">
                  {(p.actualWeight * 100).toFixed(1)}%
                </td>
                <td className="py-1.5 pr-4 tabular-nums text-[var(--theme-text)]">
                  {(p.targetWeight * 100).toFixed(1)}%
                </td>
                <td
                  className={`py-1.5 tabular-nums ${
                    p.diffQuote >= 0 ? 'text-[var(--theme-success)]' : 'text-[var(--theme-danger)]'
                  }`}
                >
                  {p.diffQuote >= 0 ? '+' : ''}
                  {p.diffQuote.toFixed(2)} USDT
                </td>
              </tr>
            ))}
            {!plan?.length && (
              <tr>
                <td colSpan={4} className="py-2 text-[var(--theme-muted)]">
                  No drift snapshot yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h3 className="mt-4 text-sm font-semibold text-[var(--theme-text)]">
        Recent trades
      </h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-[var(--theme-muted)]">
              <th className="pb-1 pr-4 font-medium">Symbol</th>
              <th className="pb-1 pr-4 font-medium">Side</th>
              <th className="pb-1 pr-4 font-medium">Notional</th>
              <th className="pb-1 font-medium">At</th>
            </tr>
          </thead>
          <tbody>
            {trades.slice(0, 10).map((t) => (
              <tr
                key={t.id}
                className="border-t border-[var(--theme-border)]/40"
              >
                <td className="py-1.5 pr-4 text-[var(--theme-text)]">
                  {t.symbol}
                </td>
                <td
                  className={`py-1.5 pr-4 ${t.side === 'BUY' ? 'text-[var(--theme-success)]' : 'text-[var(--theme-danger)]'}`}
                >
                  {t.side}
                </td>
                <td className="py-1.5 pr-4 tabular-nums text-[var(--theme-text)]">
                  {t.notionalQuote.toFixed(2)} USDT
                </td>
                <td className="py-1.5 text-[var(--theme-muted)]">
                  {new Date(t.createdAt).toLocaleString()}
                </td>
              </tr>
            ))}
            {!trades.length && (
              <tr>
                <td colSpan={4} className="py-2 text-[var(--theme-muted)]">
                  No rebalance trades yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
