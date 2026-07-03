import { useCallback, useEffect, useState } from 'react'

interface StrategyScore {
  strategyId: string
  trades: number
  wins: number
  losses: number
  score: number
  winRate: number
  avgPnlQuote: number
  totalPnlQuote: number
  lossStreak: number
  cooldownUntil?: string | null
}
interface TradeLogEntry {
  id: string
  symbol: string
  strategyId: string
  pnlQuote: number
  reason: string
  closedAt: string
}
interface OpenPosition {
  id: string
  symbol: string
  strategyId: string
  entryPrice: number
  entryQuote: number
}
interface GuardianBlock {
  symbol: string
  strategyId: string
  rule: string
  detail: string
  at: string
}
interface EngineState {
  ok: boolean
  scores: Array<StrategyScore>
  positions: Array<OpenPosition>
  trades: Array<TradeLogEntry>
  guardianBlocks: Array<GuardianBlock>
  dailyPnlQuote: number
}

const money = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`

export function DemoTradingPanel() {
  const [state, setState] = useState<EngineState | null>(null)
  const [running, setRunning] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/demo-trading', { cache: 'no-store' })
      if (res.ok) setState((await res.json()) as EngineState)
    } catch {
      /* transient */
    }
  }, [])

  useEffect(() => {
    void load()
    const id = window.setInterval(load, 30_000)
    return () => window.clearInterval(id)
  }, [load])

  const runCycle = useCallback(async () => {
    setRunning(true)
    setNote(null)
    try {
      const res = await fetch('/api/demo-trading', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'run_cycle' }),
      })
      const data = await res.json()
      if (!data.ok) setNote(data.error || 'Cycle failed')
      else if (!data.result?.ran) setNote(`Idle: ${data.result?.reason ?? 'gated'}`)
      else {
        const acts = data.result.actions || []
        const traded = acts.filter((a: { action: string }) => a.action === 'OPEN' || a.action === 'CLOSE')
        setNote(traded.length ? `${traded.length} trade action(s) this cycle` : 'Ran — no trades (HOLD/blocked)')
      }
      await load()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setRunning(false)
    }
  }, [load])

  const scores = state?.scores ?? []
  const activeScores = scores.filter((s) => s.trades > 0 || (s.score ?? 0) !== 0)

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--theme-text)]">Demo trading engine</h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Council of strategies + guardian risk layer, demo account only. Realized PnL today:{' '}
            <strong className={state && state.dailyPnlQuote >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              {state ? money(state.dailyPnlQuote) : '—'} USDT
            </strong>
          </p>
        </div>
        <button
          type="button"
          onClick={runCycle}
          disabled={running}
          className="rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
        >
          {running ? 'Running…' : 'Run one cycle'}
        </button>
      </div>
      {note && <p className="mt-2 text-xs text-[var(--theme-muted)]">{note}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--theme-text)]">Strategy scoreboard</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[26rem] text-left text-xs">
              <thead className="text-[var(--theme-muted)]">
                <tr>
                  <th className="py-1 pr-2">Strategy</th>
                  <th className="px-2">Trades</th>
                  <th className="px-2">Win%</th>
                  <th className="px-2">Score</th>
                  <th className="px-2">PnL</th>
                </tr>
              </thead>
              <tbody>
                {activeScores.length === 0 ? (
                  <tr><td colSpan={5} className="py-2 text-[var(--theme-muted)]">No trades yet — scores build as the engine runs.</td></tr>
                ) : (
                  activeScores
                    .sort((a, b) => b.score - a.score)
                    .map((s) => (
                      <tr key={s.strategyId} className="border-t border-[var(--theme-border)]/40">
                        <td className="py-1 pr-2 font-medium">
                          {s.strategyId}
                          {s.cooldownUntil && new Date(s.cooldownUntil) > new Date() && (
                            <span className="ml-1 text-[10px] text-amber-400">cooldown</span>
                          )}
                        </td>
                        <td className="px-2 tabular-nums">{s.trades}</td>
                        <td className="px-2 tabular-nums">{(s.winRate * 100).toFixed(0)}%</td>
                        <td className={`px-2 tabular-nums ${s.score >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{s.score.toFixed(2)}</td>
                        <td className={`px-2 tabular-nums ${s.totalPnlQuote >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{money(s.totalPnlQuote)}</td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>

          <h3 className="mt-4 text-sm font-semibold text-[var(--theme-text)]">Open positions ({state?.positions.length ?? 0})</h3>
          <div className="mt-2 space-y-1">
            {(state?.positions ?? []).length === 0 ? (
              <p className="text-xs text-[var(--theme-muted)]">Flat.</p>
            ) : (
              state!.positions.map((p) => (
                <div key={p.id} className="rounded-lg border border-[var(--theme-border)]/50 bg-black/10 p-2 text-xs">
                  {p.symbol} · {p.strategyId} · entry {p.entryPrice.toFixed(2)} · {p.entryQuote.toFixed(2)} USDT
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-[var(--theme-text)]">Recent trades</h3>
          <div className="mt-2 space-y-1">
            {(state?.trades ?? []).length === 0 ? (
              <p className="text-xs text-[var(--theme-muted)]">No closed trades yet.</p>
            ) : (
              state!.trades.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-lg border border-[var(--theme-border)]/50 bg-black/10 p-2 text-xs">
                  <span>{t.symbol} · {t.strategyId}</span>
                  <span className={t.pnlQuote >= 0 ? 'text-emerald-400' : 'text-red-400'}>{money(t.pnlQuote)} USDT</span>
                </div>
              ))
            )}
          </div>

          {(state?.guardianBlocks ?? []).length > 0 && (
            <>
              <h3 className="mt-4 text-sm font-semibold text-[var(--theme-text)]">Guardian blocks</h3>
              <div className="mt-2 space-y-1">
                {state!.guardianBlocks.slice(0, 5).map((b, i) => (
                  <div key={`${b.at}-${i}`} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-200/90">
                    <strong>{b.rule}</strong> · {b.symbol}: {b.detail}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
