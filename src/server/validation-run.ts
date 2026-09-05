/**
 * Controlled paper-to-sandbox evidence collection.
 *
 * A "validation run" is a persisted, strictly bounded window of trading
 * cycles scoped to either the `paper` or `sandbox` (Binance testnet) stage,
 * used to accumulate run-attributed evidence (ledger records, trades,
 * fills, fees, realized P&L, shadow-vs-actual slippage, and cycle/bail
 * errors) toward the staged live-readiness gates in trading-readiness.ts
 * (`paper_evidence` / `sandbox_evidence`).
 *
 * Design constraints (all enforced in this module, never elsewhere):
 *  - Every run must declare a stage, a non-empty subset of currently
 *    enabled strategies, and four explicit, bounded budgets (time, cycle
 *    count, closed-trade count, exposure) — there is no "unlimited" option;
 *    omitting or zeroing a budget is rejected outright, not defaulted.
 *  - Live execution mode is always rejected, both at start and on every
 *    subsequent cycle (in case `tradingMode` changes mid-run) — this module
 *    never widens the paper/testnet-only scope routes/api/demo-trading.ts's
 *    `runTradingCycle()` already enforces; it only narrows it further via
 *    `RunCycleOptions.config.enabledStrategies`.
 *  - Only one active run per stage at a time (a second `start` for the
 *    same stage is a conflict and is rejected), and a run's declared stage
 *    must match the trading system's *current* execution mode (a "sandbox"
 *    run cannot be started/continued while `tradingMode` resolves to
 *    `paper`, and vice versa) — this keeps run-attributed evidence from
 *    silently mixing paper and sandbox activity.
 *  - This module never calls a Binance client, never writes an order, and
 *    never flips any risk-control setting. It only calls the existing,
 *    already-gated `runTradingCycle()` (same gates as the "Run cycle"
 *    button: kill switch, connectivity breaker, guardian, live approval)
 *    with a strategy-scoped config override, and reads back what actually
 *    happened from the same trade log / ledger every other report reads.
 *  - Persisted under `settings.validationRuns` in finance-store.ts's
 *    already-durable (disk + Postgres-mirrored) store, so an active run
 *    survives a process restart with no in-memory timer: every read
 *    (`reviewValidationRuns()`) and every cycle attempt first reconciles
 *    wall-clock/budget expiry against `Date.now()`, exactly like
 *    `reconcileSandboxExperiments()` does for sandbox experiments.
 */
import { randomUUID } from 'node:crypto'
import {
  appendAuditLog,
  readFinanceStore,
  writeFinanceStore,
} from './finance-store'
import { persistTradingCycleDiagnostic } from './finance-postgres-store'
import {
  decisionQualityReport,
  executionModeForTradingMode,
  getFullEngineHistory,
  getLiveMonitor,
  resolveEngineConfig,
  runTradingCycle,
} from './demo-trading-engine'
import { getStrategy } from './trading-strategies'
import { buildLedgerRecords } from './trading-ledger'
import { assessReadiness } from './trading-readiness'
import type { BinanceExecutionClient } from './binance-demo-client'
import type { CycleResult, TradeLogEntry } from './demo-trading-engine'
import type { ReadinessGate } from './trading-readiness'

export type ValidationStage = 'paper' | 'sandbox'
export type ValidationRunStatus = 'active' | 'completed' | 'stopped' | 'expired'

/** Every field is required and bounded — there is no "unbounded" run. */
export interface ValidationRunBudgets {
  maxDurationMs: number
  maxCycles: number
  maxTrades: number
  maxExposureQuote: number
}

export interface ValidationRunBaseline {
  /** Live-monitor equity at start; null when the monitor couldn't be read
   * (never blocks starting a run — informational only). */
  equityQuote: number | null
  openPositions: number
  recordedAt: string
}

export interface ValidationRunProgress {
  cyclesRun: number
  tradesOpened: number
  tradesClosed: number
  lastCycleAt: string | null
  /** The underlying cycle's own `ranAt`/`ran` from the most recent attempt. */
  lastCycleRan: boolean | null
  lastCycleReason: string | null
  currentExposureQuote: number
}

export interface ValidationRunErrorEntry {
  at: string
  message: string
}

export interface ValidationRunEvidence {
  /** `trading-ledger.ts` record ids (`council:<tradeId>`) attributed to this run. */
  ledgerRecordIds: Array<string>
  realizedPnlQuote: number
  feesQuote: number
  /** Running average of shadow-vs-actual slippage for this run's closed
   * trades that had a paired shadow comparison; null when none did. */
  avgSlippageQuote: number | null
  shadowComparisonsSampled: number
  errors: Array<ValidationRunErrorEntry>
}

export interface ValidationRun {
  id: string
  stage: ValidationStage
  executionMode: 'paper' | 'testnet'
  strategies: Array<string>
  /** When true, the server advances this run on the normal validation cadence. */
  autoRun: boolean
  status: ValidationRunStatus
  budgets: ValidationRunBudgets
  baseline: ValidationRunBaseline
  progress: ValidationRunProgress
  evidence: ValidationRunEvidence
  /** Snapshot of the matching readiness gate (`paper_evidence` /
   * `sandbox_evidence`) taken at finalize time — null until finalized. */
  readinessImpact: ReadinessGate | null
  createdAt: string
  updatedAt: string
  endedAt: string | null
  endReason: string | null
  notes: string
}

export interface ValidationRunState {
  active: Array<ValidationRun>
  history: Array<ValidationRun>
}

export type ValidationRecommendation =
  | 'continue_collecting'
  | 'keep_unchanged'
  | 'review_reversible_control'

export interface ValidationRunReconciliation {
  runId: string
  stage: ValidationStage
  status: ValidationRunStatus
  baselineEquityQuote: number | null
  currentExposureQuote: number
  attributedTradeCount: number
  attributedLedgerCount: number
  realizedPnlQuote: number
  feesQuote: number
  openPositionCount: number
  warnings: Array<string>
  recommendation: ValidationRecommendation
  evaluatedAt: string
}

const HISTORY_CAP = 50
const ERRORS_CAP = 50

const MAX_DURATION_MS = 14 * 24 * 60 * 60 * 1000 // 14 days
const MIN_DURATION_MS = 60_000 // 1 minute
const MAX_CYCLES = 500
const MAX_TRADES = 300
const MAX_EXPOSURE_QUOTE = 100_000

function emptyState(): ValidationRunState {
  return { active: [], history: [] }
}

function loadState(): ValidationRunState {
  const db = readFinanceStore()
  if (!db || !db.settings || typeof db.settings !== 'object') {
    return emptyState()
  }
  const raw = (db.settings as Record<string, unknown>).validationRuns
  if (!raw || typeof raw !== 'object') return emptyState()
  const state = raw as Partial<ValidationRunState>
  return {
    active: Array.isArray(state.active)
      ? state.active.map((run) => ({ ...run, autoRun: run.autoRun === true }))
      : [],
    history: Array.isArray(state.history) ? state.history : [],
  }
}

function saveState(state: ValidationRunState): void {
  const db = readFinanceStore()
  ;(db.settings as Record<string, unknown>).validationRuns = state
  writeFinanceStore(db)
}

function stageForExecutionMode(
  mode: ReturnType<typeof executionModeForTradingMode>,
): ValidationStage | null {
  if (mode === 'paper') return 'paper'
  if (mode === 'testnet') return 'sandbox'
  return null
}

function readinessGateForStage(
  stage: ValidationStage,
): ReadinessGate | null {
  const snapshot = assessReadiness()
  const id = stage === 'paper' ? 'paper_evidence' : 'sandbox_evidence'
  return snapshot.gates.find((g) => g.id === id) ?? null
}

function currentExposureQuote(
  executionMode: 'paper' | 'testnet',
  strategies: Array<string>,
): number {
  const history = getFullEngineHistory()
  const strategySet = new Set(strategies)
  return history.positions
    .filter(
      (p) => p.executionMode === executionMode && strategySet.has(p.strategyId),
    )
    .reduce((sum, p) => sum + p.entryQuote, 0)
}

/**
 * Reconciles wall-clock time-budget expiry for every active run — this is
 * the "restart recovery" mechanism: there is no in-memory timer, so any
 * read (status/history) or cycle attempt first calls this to move any run
 * whose `maxDurationMs` has elapsed out of `active` and into `history`,
 * exactly once, regardless of how long the process was down.
 */
function reconcileExpiry(
  state: ValidationRunState,
  now: number,
): ValidationRunState {
  const stillActive: Array<ValidationRun> = []
  const justExpired: Array<ValidationRun> = []
  for (const run of state.active) {
    const ageMs = now - Date.parse(run.createdAt)
    if (Number.isFinite(ageMs) && ageMs >= run.budgets.maxDurationMs) {
      justExpired.push({
        ...run,
        status: 'expired',
        endedAt: new Date(now).toISOString(),
        endReason: 'time budget exceeded',
        readinessImpact: readinessGateForStage(run.stage),
        updatedAt: new Date(now).toISOString(),
      })
    } else {
      stillActive.push(run)
    }
  }
  if (justExpired.length === 0) return state
  for (const run of justExpired) {
    appendAuditLog('validation_run_expired', {
      id: run.id,
      stage: run.stage,
      cyclesRun: run.progress.cyclesRun,
      tradesClosed: run.progress.tradesClosed,
    })
  }
  const next: ValidationRunState = {
    active: stillActive,
    history: [...justExpired, ...state.history].slice(0, HISTORY_CAP),
  }
  saveState(next)
  return next
}

/** Read-only view: reconciles expiry then returns the current state. Safe
 * to call as often as a dashboard poll wants — mirrors
 * `reviewSandboxExperiments()`'s "reconcile-on-read" convention. */
export function reviewValidationRuns(now: Date = new Date()): ValidationRunState {
  return reconcileExpiry(loadState(), now.getTime())
}

function reconcileRun(
  run: ValidationRun,
  now: Date,
): ValidationRunReconciliation {
  const history = getFullEngineHistory()
  const tradeIds = new Set(
    run.evidence.ledgerRecordIds
      .filter((id) => id.startsWith('council:'))
      .map((id) => id.slice('council:'.length)),
  )
  const trades = history.trades.filter(
    (trade) =>
      tradeIds.has(trade.id) &&
      trade.executionMode === run.executionMode &&
      run.strategies.includes(trade.strategyId),
  )
  const positions = history.positions.filter(
    (position) =>
      position.executionMode === run.executionMode &&
      run.strategies.includes(position.strategyId),
  )
  const warnings: Array<string> = []
  if (run.progress.tradesClosed === 0) warnings.push('no closed trades collected')
  if (run.progress.cyclesRun === 0) warnings.push('no cycles completed')
  if (trades.length !== run.progress.tradesClosed) {
    warnings.push(
      `trade attribution mismatch: run reports ${run.progress.tradesClosed}, ledger-linked history has ${trades.length}`,
    )
  }
  if (run.evidence.ledgerRecordIds.length !== trades.length) {
    warnings.push(
      `ledger mismatch: ${run.evidence.ledgerRecordIds.length} record(s) recorded for ${trades.length} linked trade(s)`,
    )
  }
  if (positions.length > 0) {
    warnings.push(`${positions.length} selected-strategy position(s) remain open`)
  }
  const enoughSample = run.progress.tradesClosed >= 5
  const recommendation: ValidationRecommendation =
    warnings.some((warning) => warning.includes('mismatch'))
      ? 'continue_collecting'
      : !enoughSample
        ? 'continue_collecting'
        : run.evidence.realizedPnlQuote > 0
          ? 'keep_unchanged'
          : 'review_reversible_control'
  return {
    runId: run.id,
    stage: run.stage,
    status: run.status,
    baselineEquityQuote: run.baseline.equityQuote,
    currentExposureQuote: run.progress.currentExposureQuote,
    attributedTradeCount: trades.length,
    attributedLedgerCount: run.evidence.ledgerRecordIds.length,
    realizedPnlQuote: run.evidence.realizedPnlQuote,
    feesQuote: run.evidence.feesQuote,
    openPositionCount: positions.length,
    warnings,
    recommendation,
    evaluatedAt: now.toISOString(),
  }
}

export interface ValidationReconciliationPayload {
  active: Array<ValidationRunReconciliation>
  history: Array<ValidationRunReconciliation>
}

export function validationReconciliationPayload(
  now: Date = new Date(),
): ValidationReconciliationPayload {
  const state = reviewValidationRuns(now)
  return {
    active: state.active.map((run) => reconcileRun(run, now)),
    history: state.history.slice(0, 20).map((run) => reconcileRun(run, now)),
  }
}

function normalizeBudget(
  value: unknown,
  min: number,
  max: number,
  label: string,
): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(
      `${label} is required and must be a positive, bounded number — validation runs cannot be unbounded.`,
    )
  }
  if (n < min || n > max) {
    throw new Error(`${label} must be between ${min} and ${max} (got ${n}).`)
  }
  return n
}

export interface StartValidationRunInput {
  stage: unknown
  strategies: unknown
  budgets: unknown
  notes?: unknown
  autoRun?: unknown
}

export interface StartValidationRunResult {
  changed: boolean
  message: string
  run: ValidationRun | null
  state: ValidationRunState
}

/**
 * Starts a bounded validation run. Throws on any rejection (live mode,
 * unbounded/out-of-range budgets, unknown/disabled strategies, or a
 * stage/mode/active-run conflict) — callers (the finance API route) treat a
 * thrown Error as a 400, matching this codebase's existing
 * `startSandboxExperiment()` convention.
 */
export async function startValidationRun(
  input: StartValidationRunInput,
): Promise<StartValidationRunResult> {
  ensureValidationRunAutomation()
  if (input.stage !== 'paper' && input.stage !== 'sandbox') {
    throw new Error('stage must be "paper" or "sandbox".')
  }
  const stage: ValidationStage = input.stage

  const db = readFinanceStore()
  const settings = db.settings as Record<string, unknown>
  const resolvedMode = executionModeForTradingMode(
    db.settings.tradingMode as string,
  )
  if (resolvedMode === 'live' || resolvedMode === null) {
    throw new Error(
      `Validation runs may only target paper or sandbox/testnet — current tradingMode ("${String(db.settings.tradingMode)}") resolves to ${resolvedMode ?? 'no execution mode'}, never live.`,
    )
  }
  const currentStage = stageForExecutionMode(resolvedMode)
  if (currentStage !== stage) {
    throw new Error(
      `Requested stage "${stage}" does not match the current tradingMode's execution mode ("${resolvedMode}", stage "${currentStage}") — switch tradingMode before starting this run.`,
    )
  }
  if (db.settings.emergencyKillSwitch) {
    throw new Error(
      'The emergency kill switch is engaged — disengage it before starting a validation run.',
    )
  }

  const config = resolveEngineConfig(settings.demoTrading)
  const enabledSet = new Set(config.enabledStrategies)
  const strategies = Array.isArray(input.strategies)
    ? [
        ...new Set(
          input.strategies.filter(
            (id): id is string => typeof id === 'string' && Boolean(getStrategy(id)),
          ),
        ),
      ]
    : []
  if (strategies.length === 0) {
    throw new Error('At least one known strategyId is required.')
  }
  const notEnabled = strategies.filter((id) => !enabledSet.has(id))
  if (notEnabled.length > 0) {
    throw new Error(
      `${notEnabled.join(', ')} ${notEnabled.length === 1 ? 'is' : 'are'} not currently enabled (config.enabledStrategies) — enable before selecting for a validation run.`,
    )
  }

  const budgetsInput = (input.budgets ?? {}) as Record<string, unknown>
  const budgets: ValidationRunBudgets = {
    maxDurationMs: normalizeBudget(
      budgetsInput.maxDurationMs,
      MIN_DURATION_MS,
      MAX_DURATION_MS,
      'budgets.maxDurationMs',
    ),
    maxCycles: normalizeBudget(
      budgetsInput.maxCycles,
      1,
      MAX_CYCLES,
      'budgets.maxCycles',
    ),
    maxTrades: normalizeBudget(
      budgetsInput.maxTrades,
      1,
      MAX_TRADES,
      'budgets.maxTrades',
    ),
    maxExposureQuote: normalizeBudget(
      budgetsInput.maxExposureQuote,
      0.01,
      MAX_EXPOSURE_QUOTE,
      'budgets.maxExposureQuote',
    ),
  }

  const state = loadState()
  const conflict = state.active.find((r) => r.stage === stage)
  if (conflict) {
    throw new Error(
      `A ${stage} validation run (${conflict.id}) is already active — stop or finalize it first.`,
    )
  }

  const notes =
    typeof input.notes === 'string' ? input.notes.trim().slice(0, 500) : ''

  let baseline: ValidationRunBaseline
  const now = new Date().toISOString()
  try {
    const monitor = await getLiveMonitor()
    baseline = {
      equityQuote: monitor.equityQuote,
      openPositions: monitor.monitoring.filter((m) => m.held).length,
      recordedAt: now,
    }
  } catch {
    baseline = { equityQuote: null, openPositions: 0, recordedAt: now }
  }

  const run: ValidationRun = {
    id: `validation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    stage,
    executionMode: resolvedMode,
    strategies,
    autoRun: input.autoRun === true,
    status: 'active',
    budgets,
    baseline,
    progress: {
      cyclesRun: 0,
      tradesOpened: 0,
      tradesClosed: 0,
      lastCycleAt: null,
      lastCycleRan: null,
      lastCycleReason: null,
      currentExposureQuote: 0,
    },
    evidence: {
      ledgerRecordIds: [],
      realizedPnlQuote: 0,
      feesQuote: 0,
      avgSlippageQuote: null,
      shadowComparisonsSampled: 0,
      errors: [],
    },
    readinessImpact: null,
    createdAt: now,
    updatedAt: now,
    endedAt: null,
    endReason: null,
    notes,
  }

  const latestState = loadState()
  const latestConflict = latestState.active.find((r) => r.stage === stage)
  if (latestConflict) {
    throw new Error(
      `A ${stage} validation run (${latestConflict.id}) started while this run was preparing; stop or finalize it first.`,
    )
  }
  const nextState: ValidationRunState = {
    active: [...latestState.active, run],
    history: latestState.history,
  }
  saveState(nextState)
  appendAuditLog('validation_run_started', {
    id: run.id,
    stage,
    executionMode: resolvedMode,
    strategies,
    budgets,
  })
  return {
    changed: true,
    message: `Started ${stage} validation run for ${strategies.join(', ')}.`,
    run,
    state: nextState,
  }
}

export interface RunValidationCycleOptions {
  force?: boolean
  client?: BinanceExecutionClient
}

export interface RunValidationCycleResult {
  ok: boolean
  message: string
  run: ValidationRun | null
  cycle: CycleResult | null
  state: ValidationRunState
}

const RACE_REASON = 'a trading cycle is already in progress'
const AUTO_CYCLE_INTERVAL_MS = 20 * 60_000
const AUTO_CYCLE_STALE_AFTER_MS = AUTO_CYCLE_INTERVAL_MS + 60_000
const AUTO_CYCLE_RECOVERY_COOLDOWN_MS = 5 * 60_000
let validationAutomationTimer: ReturnType<typeof setInterval> | null = null
let validationAutomationTickInProgress = false
let validationAutomationLastTickAt = 0

async function runAutomaticValidationTick(source: 'startup' | 'interval' | 'recovery') {
  if (validationAutomationTickInProgress) return
  validationAutomationTickInProgress = true
  validationAutomationLastTickAt = Date.now()
  appendAuditLog('validation_run_automation_tick', {
    at: new Date(validationAutomationLastTickAt).toISOString(),
    source,
  })
  try {
    const active = reviewValidationRuns().active.filter((run) => run.autoRun)
    for (const run of active) {
      try {
        await runValidationCycle(run.stage)
      } catch (error) {
        console.error(
          `[validation-run] automated ${run.stage} cycle failed:`,
          error,
        )
      }
    }
  } finally {
    validationAutomationTickInProgress = false
  }
}

/**
 * Advances only runs explicitly marked `autoRun` on the same cadence as the
 * normal trading cycle. The persisted run/mode checks remain authoritative,
 * so a mode switch or safety halt cannot be bypassed by automation.
 */
export function ensureValidationRunAutomation(): void {
  if (validationAutomationTimer) return
  appendAuditLog('validation_run_automation_started', {
    cadenceMs: AUTO_CYCLE_INTERVAL_MS,
  })
  validationAutomationTimer = setInterval(
    () => void runAutomaticValidationTick('interval'),
    AUTO_CYCLE_INTERVAL_MS,
  )
  validationAutomationTimer.unref()
  void runAutomaticValidationTick('startup')
}

/**
 * Recovery hook for long-lived server processes where a timer was lost or
 * delayed. It is intentionally bounded and can only request one tick after
 * the normal cadence plus a small grace period has elapsed.
 */
export function recoverValidationRunAutomationIfStale(): void {
  ensureValidationRunAutomation()
  const now = Date.now()
  if (
    validationAutomationTickInProgress ||
    now - validationAutomationLastTickAt < AUTO_CYCLE_STALE_AFTER_MS
  ) {
    return
  }
  validationAutomationLastTickAt = now
  void runAutomaticValidationTick('recovery')
}

/**
 * Runs exactly one trading cycle attributed to the given stage's active
 * run, via the same `runTradingCycle()` every other trigger uses (kill
 * switch / connectivity breaker / guardian / live-approval gates apply
 * unchanged) — narrowed only to this run's selected strategies via
 * `config.enabledStrategies`. Never opens/closes anything itself.
 */
export async function runValidationCycle(
  stage: ValidationStage,
  options: RunValidationCycleOptions = {},
): Promise<RunValidationCycleResult> {
  ensureValidationRunAutomation()
  const now = Date.now()
  let state = reconcileExpiry(loadState(), now)
  const run = state.active.find((r) => r.stage === stage)
  if (!run) {
    return {
      ok: false,
      message: `No active ${stage} validation run.`,
      run: null,
      cycle: null,
      state,
    }
  }

  const db = readFinanceStore()
  const resolvedMode = executionModeForTradingMode(
    db.settings.tradingMode as string,
  )
  if (resolvedMode !== run.executionMode) {
    return {
      ok: false,
      message: `tradingMode changed since this run started (now resolves to ${resolvedMode ?? 'no execution mode'}, run expects ${run.executionMode}) — stop this validation run before changing modes.`,
      run,
      cycle: null,
      state,
    }
  }

  if (run.progress.cyclesRun >= run.budgets.maxCycles) {
    return endRun(run.id, 'completed', 'cycle budget reached')
  }
  if (run.progress.tradesClosed >= run.budgets.maxTrades) {
    return endRun(run.id, 'completed', 'trade budget reached')
  }

  const beforeAt = new Date().toISOString()
  const historyBefore = getFullEngineHistory()
  const priorTradeIds = new Set(
    historyBefore.trades
      .filter((t) => t.executionMode === run.executionMode)
      .map((t) => t.id),
  )

  const cycle = await runTradingCycle({
    force: options.force === true,
    client: options.client,
    config: { enabledStrategies: run.strategies } as never,
  })

  if (cycle.diagnostics) {
    const persisted = persistTradingCycleDiagnostic({
      id: `${run.id}:${cycle.ranAt}`,
      runId: run.id,
      stage,
      executionMode: run.executionMode,
      ranAt: cycle.ranAt,
      status: cycle.diagnostics.status,
      reason: cycle.diagnostics.reason,
      symbols: cycle.diagnostics.symbols as unknown as Array<
        Record<string, unknown>
      >,
    })
    if (!persisted) {
      appendAuditLog('validation_diagnostics_persist_failed', {
        id: run.id,
        stage,
        cycleAt: cycle.ranAt,
      })
    }
  }

  if (!cycle.ran && cycle.reason === RACE_REASON) {
    // A concurrent (e.g. cron) cycle beat us to it — not this run's fault,
    // don't consume any of its bounded cycle budget.
    return {
      ok: false,
      message: RACE_REASON,
      run,
      cycle,
      state,
    }
  }

  const historyAfter = getFullEngineHistory()
  const newTrades: Array<TradeLogEntry> = historyAfter.trades.filter(
    (t) =>
      t.executionMode === run.executionMode &&
      run.strategies.includes(t.strategyId) &&
      !priorTradeIds.has(t.id) &&
      t.closedAt >= beforeAt,
  )

  const ledgerIds = buildLedgerRecords()
    .filter((r) => newTrades.some((t) => `council:${t.id}` === r.id))
    .map((r) => r.id)

  // Attribute shadow-vs-actual slippage for whichever of this cycle's newly
  // closed trades have a paired shadow comparison (decisionQualityReport()
  // is read-only/no side effects, safe to call from here).
  const newGroupIds = new Set(
    newTrades.map((t) => t.groupId).filter((g): g is string => Boolean(g)),
  )
  const matchedSlippage = newGroupIds.size
    ? decisionQualityReport()
        .shadowComparisons.filter((c) => newGroupIds.has(c.groupId))
        .map((c) => c.slippageQuote)
    : []

  const errors: Array<ValidationRunErrorEntry> = [...run.evidence.errors]
  if (!cycle.ran && cycle.reason) {
    errors.push({ at: cycle.ranAt, message: cycle.reason })
  }
  for (const action of cycle.actions) {
    if (action.action === 'BLOCKED') {
      errors.push({ at: cycle.ranAt, message: `${action.symbol}: ${action.reason}` })
    }
  }

  const openedCount = cycle.actions.filter((a) => a.action === 'OPEN').length
  const closedCount = newTrades.length
  const realizedPnlQuote =
    run.evidence.realizedPnlQuote + newTrades.reduce((s, t) => s + t.pnlQuote, 0)
  const feesQuote =
    run.evidence.feesQuote + newTrades.reduce((s, t) => s + t.feesQuote, 0)
  const priorSlippageSum =
    (run.evidence.avgSlippageQuote ?? 0) * run.evidence.shadowComparisonsSampled
  const shadowComparisonsSampled =
    run.evidence.shadowComparisonsSampled + matchedSlippage.length
  const avgSlippageQuote = shadowComparisonsSampled
    ? (priorSlippageSum + matchedSlippage.reduce((s, v) => s + v, 0)) /
      shadowComparisonsSampled
    : null

  const updatedRun: ValidationRun = {
    ...run,
    progress: {
      cyclesRun: run.progress.cyclesRun + 1,
      tradesOpened: run.progress.tradesOpened + openedCount,
      tradesClosed: run.progress.tradesClosed + closedCount,
      lastCycleAt: new Date(now).toISOString(),
      lastCycleRan: cycle.ran,
      lastCycleReason: cycle.reason ?? null,
      currentExposureQuote: currentExposureQuote(run.executionMode, run.strategies),
    },
    evidence: {
      ledgerRecordIds: [...run.evidence.ledgerRecordIds, ...ledgerIds].slice(
        -500,
      ),
      realizedPnlQuote,
      feesQuote,
      avgSlippageQuote,
      shadowComparisonsSampled,
      errors: errors.slice(-ERRORS_CAP),
    },
    updatedAt: new Date(now).toISOString(),
  }

  const latestState = reconcileExpiry(loadState(), Date.now())
  const latestRun = latestState.active.find((r) => r.id === run.id)
  if (!latestRun) {
    return {
      ok: false,
      message: 'Validation run changed while its cycle was running; review the latest run state.',
      run: null,
      cycle,
      state: latestState,
    }
  }
  state = {
    active: latestState.active.map((r) => (r.id === run.id ? updatedRun : r)),
    history: latestState.history,
  }
  saveState(state)
  appendAuditLog('validation_run_cycle', {
    id: run.id,
    stage,
    ran: cycle.ran,
    reason: cycle.reason ?? null,
    opened: openedCount,
    closed: closedCount,
  })

  // Post-cycle budget checks (exposure and cumulative trade/cycle caps) —
  // stop taking further cycles for this run once breached; the underlying
  // position(s) remain fully managed by the engine's own normal cycles
  // (cron etc.) regardless, so nothing here ever force-closes anything.
  if (updatedRun.progress.currentExposureQuote > updatedRun.budgets.maxExposureQuote) {
    return endRun(run.id, 'stopped', 'exposure budget exceeded')
  }
  if (updatedRun.progress.cyclesRun >= updatedRun.budgets.maxCycles) {
    return endRun(run.id, 'completed', 'cycle budget reached')
  }
  if (updatedRun.progress.tradesClosed >= updatedRun.budgets.maxTrades) {
    return endRun(run.id, 'completed', 'trade budget reached')
  }

  return {
    ok: true,
    message: cycle.ran ? 'Cycle attributed to validation run.' : (cycle.reason ?? 'Cycle did not run.'),
    run: updatedRun,
    cycle,
    state,
  }
}

function endRun(
  id: string,
  status: 'completed' | 'stopped',
  reason: string,
): RunValidationCycleResult {
  const state = loadState()
  const run = state.active.find((r) => r.id === id)
  if (!run) {
    return {
      ok: false,
      message: `No active validation run with id ${id}.`,
      run: null,
      cycle: null,
      state,
    }
  }
  const endedAt = new Date().toISOString()
  const ended: ValidationRun = {
    ...run,
    status,
    endedAt,
    endReason: reason,
    readinessImpact: readinessGateForStage(run.stage),
    updatedAt: endedAt,
  }
  const nextState: ValidationRunState = {
    active: state.active.filter((r) => r.id !== id),
    history: [ended, ...state.history].slice(0, HISTORY_CAP),
  }
  saveState(nextState)
  appendAuditLog(`validation_run_${status}`, {
    id,
    stage: run.stage,
    reason,
    cyclesRun: run.progress.cyclesRun,
    tradesClosed: run.progress.tradesClosed,
  })
  return {
    ok: true,
    message: `Validation run ${status}: ${reason}.`,
    run: ended,
    cycle: null,
    state: nextState,
  }
}

/** Manual, abrupt halt — the run is not expected to have collected enough
 * evidence; distinct from `finalizeValidationRun()`'s intentional close-out. */
export function stopValidationRun(
  stage: unknown,
  reason: unknown,
): RunValidationCycleResult {
  if (stage !== 'paper' && stage !== 'sandbox') {
    throw new Error('stage must be "paper" or "sandbox".')
  }
  const state = reconcileExpiry(loadState(), Date.now())
  const run = state.active.find((r) => r.stage === stage)
  if (!run) throw new Error(`No active ${stage} validation run.`)
  const reasonText =
    typeof reason === 'string' && reason.trim()
      ? reason.trim().slice(0, 240)
      : 'manual stop'
  return endRun(run.id, 'stopped', reasonText)
}

/** Intentional close-out: marks the run "completed", captures a final
 * readiness-gate snapshot into `readinessImpact`, and moves it to history. */
export function finalizeValidationRun(
  stage: unknown,
  notes: unknown,
): RunValidationCycleResult {
  if (stage !== 'paper' && stage !== 'sandbox') {
    throw new Error('stage must be "paper" or "sandbox".')
  }
  const state = reconcileExpiry(loadState(), Date.now())
  const run = state.active.find((r) => r.stage === stage)
  if (!run) throw new Error(`No active ${stage} validation run.`)
  if (typeof notes === 'string' && notes.trim()) {
    // Persist the notes update first — endRun() below re-reads state fresh
    // from the store, so a plain in-memory mutation here would be lost.
    saveState({
      active: state.active.map((r) =>
        r.id === run.id ? { ...r, notes: notes.trim().slice(0, 500) } : r,
      ),
      history: state.history,
    })
  }
  return endRun(run.id, 'completed', 'finalized by operator')
}

/** Active-run view augmented with a live (never persisted, always
 * recomputed) readiness-gate snapshot — distinct from the frozen
 * `readinessImpact` a completed/stopped/expired run in `history` carries,
 * so the trading UI can show "readiness impact so far" for a still-running
 * validation run without that field ever going stale in the store. */
export interface ValidationRunView extends ValidationRun {
  liveReadinessImpact: ReadinessGate | null
}

export interface ValidationRunsPayload {
  active: Array<ValidationRunView>
  history: Array<ValidationRun>
}

/** The single read entry point the finance API / trading UI should use for
 * "status/history" — reconciles time-budget expiry first (restart
 * recovery), then attaches a fresh readiness-gate snapshot to every still
 * -active run. Purely read-only. */
export function validationRunsPayload(
  now: Date = new Date(),
): ValidationRunsPayload {
  ensureValidationRunAutomation()
  const state = reviewValidationRuns(now)
  return {
    active: state.active.map((run) => ({
      ...run,
      liveReadinessImpact: readinessGateForStage(run.stage),
    })),
    history: state.history,
  }
}
