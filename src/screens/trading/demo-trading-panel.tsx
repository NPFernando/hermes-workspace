import { useCallback, useEffect, useState } from 'react'
import { MiniStat } from './components/mini-stat'
import { formatFractionPct, formatSignedAmount } from './format-helpers'

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
  avgWinQuote?: number
  avgLossQuote?: number
}
interface TradeLogEntry {
  id: string
  symbol: string
  strategyId: string
  pnlQuote: number
  reason: string
  closedAt: string
  executionMode?: 'paper' | 'testnet' | 'live' | 'shadow_paper'
}
interface OpenPosition {
  id: string
  symbol: string
  strategyId: string
  entryPrice: number
  entryQuote: number
  openedAt: string
  executionMode?: 'paper' | 'testnet' | 'live' | 'shadow_paper'
  /** Live display-only fields, populated when the monitor has a fresh price
   * for this symbol — undefined until then (e.g. right after server start). */
  currentPrice?: number
  breakEvenPrice?: number
  unrealizedPnlQuote?: number
  unrealizedPnlPct?: number
  /** True when "patient hold" (no-loss exit mode) is keeping this position
   * open at a loss this cycle instead of realizing a stop-out/exit. */
  holdingForRecovery?: boolean
}
interface GuardianBlock {
  symbol: string
  strategyId: string
  rule: string
  detail: string
  at: string
}
interface MonitorSymbol {
  symbol: string
  price: number
  signal: 'BUY' | 'SELL' | 'HOLD'
  net: number
  held: boolean
  unrealizedPnlQuote: number
}
interface LiveMonitor {
  clientAvailable: boolean
  quoteBalance: number
  deployedQuote: number
  openUnrealizedPnlQuote: number
  equityQuote: number
  monitoring: Array<MonitorSymbol>
}
interface EngineConfigView {
  symbols: Array<string>
  quotePerTrade: number
  stopLossPct: number
  takeProfitPct: number
  guardian: { maxOpenPositions: number }
  enabledStrategies: Array<string>
  kellySizingMinClosedTrades: number
  patternVetoMinSamples: number
}
interface RecoveryAnalytics {
  generatedAt: string
  sample: {
    closedTrades: number
    openPositions: number
    recoveredTrades: number
    forcedCloseTrades: number
  }
  closed: {
    recoveryRate: number | null
    averageHoldMinutes: number | null
    maxHoldMinutes: number | null
    capitalHours: number
    realizedPnlQuote: number
    realizedLossQuote: number
  }
  open: {
    underwaterCount: number
    underwaterQuote: number
    unrealizedPnlQuote: number
    averageHoldMinutes: number | null
    maxHoldMinutes: number | null
    capitalHours: number
    nearestBreakevenPct: number | null
  }
}
interface LearningFinding {
  severity: 'info' | 'warning' | 'critical'
  title: string
  detail: string
}
interface LearningReport {
  status:
    | 'insufficient_data'
    | 'degraded'
    | 'improving'
    | 'ready_for_testnet'
    | 'ready_for_manual_live_review'
  sample: {
    realClosedTrades: number
    shadowClosedTrades: number
    pairedShadowTrades: number
  }
  metrics: {
    recentPnlQuote: number
    shadowVsActualAvgSlippageQuote: number
    maxLossStreak: number
  }
  findings: Array<LearningFinding>
  recommendedAdjustments: {
    recommendedMode: 'paper_trade' | 'testnet_execute' | 'live_manual_approval'
    pauseLive: boolean
    maxQuotePerTrade: number
  }
}
interface MarketLearningSymbol {
  symbol: string
  status: 'tradeable' | 'caution' | 'insufficient_data' | 'stale' | 'blocked'
  candleCount: number
  volatilityPct: number
  trendPct: number
  maxDrawdownPct: number
  score: number
  blockers: Array<string>
  warnings: Array<string>
}
interface MarketLearningReport {
  overallStatus: MarketLearningSymbol['status']
  summary: {
    symbols: number
    caution: number
    insufficientData: number
    stale: number
    blocked: number
  }
  symbols: Array<MarketLearningSymbol>
}
interface MarketWarmupSymbol {
  symbol: string
  status: 'warmed' | 'skipped' | 'failed'
  candlesBefore: number
  candlesAfter: number
  fetchedCandles: number
  reason: string
}
interface MarketWarmupReport {
  targetCandles: number
  summary: {
    symbols: number
    warmed: number
    skipped: number
    failed: number
  }
  symbols: Array<MarketWarmupSymbol>
}
interface EngineState {
  ok: boolean
  scores: Array<StrategyScore>
  positions: Array<OpenPosition>
  trades: Array<TradeLogEntry>
  archivedPositions?: Array<OpenPosition>
  archivedTrades?: Array<TradeLogEntry>
  guardianBlocks: Array<GuardianBlock>
  dailyPnlQuote: number
  monitor?: LiveMonitor
  config?: EngineConfigView
  learning?: LearningReport
  marketLearning?: MarketLearningReport
  recoveryAnalytics?: RecoveryAnalytics
}
interface SettingsForm {
  tp: string
  sl: string
  size: string
  maxPos: string
  symbols: string
}

const money = formatSignedAmount
const usd = (n: number) => `${n.toFixed(2)}`

function sparkPoints(vals: Array<number>, w = 120, h = 28): string {
  if (vals.length < 2) return ''
  const min = Math.min(0, ...vals)
  const max = Math.max(0, ...vals)
  const range = max - min || 1
  return vals
    .map(
      (v, i) =>
        `${((i / (vals.length - 1)) * w).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`,
    )
    .join(' ')
}

export function DemoTradingPanel() {
  const [state, setState] = useState<EngineState | null>(null)
  const [running, setRunning] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [lastWarmup, setLastWarmup] = useState<MarketWarmupReport | null>(null)

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
    // Council/demo-trading is the baseline (no offset); grid/llm/rebalance
    // are staggered a few seconds apart from this one and each other so the
    // 4 independent endpoints don't all get hit in the same instant every
    // 30s.
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
      const warmup = (data.result?.marketWarmup ??
        null) as MarketWarmupReport | null
      setLastWarmup(warmup)
      const warmupNote = warmup
        ? ` · warmup ${warmup.summary.warmed} warmed, ${warmup.summary.skipped} ready, ${warmup.summary.failed} failed`
        : ''
      if (!data.ok) setNote(data.error || 'Cycle failed')
      else if (!data.result?.ran)
        setNote(`Idle: ${data.result?.reason ?? 'gated'}${warmupNote}`)
      else {
        const acts = data.result.actions || []
        const traded = acts.filter(
          (a: { action: string }) =>
            a.action === 'OPEN' || a.action === 'CLOSE',
        )
        setNote(
          traded.length
            ? `${traded.length} trade action(s) this cycle${warmupNote}`
            : `Ran — no trades (HOLD/blocked)${warmupNote}`,
        )
      }
      await load()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setRunning(false)
    }
  }, [load])

  const cfg = state?.config
  const [form, setForm] = useState<SettingsForm | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (cfg && form === null) {
      setForm({
        tp: (cfg.takeProfitPct * 100).toString(),
        sl: (cfg.stopLossPct * 100).toString(),
        size: cfg.quotePerTrade.toString(),
        maxPos: cfg.guardian.maxOpenPositions.toString(),
        symbols: cfg.symbols.join(', '),
      })
    }
  }, [cfg, form])

  const saveSettings = useCallback(async () => {
    if (!form) return
    setSaving(true)
    setNote(null)
    try {
      const config: Record<string, unknown> = {}
      const tp = parseFloat(form.tp)
      if (Number.isFinite(tp)) config.takeProfitPct = tp / 100
      const sl = parseFloat(form.sl)
      if (Number.isFinite(sl)) config.stopLossPct = sl / 100
      const size = parseFloat(form.size)
      if (Number.isFinite(size)) config.quotePerTrade = size
      const maxPos = parseInt(form.maxPos, 10)
      if (Number.isFinite(maxPos)) config.maxOpenPositions = maxPos
      const symbols = form.symbols
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
      if (symbols.length) config.symbols = symbols
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'set_engine_config', config }),
      })
      const data = await res.json()
      setNote(
        data.ok
          ? 'Engine settings saved — applies from the next cycle.'
          : data.error || 'Save failed',
      )
      await load()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [form, load])

  const scores = state?.scores ?? []
  const scoresWithHistory = scores.filter((s) => s.trades > 0 || s.score !== 0)
  const enabledStrategySet = new Set(cfg?.enabledStrategies ?? [])
  const currentStrategyScores = scoresWithHistory.filter((s) =>
    enabledStrategySet.has(s.strategyId),
  )
  const legacyStrategyScores = scoresWithHistory.filter(
    (s) => !enabledStrategySet.has(s.strategyId),
  )
  const minSamplesForFullSizing = Math.max(
    state?.config?.kellySizingMinClosedTrades ?? 0,
    state?.config?.patternVetoMinSamples ?? 0,
  )

  const monitor = state?.monitor
  const chrono = [...(state?.trades ?? [])].reverse() // trades arrive newest-first
  const cumulative = chrono.reduce<Array<number>>((arr, t) => {
    arr.push((arr.length ? arr[arr.length - 1] : 0) + t.pnlQuote)
    return arr
  }, [])
  const totalPnl = cumulative.length ? cumulative[cumulative.length - 1] : 0
  const n = chrono.length
  const winners = chrono.filter((t) => t.pnlQuote > 0).length
  const recentPnl = chrono
    .slice(-Math.min(5, n))
    .reduce((sum, t) => sum + t.pnlQuote, 0)
  const trend =
    n < 3
      ? 'unknown'
      : recentPnl > 0
        ? 'improving'
        : recentPnl < 0
          ? 'declining'
          : 'flat'
  const learning = state?.learning
  const learningStatus = learning?.status.replace(/_/g, ' ') ?? 'pending'
  const marketLearning = state?.marketLearning
  const marketLearningStatus =
    marketLearning?.overallStatus.replace(/_/g, ' ') ?? 'pending'
  const recovery = state?.recoveryAnalytics
  const durationLabel = (minutes: number | null | undefined) =>
    minutes == null
      ? '—'
      : minutes < 60
        ? `${minutes.toFixed(0)}m`
        : `${(minutes / 60).toFixed(1)}h`

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--theme-text)]">
            Binance execution engine
          </h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Council of strategies + guardian risk layer across paper trading,
            Binance sandbox/testnet, and explicitly gated live execution.
            Realized PnL today:{' '}
            <strong
              className={
                state && state.dailyPnlQuote >= 0
                  ? 'text-[var(--theme-success)]'
                  : 'text-[var(--theme-danger)]'
              }
            >
              {state ? money(state.dailyPnlQuote) : '—'} USDT
            </strong>
          </p>
        </div>
        <button
          type="button"
          onClick={runCycle}
          disabled={running}
          className="rounded-xl border border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] px-4 py-2 text-sm font-medium text-[var(--theme-success)] hover:bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] disabled:opacity-50"
        >
          {running ? 'Running…' : 'Run one cycle'}
        </button>
      </div>
      {note && <p className="mt-2 text-xs text-[var(--theme-muted)]">{note}</p>}

      {/* Account + exposure (live) */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniStat
          label="Available"
          value={`${monitor ? usd(monitor.quoteBalance) : '—'} USDT`}
        />
        <MiniStat
          label="Deployed"
          value={`${monitor ? usd(monitor.deployedQuote) : '—'} USDT`}
        />
        <MiniStat
          label="Open P/L"
          value={
            monitor ? `${money(monitor.openUnrealizedPnlQuote)} USDT` : '—'
          }
          tone={
            monitor && monitor.openUnrealizedPnlQuote < 0
              ? 'bad'
              : monitor && monitor.openUnrealizedPnlQuote > 0
                ? 'good'
                : 'neutral'
          }
        />
        <MiniStat
          label="Equity"
          value={`${monitor ? usd(monitor.equityQuote) : '—'} USDT`}
        />
      </div>

      {/* Currently monitoring */}
      <h3 className="mt-4 text-sm font-semibold text-[var(--theme-text)]">
        Currently monitoring
      </h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[30rem] text-left text-xs">
          <thead className="text-[var(--theme-muted)]">
            <tr>
              <th className="py-1 pr-2">Symbol</th>
              <th className="px-2">Price</th>
              <th className="px-2">Signal</th>
              <th className="px-2">Conviction</th>
              <th className="px-2">Position</th>
            </tr>
          </thead>
          <tbody>
            {(monitor?.monitoring ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} className="py-2 text-[var(--theme-muted)]">
                  {monitor && !monitor.clientAvailable
                    ? 'Testnet client unavailable.'
                    : 'Fetching market data…'}
                </td>
              </tr>
            ) : (
              monitor!.monitoring.map((m) => (
                <tr
                  key={m.symbol}
                  className="border-t border-[var(--theme-border)]/40"
                >
                  <td className="py-1 pr-2 font-medium">{m.symbol}</td>
                  <td className="px-2 tabular-nums">
                    {m.price > 0 ? m.price.toFixed(2) : '—'}
                  </td>
                  <td className="px-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        m.signal === 'BUY'
                          ? 'bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] text-[var(--theme-success)]'
                          : m.signal === 'SELL'
                            ? 'bg-[color-mix(in_srgb,var(--theme-danger)_15%,transparent)] text-[var(--theme-danger)]'
                            : 'bg-[var(--theme-border)]/30 text-[var(--theme-muted)]'
                      }`}
                    >
                      {m.signal}
                    </span>
                  </td>
                  <td className="px-2 tabular-nums text-[var(--theme-muted)]">
                    {m.net.toFixed(2)}
                  </td>
                  <td className="px-2 tabular-nums">
                    {m.held ? (
                      <span
                        className={
                          m.unrealizedPnlQuote >= 0
                            ? 'text-[var(--theme-success)]'
                            : 'text-[var(--theme-danger)]'
                        }
                      >
                        held {money(m.unrealizedPnlQuote)}
                      </span>
                    ) : (
                      <span className="text-[var(--theme-muted)]">flat</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Performance trend / improving? */}
      <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-[var(--theme-border)]/60 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--theme-muted)]">
            Cumulative P/L ({n} closed)
          </div>
          <div
            className={`text-lg font-semibold tabular-nums ${totalPnl >= 0 ? 'text-[var(--theme-success)]' : 'text-[var(--theme-danger)]'}`}
          >
            {money(totalPnl)} USDT
          </div>
        </div>
        {cumulative.length >= 2 && (
          <svg
            viewBox="0 0 120 28"
            className="h-7 w-[120px]"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polyline
              points={sparkPoints(cumulative)}
              fill="none"
              strokeWidth="1.5"
              className={
                totalPnl >= 0 ? 'stroke-[var(--theme-success)]' : 'stroke-[var(--theme-danger)]'
              }
            />
          </svg>
        )}
        <div className="text-sm">
          <span className="text-[var(--theme-muted)]">Trend: </span>
          {trend === 'unknown' ? (
            <span className="text-[var(--theme-muted)]">
              not enough trades yet
            </span>
          ) : trend === 'improving' ? (
            <span className="font-semibold text-[var(--theme-success)]">↑ improving</span>
          ) : trend === 'declining' ? (
            <span className="font-semibold text-[var(--theme-danger)]">↓ declining</span>
          ) : (
            <span className="font-semibold text-[var(--theme-warning)]">→ flat</span>
          )}
          {n >= 1 && (
            <span className="ml-2 text-xs text-[var(--theme-muted)]">
              ({winners}/{n} winners)
            </span>
          )}
        </div>
      </div>

      {learning && (
        <div className="mt-4 rounded-xl border border-[var(--theme-border)]/60 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--theme-muted)]">
                Decision validation
              </div>
              <div className="text-sm font-semibold capitalize text-[var(--theme-text)]">
                {learningStatus}
              </div>
            </div>
            <div className="text-right text-xs text-[var(--theme-muted)]">
              Next:{' '}
              <strong className="text-[var(--theme-text)]">
                {learning.recommendedAdjustments.recommendedMode}
              </strong>
              {' · '}
              cap{' '}
              <strong className="text-[var(--theme-text)]">
                {learning.recommendedAdjustments.maxQuotePerTrade.toFixed(2)}{' '}
                USDT
              </strong>
              {' · '}
              live{' '}
              <strong
                className={
                  learning.recommendedAdjustments.pauseLive
                    ? 'text-[var(--theme-warning)]'
                    : 'text-[var(--theme-success)]'
                }
              >
                {learning.recommendedAdjustments.pauseLive
                  ? 'paused'
                  : 'review'}
              </strong>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <MiniStat
              label="Closed"
              value={`${learning.sample.realClosedTrades}`}
            />
            <MiniStat
              label="Shadow pairs"
              value={`${learning.sample.pairedShadowTrades}`}
            />
            <MiniStat
              label="Recent P/L"
              value={`${money(learning.metrics.recentPnlQuote)} USDT`}
              tone={
                learning.metrics.recentPnlQuote < 0
                  ? 'bad'
                  : learning.metrics.recentPnlQuote > 0
                    ? 'good'
                    : 'neutral'
              }
            />
          </div>
          {learning.findings.length > 0 && (
            <div className="mt-2 space-y-1">
              {learning.findings.slice(0, 3).map((finding) => (
                <div
                  key={`${finding.severity}-${finding.title}`}
                  className={`rounded-lg border p-2 text-xs ${
                    finding.severity === 'critical'
                      ? 'border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] text-[var(--theme-danger)]'
                      : finding.severity === 'warning'
                        ? 'border-[color-mix(in_srgb,var(--theme-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] text-[var(--theme-warning)]'
                        : 'border-[var(--theme-border)]/50 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-muted)]'
                  }`}
                >
                  <strong>{finding.title}</strong> · {finding.detail}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {marketLearning && (
        <div className="mt-4 rounded-xl border border-[var(--theme-border)]/60 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--theme-muted)]">
                Market quality
              </div>
              <div className="text-sm font-semibold capitalize text-[var(--theme-text)]">
                {marketLearningStatus}
              </div>
            </div>
            <div className="text-right text-xs text-[var(--theme-muted)]">
              Blocked{' '}
              <strong className="text-[var(--theme-text)]">
                {marketLearning.summary.blocked +
                  marketLearning.summary.stale +
                  marketLearning.summary.insufficientData}
              </strong>
              {' · '}
              Caution{' '}
              <strong className="text-[var(--theme-text)]">
                {marketLearning.summary.caution}
              </strong>
            </div>
          </div>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {marketLearning.symbols.slice(0, 4).map((symbol) => {
              const blocked =
                symbol.status === 'blocked' ||
                symbol.status === 'stale' ||
                symbol.status === 'insufficient_data'
              return (
                <div
                  key={symbol.symbol}
                  className="rounded-lg border border-[var(--theme-border)]/50 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-[var(--theme-text)]">
                      {symbol.symbol}
                    </strong>
                    <span
                      className={
                        blocked
                          ? 'text-[var(--theme-danger)]'
                          : symbol.status === 'caution'
                            ? 'text-[var(--theme-warning)]'
                            : 'text-[var(--theme-success)]'
                      }
                    >
                      {symbol.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="mt-1 grid grid-cols-4 gap-1 text-[var(--theme-muted)]">
                    <span>{symbol.candleCount} bars</span>
                    <span>vol {symbol.volatilityPct.toFixed(2)}%</span>
                    <span>trend {symbol.trendPct.toFixed(1)}%</span>
                    <span>dd {symbol.maxDrawdownPct.toFixed(1)}%</span>
                  </div>
                  {(symbol.blockers[0] || symbol.warnings[0]) && (
                    <div
                      className={
                        blocked ? 'mt-1 text-[var(--theme-danger)]' : 'mt-1 text-[var(--theme-warning)]'
                      }
                    >
                      {symbol.blockers[0] ?? symbol.warnings[0]}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {lastWarmup && (
            <div className="mt-3 rounded-lg border border-[var(--theme-border)]/50 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[var(--theme-muted)]">
                <span>
                  Last warmup target {lastWarmup.targetCandles} bars ·{' '}
                  {lastWarmup.summary.warmed} warmed ·{' '}
                  {lastWarmup.summary.skipped} ready ·{' '}
                  {lastWarmup.summary.failed} failed
                </span>
              </div>
              <div className="mt-2 grid gap-1 sm:grid-cols-2">
                {lastWarmup.symbols.slice(0, 4).map((symbol) => (
                  <div
                    key={`${symbol.symbol}-${symbol.status}`}
                    className="flex items-center justify-between gap-2 rounded border border-[var(--theme-border)]/40 px-2 py-1"
                  >
                    <span className="font-medium text-[var(--theme-text)]">
                      {symbol.symbol}
                    </span>
                    <span
                      className={
                        symbol.status === 'failed'
                          ? 'text-[var(--theme-danger)]'
                          : symbol.status === 'warmed'
                            ? 'text-[var(--theme-success)]'
                            : 'text-[var(--theme-muted)]'
                      }
                    >
                      {symbol.status} {symbol.candlesBefore}→
                      {symbol.candlesAfter}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {recovery && (
        <section className="mt-4 rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">Sandbox recovery outcomes</h3>
              <p className="mt-1 text-xs text-[var(--theme-muted)]">
                Realized and open-position evidence for the current execution
                mode. Open positions never count as recovered until closed.
              </p>
            </div>
            <span className="text-[10px] text-[var(--theme-muted)]">
              {recovery.sample.closedTrades} closed ·{' '}
              {recovery.sample.openPositions} open
            </span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <MiniStat
              label="Recovery rate"
              value={
                recovery.closed.recoveryRate == null
                  ? 'Insufficient data'
                  : formatFractionPct(recovery.closed.recoveryRate)
              }
            />
            <MiniStat
              label="Realized P&L"
              value={`${money(recovery.closed.realizedPnlQuote)} USDT`}
            />
            <MiniStat
              label="Avg hold"
              value={durationLabel(recovery.closed.averageHoldMinutes)}
            />
            <MiniStat
              label="Capital-hours"
              value={`${recovery.closed.capitalHours.toFixed(1)}h`}
            />
            <MiniStat
              label="Underwater now"
              value={`${recovery.open.underwaterCount} · ${money(recovery.open.unrealizedPnlQuote)} USDT`}
            />
            <MiniStat
              label="Capital at risk"
              value={`${recovery.open.underwaterQuote.toFixed(2)} USDT`}
            />
            <MiniStat
              label="Open avg hold"
              value={durationLabel(recovery.open.averageHoldMinutes)}
            />
            <MiniStat
              label="Forced closes"
              value={`${recovery.sample.forcedCloseTrades}`}
            />
          </div>
          <p className="mt-2 text-[10px] text-[var(--theme-muted)]">
            Sample: {recovery.sample.recoveredTrades} recovered outcomes ·{' '}
            {recovery.sample.forcedCloseTrades} forced closes · max closed hold{' '}
            {durationLabel(recovery.closed.maxHoldMinutes)} · last calculated{' '}
            {new Date(recovery.generatedAt).toLocaleTimeString()}
          </p>
        </section>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--theme-text)]">
            Strategy scoreboard
          </h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Active strategies (currently voting/trading) shown first. Sample
            size below the engine's Kelly-sizing/pattern-veto thresholds (
            {minSamplesForFullSizing || 'n/a'} trades) is flagged — those
            rows still trade at full size until enough data comes in.
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-xs">
              <thead className="text-[var(--theme-muted)]">
                <tr>
                  <th className="py-1 pr-2">Strategy</th>
                  <th className="px-2">Trades</th>
                  <th className="px-2">Win%</th>
                  <th className="px-2">Score</th>
                  <th className="px-2">Avg win</th>
                  <th className="px-2">Avg loss</th>
                  <th className="px-2">PnL</th>
                </tr>
              </thead>
              <tbody>
                {currentStrategyScores.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-2 text-[var(--theme-muted)]">
                      No trades yet — scores build as the engine runs.
                    </td>
                  </tr>
                ) : (
                  currentStrategyScores
                    .sort((a, b) => b.score - a.score)
                    .map((s) => (
                      <tr
                        key={s.strategyId}
                        className="border-t border-[var(--theme-border)]/40"
                      >
                        <td className="py-1 pr-2 font-medium">
                          {s.strategyId}
                          {s.cooldownUntil &&
                            new Date(s.cooldownUntil) > new Date() && (
                              <span className="ml-1 text-[10px] text-[var(--theme-warning)]">
                                cooldown
                              </span>
                            )}
                          {minSamplesForFullSizing > 0 &&
                            s.trades < minSamplesForFullSizing && (
                              <span
                                className="ml-1 rounded-full border border-[var(--theme-border)]/60 px-1.5 py-0.5 text-[10px] text-[var(--theme-muted)]"
                                title="Below the engine's Kelly-sizing/pattern-veto sample threshold — trades at full size until enough closed trades accumulate."
                              >
                                {s.trades}/{minSamplesForFullSizing} to full
                                sizing
                              </span>
                            )}
                        </td>
                        <td className="px-2 tabular-nums">{s.trades}</td>
                        <td className="px-2 tabular-nums">
                          {(s.winRate * 100).toFixed(0)}%
                        </td>
                        <td
                          className={`px-2 tabular-nums ${s.score >= 0 ? 'text-[var(--theme-success)]' : 'text-[var(--theme-danger)]'}`}
                        >
                          {s.score.toFixed(2)}
                        </td>
                        <td className="px-2 tabular-nums text-[var(--theme-success)]">
                          {s.avgWinQuote != null
                            ? money(Math.abs(s.avgWinQuote))
                            : '—'}
                        </td>
                        <td className="px-2 tabular-nums text-[var(--theme-danger)]">
                          {s.avgLossQuote != null
                            ? money(-Math.abs(s.avgLossQuote))
                            : '—'}
                        </td>
                        <td
                          className={`px-2 tabular-nums ${s.totalPnlQuote >= 0 ? 'text-[var(--theme-success)]' : 'text-[var(--theme-danger)]'}`}
                        >
                          {money(s.totalPnlQuote)}
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>

          {legacyStrategyScores.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-semibold text-[var(--theme-muted)]">
                Legacy / disabled strategies (history only) —{' '}
                {legacyStrategyScores.length}
              </summary>
              <p className="mt-1 text-xs text-[var(--theme-muted)]">
                No longer in the active strategy mix — kept here for
                reference only, not currently voting or trading.
              </p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[32rem] text-left text-xs opacity-70">
                  <thead className="text-[var(--theme-muted)]">
                    <tr>
                      <th className="py-1 pr-2">Strategy</th>
                      <th className="px-2">Trades</th>
                      <th className="px-2">Win%</th>
                      <th className="px-2">Avg win</th>
                      <th className="px-2">Avg loss</th>
                      <th className="px-2">PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {legacyStrategyScores
                      .sort((a, b) => b.trades - a.trades)
                      .map((s) => (
                        <tr
                          key={s.strategyId}
                          className="border-t border-[var(--theme-border)]/40"
                        >
                          <td className="py-1 pr-2 font-medium">
                            {s.strategyId}
                          </td>
                          <td className="px-2 tabular-nums">{s.trades}</td>
                          <td className="px-2 tabular-nums">
                            {(s.winRate * 100).toFixed(0)}%
                          </td>
                          <td className="px-2 tabular-nums text-[var(--theme-success)]">
                            {s.avgWinQuote != null
                              ? money(Math.abs(s.avgWinQuote))
                              : '—'}
                          </td>
                          <td className="px-2 tabular-nums text-[var(--theme-danger)]">
                            {s.avgLossQuote != null
                              ? money(-Math.abs(s.avgLossQuote))
                              : '—'}
                          </td>
                          <td
                            className={`px-2 tabular-nums ${s.totalPnlQuote >= 0 ? 'text-[var(--theme-success)]' : 'text-[var(--theme-danger)]'}`}
                          >
                            {money(s.totalPnlQuote)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <h3 className="mt-4 text-sm font-semibold text-[var(--theme-text)]">
            Open positions ({state?.positions.length ?? 0})
          </h3>
          {(() => {
            const recovering = (state?.positions ?? []).filter(
              (p) => p.holdingForRecovery,
            )
            if (recovering.length === 0) return null
            const totalUnrealized = recovering.reduce(
              (sum, p) => sum + (p.unrealizedPnlQuote ?? 0),
              0,
            )
            return (
              <p className="mt-1 text-xs text-[color-mix(in_srgb,var(--theme-warning)_90%,transparent)]">
                ⏳ {recovering.length} position
                {recovering.length === 1 ? '' : 's'} held for recovery · total
                unrealized {money(totalUnrealized)} USDT · engine will keep
                trying for breakeven or better instead of cutting a loss.
              </p>
            )
          })()}
          <div className="mt-2 space-y-1">
            {(state?.positions ?? []).length === 0 ? (
              <p className="text-xs text-[var(--theme-muted)]">Flat.</p>
            ) : (
              state!.positions.map((p) => {
                const hasLive =
                  p.currentPrice != null && p.currentPrice > 0
                const pnlTone = !hasLive
                  ? 'text-[var(--theme-muted)]'
                  : p.holdingForRecovery
                    ? 'text-[color-mix(in_srgb,var(--theme-warning)_90%,transparent)]'
                    : (p.unrealizedPnlQuote ?? 0) >= 0
                      ? 'text-[var(--theme-success)]'
                      : 'text-[var(--theme-danger)]'
                return (
                  <div
                    key={p.id}
                    className="rounded-lg border border-[var(--theme-border)]/50 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-2">
                      <span>
                        {p.symbol} · {p.strategyId} ·{' '}
                        {p.executionMode ?? 'testnet'} · entry{' '}
                        {p.entryPrice.toFixed(2)} · {p.entryQuote.toFixed(2)}{' '}
                        USDT
                      </span>
                      {p.holdingForRecovery && (
                        <span className="rounded-full border border-[color-mix(in_srgb,var(--theme-warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[color-mix(in_srgb,var(--theme-warning)_90%,transparent)]">
                          ⏳ patient hold — researching recovery
                        </span>
                      )}
                    </div>
                    {hasLive && (
                      <div
                        className={`mt-1 flex flex-wrap items-center gap-x-2 tabular-nums ${pnlTone}`}
                      >
                        <span>current {p.currentPrice!.toFixed(2)}</span>
                        <span className="opacity-30">·</span>
                        <span>
                          {money(p.unrealizedPnlQuote ?? 0)} USDT (
                          {formatFractionPct(p.unrealizedPnlPct ?? 0)})
                        </span>
                        <span className="opacity-30">·</span>
                        <span>
                          breakeven {p.breakEvenPrice?.toFixed(2) ?? '?'}
                        </span>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-[var(--theme-text)]">
            Recent trades
          </h3>
          <div className="mt-2 space-y-1">
            {(state?.trades ?? []).length === 0 ? (
              <p className="text-xs text-[var(--theme-muted)]">
                No closed trades yet.
              </p>
            ) : (
              state!.trades.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-lg border border-[var(--theme-border)]/50 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-2 text-xs"
                >
                  <span>
                    {t.symbol} · {t.strategyId}
                  </span>
                  <span
                    className={
                      t.pnlQuote >= 0 ? 'text-[var(--theme-success)]' : 'text-[var(--theme-danger)]'
                    }
                  >
                    {money(t.pnlQuote)} USDT
                  </span>
                </div>
              ))
            )}
          </div>

          {(state?.guardianBlocks ?? []).length > 0 && (
            <>
              <h3 className="mt-4 text-sm font-semibold text-[var(--theme-text)]">
                Guardian blocks
              </h3>
              <div className="mt-2 space-y-1">
                {state!.guardianBlocks.slice(0, 5).map((b, i) => (
                  <div
                    key={`${b.at}-${i}`}
                    className="rounded-lg border border-[color-mix(in_srgb,var(--theme-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_5%,transparent)] p-2 text-xs text-[color-mix(in_srgb,var(--theme-warning)_90%,transparent)]"
                  >
                    <strong>{b.rule}</strong> · {b.symbol}: {b.detail}
                  </div>
                ))}
              </div>
            </>
          )}

          {(((state?.archivedPositions?.length ?? 0) > 0) ||
            ((state?.archivedTrades?.length ?? 0) > 0)) && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--theme-muted)]">
                Archived history — other mode (
                {state?.archivedPositions?.length ?? 0} position
                {(state?.archivedPositions?.length ?? 0) === 1 ? '' : 's'},{' '}
                {state?.archivedTrades?.length ?? 0} trade
                {(state?.archivedTrades?.length ?? 0) === 1 ? '' : 's'})
              </summary>
              <p className="mt-1 text-xs text-[var(--theme-muted)]">
                Left over from a previous paper/testnet/live mode. Excluded
                from the current totals above so they don't skew today's
                numbers — kept here only for reference, nothing here is
                touched or closed automatically.
              </p>
              <div className="mt-2 space-y-1">
                {(state?.archivedPositions ?? []).map((p) => (
                  <div
                    key={p.id}
                    className="rounded-lg border border-[var(--theme-border)]/50 bg-[color-mix(in_srgb,var(--theme-text)_5%,transparent)] p-2 text-xs opacity-70"
                  >
                    {p.symbol} · {p.strategyId} · {p.executionMode ?? '?'} ·
                    entry {p.entryPrice.toFixed(2)} · {p.entryQuote.toFixed(2)}{' '}
                    USDT · opened {new Date(p.openedAt).toLocaleDateString()}
                    {p.currentPrice != null && p.currentPrice > 0 && (
                      <>
                        {' '}
                        · current {p.currentPrice.toFixed(2)} ·{' '}
                        {money(p.unrealizedPnlQuote ?? 0)} USDT (
                        {formatFractionPct(p.unrealizedPnlPct ?? 0)})
                      </>
                    )}
                  </div>
                ))}
                {(state?.archivedTrades ?? []).map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between rounded-lg border border-[var(--theme-border)]/50 bg-[color-mix(in_srgb,var(--theme-text)_5%,transparent)] p-2 text-xs opacity-70"
                  >
                    <span>
                      {t.symbol} · {t.strategyId} · {t.executionMode ?? '?'}
                    </span>
                    <span>{money(t.pnlQuote)} USDT</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>

      {cfg && form && (
        <div className="mt-5 border-t border-[var(--theme-border)]/50 pt-4">
          <h3 className="text-sm font-semibold text-[var(--theme-text)]">
            Engine settings
          </h3>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-xs text-[var(--theme-muted)]">
              Take-profit %
              <input
                type="number"
                step="0.1"
                value={form.tp}
                onChange={(e) => setForm({ ...form, tp: e.target.value })}
                className="mt-1 w-full rounded-lg border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] px-2 py-1 text-sm tabular-nums text-[var(--theme-text)]"
              />
            </label>
            <label className="text-xs text-[var(--theme-muted)]">
              Stop-loss %
              <input
                type="number"
                step="0.1"
                value={form.sl}
                onChange={(e) => setForm({ ...form, sl: e.target.value })}
                className="mt-1 w-full rounded-lg border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] px-2 py-1 text-sm tabular-nums text-[var(--theme-text)]"
              />
            </label>
            <label className="text-xs text-[var(--theme-muted)]">
              Trade size (USDT)
              <input
                type="number"
                step="1"
                value={form.size}
                onChange={(e) => setForm({ ...form, size: e.target.value })}
                className="mt-1 w-full rounded-lg border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] px-2 py-1 text-sm tabular-nums text-[var(--theme-text)]"
              />
            </label>
            <label className="text-xs text-[var(--theme-muted)]">
              Max positions
              <input
                type="number"
                step="1"
                value={form.maxPos}
                onChange={(e) => setForm({ ...form, maxPos: e.target.value })}
                className="mt-1 w-full rounded-lg border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] px-2 py-1 text-sm tabular-nums text-[var(--theme-text)]"
              />
            </label>
            <label className="col-span-2 text-xs text-[var(--theme-muted)] sm:col-span-4">
              Watchlist (comma-separated, e.g. BTCUSDT, ETHUSDT)
              <input
                value={form.symbols}
                onChange={(e) => setForm({ ...form, symbols: e.target.value })}
                className="mt-1 w-full rounded-lg border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] px-2 py-1 text-sm text-[var(--theme-text)]"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={saveSettings}
            disabled={saving}
            className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] px-4 py-2 text-sm font-medium text-[var(--theme-success)] hover:bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save settings'}
          </button>
          <p className="mt-1 text-[10px] text-[var(--theme-muted)]">
            Applies from the next cycle. Live Binance orders are additionally
            capped by the finance live cap; trade size is USDT per buy.
          </p>
        </div>
      )}
    </section>
  )
}
