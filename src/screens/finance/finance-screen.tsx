import { useEffect, useMemo, useState } from 'react'
import { DemoTradingPanel } from './demo-trading-panel'

type FinancePayload = {
  ok: boolean
  checkedAt: number
  paths: Record<string, string>
  security: Record<string, boolean>
  connectors: Record<string, Record<string, boolean>>
  summary: {
    totalIncomeLkr: number
    totalExpensesLkr: number
    netSavingsLkr: number
    savingsRate: number
    cashBalanceLkr: number
    taxReserveLkr: number
    debtLkr: number
    netWorthLkr: number
    accountCount: number
    goalCount: number
    taxRecordCount: number
    openPlans: number
    blockedPlans: number
    tradingMode: string
    liveTradingEnabled: boolean
    emergencyKillSwitch: boolean
  }
  alerts: Array<{ level: 'info' | 'warning' | 'critical'; title: string; detail: string }>
  settings: Record<string, unknown>
  data: {
    finance_accounts: Array<Record<string, unknown>>
    income_records: Array<Record<string, unknown>>
    expense_records: Array<Record<string, unknown>>
    savings_goals: Array<Record<string, unknown>>
    tax_records: Array<Record<string, unknown>>
    trading_plans: Array<Record<string, unknown>>
    assets: Array<Record<string, unknown>>
    market_prices: Array<Record<string, unknown>>
    news_items: Array<Record<string, unknown>>
    risk_scores: Array<Record<string, unknown>>
  }
}

const modules = [
  'Accounts, income, expenses, transfers, liabilities',
  'Budgets, cash-flow, recurring bills, low-balance alerts',
  'Savings goals, tax reserve, monthly progress tracking',
  'Tax records with LKR conversion and confirmation flags',
  'Binance market observation + testnet pathway',
  'IBKR symbol/contract verification + paper pathway',
  'News, sentiment, risk scoring, decision logging',
  'Paper/testnet/live approval modes with emergency stop',
]

const phases = [
  'Phase 1: finance records and secure local database — active',
  'Phase 2: Binance/IBKR market observation — connector guardrails ready',
  'Phase 3: news and risk engine — data model ready',
  'Phase 4: paper trading — plan/audit store ready',
  'Phase 5+: testnet/live modes — blocked until explicit approval',
]

function formatLkr(value: number): string {
  return `LKR ${Math.round(value).toLocaleString('en-LK')}`
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`
}

function textValue(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (value == null || value === '') return '—'
  if (typeof value === 'number') return value.toLocaleString('en-LK')
  return String(value)
}

function StatCard({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'good' | 'warn' | 'danger' }) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-200 border-emerald-400/25 bg-emerald-500/10'
      : tone === 'warn'
        ? 'text-amber-200 border-amber-400/25 bg-amber-500/10'
        : tone === 'danger'
          ? 'text-red-200 border-red-400/25 bg-red-500/10'
          : 'text-[var(--theme-text)] border-[var(--theme-border)] bg-[var(--theme-panel)]/70'
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneClass}`}>
      <div className="text-xs uppercase tracking-[0.22em] text-[var(--theme-muted)]">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  )
}

function DataTable({ title, rows, columns }: { title: string; rows: Array<Record<string, unknown>>; columns: Array<string> }) {
  return (
    <section className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[var(--theme-text)]">{title}</h2>
        <span className="rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-xs text-[var(--theme-muted)]">{rows.length} records</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--theme-muted)]">No records yet. Add records through /api/finance or future forms; the database is initialized and ready.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.18em] text-[var(--theme-muted)]">
              <tr>{columns.map((column) => <th key={column} className="border-b border-[var(--theme-border)] py-2 pr-4">{column}</th>)}</tr>
            </thead>
            <tbody>
              {rows.slice(-8).map((row, index) => (
                <tr key={String(row.id ?? index)} className="text-[var(--theme-text)]">
                  {columns.map((column) => <td key={column} className="border-b border-[var(--theme-border)]/60 py-2 pr-4">{textValue(row, column)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

const SELECTABLE_MODES: Array<{ id: string; label: string; hint: string }> = [
  { id: 'observe_only', label: 'Observe only', hint: 'No trading — market data only' },
  { id: 'paper_trade', label: 'Paper trade', hint: 'Simulated; no orders placed' },
  { id: 'testnet_execute', label: 'Testnet execute', hint: 'Fake-money orders on Binance testnet' },
]

function TradingControls({ summary, onPayload }: { summary: FinancePayload['summary']; onPayload: (p: FinancePayload) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function post(body: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey)
    setErr(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as FinancePayload & { error?: string }
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
      onPayload(data)
    } catch (nextError) {
      setErr(nextError instanceof Error ? nextError.message : 'Request failed')
    } finally {
      setBusy(null)
    }
  }

  const cutoffOn = summary.emergencyKillSwitch

  function disarmCutoff() {
    const confirmed = window.confirm(
      'Disarm the emergency safety cutoff?\n\nThis lets the engine place orders (fake-money on Binance testnet while in testnet_execute mode). ' +
        'Only do this deliberately — you can re-arm it at any time.',
    )
    if (!confirmed) return
    void post({ action: 'set_kill_switch', engaged: false, approval: 'I_UNDERSTAND_DISABLE_SAFETY_CUTOFF' }, 'cutoff')
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Trading controls</h2>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-medium ${
            cutoffOn ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'border-red-400/30 bg-red-500/10 text-red-200'
          }`}
        >
          Cutoff: {cutoffOn ? 'ARMED (trading halted)' : 'DISARMED (trading can execute)'}
        </span>
      </div>

      {err && <p className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 p-2 text-sm text-red-200">{err}</p>}

      <div className="mt-4">
        <div className="text-xs uppercase tracking-[0.2em] text-[var(--theme-muted)]">Trading mode</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {SELECTABLE_MODES.map((mode) => {
            const active = summary.tradingMode === mode.id
            return (
              <button
                key={mode.id}
                type="button"
                disabled={busy !== null}
                onClick={() => void post({ action: 'set_trading_mode', mode: mode.id }, `mode-${mode.id}`)}
                className={`rounded-2xl border px-3.5 py-2 text-left text-sm transition disabled:opacity-50 ${
                  active
                    ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100'
                    : 'border-[var(--theme-border)] bg-black/10 text-[var(--theme-text)] hover:border-emerald-400/30'
                }`}
              >
                <div className="font-medium">
                  {mode.label}
                  {active ? ' ✓' : ''}
                </div>
                <div className="text-xs text-[var(--theme-muted)]">{mode.hint}</div>
              </button>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-[var(--theme-muted)]">Live / real-money modes require the explicit approval phrase and are not exposed here yet.</p>
      </div>

      <div className="mt-5 border-t border-[var(--theme-border)]/60 pt-4">
        <div className="text-xs uppercase tracking-[0.2em] text-[var(--theme-muted)]">Emergency safety cutoff</div>
        <p className="mt-1 text-xs text-[var(--theme-muted)]">Master switch — while ARMED the engine cannot place any order, regardless of mode.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null || cutoffOn}
            onClick={() => void post({ action: 'set_kill_switch', engaged: true }, 'cutoff')}
            className="rounded-2xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/25 disabled:opacity-40"
          >
            {busy === 'cutoff' ? '…' : 'Arm cutoff (safe)'}
          </button>
          <button
            type="button"
            disabled={busy !== null || !cutoffOn}
            onClick={disarmCutoff}
            className="rounded-2xl border border-red-400/40 bg-red-500/15 px-4 py-2 text-sm font-medium text-red-100 transition hover:bg-red-500/25 disabled:opacity-40"
          >
            {busy === 'cutoff' ? '…' : 'Disarm cutoff (enable trading)'}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void post({ action: 'emergency_stop' }, 'estop')}
            className="rounded-2xl border border-red-400/50 bg-red-600/20 px-4 py-2 text-sm font-semibold text-red-100 transition hover:bg-red-600/30 disabled:opacity-40"
          >
            {busy === 'estop' ? '…' : 'EMERGENCY STOP'}
          </button>
        </div>
      </div>
    </section>
  )
}

export function FinanceScreen() {
  const [payload, setPayload] = useState<FinancePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const response = await fetch('/api/finance', { cache: 'no-store' })
        if (!response.ok) throw new Error(`Finance API returned HTTP ${response.status}`)
        const data = (await response.json()) as FinancePayload
        if (!cancelled) {
          setPayload(data)
          setError(null)
        }
      } catch (nextError) {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : 'Finance API failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const summary = payload?.summary
  const riskTone = useMemo(() => {
    if (!summary) return 'neutral'
    if (summary.liveTradingEnabled) return 'danger'
    if (summary.emergencyKillSwitch) return 'good'
    return 'warn'
  }, [summary])

  if (loading) {
    return <main className="min-h-dvh bg-[var(--theme-bg)] p-6 text-[var(--theme-muted)]">Loading Finance section…</main>
  }

  if (error || !payload || !summary) {
    return (
      <main className="min-h-dvh bg-[var(--theme-bg)] p-6 text-red-200">
        <h1 className="text-2xl font-semibold">Finance unavailable</h1>
        <p className="mt-2 text-sm">{error ?? 'No payload returned.'}</p>
      </main>
    )
  }

  return (
    <main className="min-h-dvh overflow-y-auto bg-[var(--theme-bg)] px-4 py-5 text-[var(--theme-text)] md:px-8 md:py-8">
      <section className="rounded-[2rem] border border-[var(--theme-border)] bg-gradient-to-br from-[var(--theme-panel)] via-[var(--theme-panel)] to-emerald-950/20 p-6 shadow-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-emerald-200/80">Hermes Finance</p>
            <h1 className="mt-2 text-3xl font-semibold md:text-4xl">Finance, tax, investment monitoring, and controlled trading</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--theme-muted)]">
              Secure local finance database with personal records, tax tracking, market observation, risk-scored trading plans, audit logs, and hard blocks on real execution until explicit approval.
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            Mode: <strong>{summary.tradingMode}</strong><br />
            Kill switch: <strong>{summary.emergencyKillSwitch ? 'active' : 'inactive'}</strong>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total income" value={formatLkr(summary.totalIncomeLkr)} tone="good" />
        <StatCard label="Total expenses" value={formatLkr(summary.totalExpensesLkr)} tone={summary.totalExpensesLkr > summary.totalIncomeLkr && summary.totalIncomeLkr > 0 ? 'danger' : 'neutral'} />
        <StatCard label="Net savings" value={formatLkr(summary.netSavingsLkr)} tone={summary.netSavingsLkr >= 0 ? 'good' : 'danger'} />
        <StatCard label="Savings rate" value={formatPct(summary.savingsRate)} tone={summary.savingsRate >= 20 ? 'good' : 'warn'} />
        <StatCard label="Cash balance" value={formatLkr(summary.cashBalanceLkr)} />
        <StatCard label="Tax reserve" value={formatLkr(summary.taxReserveLkr)} />
        <StatCard label="Net worth" value={formatLkr(summary.netWorthLkr)} />
        <StatCard label="Trading safety" value={summary.liveTradingEnabled ? 'Live enabled' : 'Live blocked'} tone={riskTone} />
      </section>

      <TradingControls summary={summary} onPayload={setPayload} />

      <section className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
          <h2 className="text-lg font-semibold">Implementation coverage</h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {modules.map((item) => (
              <div key={item} className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3 text-sm text-[var(--theme-muted)]">{item}</div>
            ))}
          </div>
        </div>
        <div className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
          <h2 className="text-lg font-semibold">Alerts and controls</h2>
          <div className="mt-4 space-y-2">
            {payload.alerts.map((alert) => (
              <div key={`${alert.title}-${alert.detail}`} className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3">
                <div className="text-sm font-medium">{alert.title}</div>
                <div className="text-xs text-[var(--theme-muted)]">{alert.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <DemoTradingPanel />

      <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
        <h2 className="text-lg font-semibold">Phased rollout</h2>
        <ol className="mt-4 grid gap-2 lg:grid-cols-5">
          {phases.map((phase) => (
            <li key={phase} className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3 text-sm text-[var(--theme-muted)]">{phase}</li>
          ))}
        </ol>
      </section>

      <section className="mt-6 grid gap-4">
        <DataTable title="Accounts" rows={payload.data.finance_accounts} columns={['name', 'type', 'currency', 'balance', 'platform']} />
        <DataTable title="Income records" rows={payload.data.income_records} columns={['dateReceived', 'sourceName', 'incomeType', 'originalCurrency', 'originalAmount', 'convertedLkrAmount', 'taxable']} />
        <DataTable title="Expense records" rows={payload.data.expense_records} columns={['date', 'vendor', 'category', 'currency', 'amount', 'convertedLkrAmount', 'recurring']} />
        <DataTable title="Savings goals" rows={payload.data.savings_goals} columns={['name', 'targetAmount', 'currentAmount', 'currency', 'targetDate', 'status']} />
        <DataTable title="Tax records" rows={payload.data.tax_records} columns={['taxYear', 'incomeType', 'convertedLkrAmount', 'taxPaid', 'taxDue', 'requiresConfirmation']} />
        <DataTable title="Trading plans" rows={payload.data.trading_plans} columns={['platform', 'symbol', 'assetType', 'decision', 'riskLevel', 'riskScore', 'status', 'executionStatus']} />
      </section>

      <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5 text-sm text-[var(--theme-muted)]">
        <h2 className="text-lg font-semibold text-[var(--theme-text)]">Security and storage</h2>
        <p className="mt-2">Database: {payload.paths.database}</p>
        <p>Audit log: {payload.paths.auditLog}</p>
        <p>Secrets: {payload.paths.secretStorage}</p>
        <p className="mt-3">Tax outputs are estimates only and must be confirmed against official sources before filing. Trading execution remains blocked by default; Binance withdrawals, leverage, and futures are disabled in policy.</p>
      </section>
    </main>
  )
}
