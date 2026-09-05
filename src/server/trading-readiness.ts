/**
 * Staged live-trading readiness gates.
 *
 * Every existing "flip a mode" surface in routes/api/finance.ts
 * (`set_trading_mode`, `set_execution_account`, `arm_live_binance`) only
 * asks for an approval PHRASE before allowing `live_manual_approval` /
 * `binance_live` — none of them check whether the system has actually
 * earned that trust (enough paper/testnet evidence, intact risk caps, a
 * working kill switch, live credentials that exist, etc). This module adds
 * that missing evidence layer on top, without touching any of the above:
 *
 *  1. `assessReadiness()` computes 10 independent gates from data the
 *     engine already tracks (decisionQualityReport, strategyGuardReview,
 *     the trading ledger, the connectivity breaker, storage health, env
 *     credentials) and returns a versioned snapshot.
 *  2. `persistReadinessSnapshot()` stores that snapshot (bounded history)
 *     in `settings.liveReadiness` and audit-logs it.
 *  3. `requestLiveApproval()` / `approveLiveApproval()` create a
 *     short-lived, fingerprinted approval record — fingerprinted against
 *     the exact risk-relevant settings in play (guardian caps, enabled
 *     strategies, per-order cap, kill switch, execution account) so any
 *     change to those settings after approval automatically invalidates it
 *     (see `isApprovalCurrentlyValid`).
 *  4. `activateLiveReadiness()` is the ONLY function in this module that
 *     ever sets `liveTradingEnabled`/`liveBinanceApprovedAt` — the exact
 *     fields `demo-trading-engine.ts`'s own cycle-level bail-out already
 *     requires before it will place a real order. It refuses unless every
 *     gate currently passes, the approval is unexpired and unmodified, the
 *     explicit approval phrase is supplied (again, in addition to the one
 *     required at `approveLiveApproval()` time), and the kill switch /
 *     connectivity breaker are rechecked live rather than trusted from the
 *     stale snapshot.
 *  5. `deactivateLiveReadiness()` is the safe direction (like
 *     `set_kill_switch engaged:true`) — no phrase required, always allowed.
 *
 * Fail-closed throughout: any gate whose inputs are missing, stale, or
 * unreadable evaluates to `pass: false`, never `true` — "we don't know"
 * must never be treated as "it's fine". This module never performs a
 * network call itself (credential gates only check presence/shape via
 * `createDemoClientFromEnv`/`createLiveClientFromEnv`, which construct a
 * client object but never call the exchange).
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import {
  FINANCE_AUDIT_PATH,
  appendAuditLog,
  financeStorageStatus,
  readFinanceStore,
  writeFinanceStore,
} from './finance-store'
import {
  decisionQualityReport,
  getFullEngineHistory,
  resolveEngineConfig,
  strategyGuardReview,
} from './demo-trading-engine'
import { isConnectivityBreakerTripped } from './connectivity-breaker'
import {
  createDemoClientFromEnv,
  createLiveClientFromEnv,
} from './binance-demo-client'
import { buildLedgerRecords } from './trading-ledger'
import type { FinanceDatabase } from './finance-store'
import type { DecisionQualityReport } from './demo-trading-engine'

/** Required verbatim in the request body to approve or activate — matches
 * this codebase's existing convention of a distinct phrase per dangerous
 * action (see `I_APPROVE_LIVE_TRADING`, `I_APPROVE_BINANCE_LIVE_TRADING`,
 * `I_UNDERSTAND_DISABLE_SAFETY_CUTOFF` in routes/api/finance.ts). Kept
 * distinct from those so this staged workflow can't be triggered by a
 * phrase copy-pasted from one of the older, evidence-blind actions.
 */
export const LIVE_READINESS_APPROVAL_PHRASE = 'I_APPROVE_LIVE_TRADING_ACTIVATION'

/** A snapshot older than this is treated as stale and can't back a new
 * approval request — the caller must re-assess first. */
export const READINESS_SNAPSHOT_MAX_AGE_MS = 15 * 60_000
/** How long an approved-but-not-yet-activated approval stays valid. */
export const LIVE_APPROVAL_TTL_MS = 30 * 60_000
/** How long a request stays pending before it must be re-requested. */
export const LIVE_APPROVAL_PENDING_TTL_MS = 15 * 60_000

const READINESS_HISTORY_CAP = 20
const APPROVAL_HISTORY_CAP = 20

const MIN_PAPER_TRADES = 20
const MIN_TESTNET_TRADES = 10
const MAX_EVIDENCE_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const MAX_LIVE_PER_ORDER_CAP_USDT = 50

export type ReadinessGateId =
  | 'paper_evidence'
  | 'sandbox_evidence'
  | 'ledger_integrity'
  | 'strategy_sample_size'
  | 'recovery_visibility'
  | 'account_connectivity'
  | 'kill_switch'
  | 'exposure_caps'
  | 'patient_hold_isolation'
  | 'emergency_stop_readiness'

export interface ReadinessGate {
  id: ReadinessGateId
  label: string
  pass: boolean
  /** Every gate in this module is currently blocking — kept as an explicit
   * field (rather than assumed) so a future informational-only gate can be
   * added without changing the shape callers already read. */
  blocking: boolean
  detail: string
  /** ms since the evidence backing this gate was last produced; null when
   * the gate reflects instantaneous state (e.g. kill switch) rather than
   * time-decaying evidence. */
  evidenceAgeMs: number | null
}

export interface ReadinessSnapshot {
  version: number
  computedAt: string
  gates: Array<ReadinessGate>
  blockers: Array<string>
  allPassed: boolean
  settingsFingerprint: string
}

export type LiveApprovalStatus =
  | 'pending'
  | 'approved'
  | 'expired'
  | 'invalidated'
  | 'activated'
  | 'deactivated'

export interface LiveApprovalRecord {
  id: string
  status: LiveApprovalStatus
  requestedAt: string
  approvedAt: string | null
  expiresAt: string | null
  activatedAt: string | null
  deactivatedAt: string | null
  snapshotVersion: number
  settingsFingerprint: string
  note: string
}

interface ReadinessState {
  snapshot: ReadinessSnapshot | null
  snapshotHistory: Array<ReadinessSnapshot>
  approval: LiveApprovalRecord | null
  approvalHistory: Array<LiveApprovalRecord>
}

function emptyReadinessState(): ReadinessState {
  return { snapshot: null, snapshotHistory: [], approval: null, approvalHistory: [] }
}

function loadReadinessState(db: FinanceDatabase): ReadinessState {
  const raw = (db.settings as Record<string, unknown>).liveReadiness
  if (!raw || typeof raw !== 'object') return emptyReadinessState()
  const state = raw as Partial<ReadinessState>
  return {
    snapshot: state.snapshot ?? null,
    snapshotHistory: Array.isArray(state.snapshotHistory)
      ? state.snapshotHistory
      : [],
    approval: state.approval ?? null,
    approvalHistory: Array.isArray(state.approvalHistory)
      ? state.approvalHistory
      : [],
  }
}

function saveReadinessState(db: FinanceDatabase, state: ReadinessState): void {
  ;(db.settings as Record<string, unknown>).liveReadiness = state
}

/** Fingerprint of every setting that changes the risk profile the operator
 * approved. Recomputed on every check; any drift from the fingerprint
 * captured at request/approve time invalidates the approval outright. */
export function computeSettingsFingerprint(db: FinanceDatabase): string {
  const settings = db.settings as Record<string, unknown>
  const config = resolveEngineConfig(settings.demoTrading)
  const material = {
    guardian: config.guardian,
    enabledStrategies: [...config.enabledStrategies].sort(),
    noLossExitMode: config.noLossExitMode,
    livePerOrderCapUsdt: settings.livePerOrderCapUsdt,
    emergencyKillSwitch: settings.emergencyKillSwitch,
    executionAccount: settings.executionAccount,
    tradingMode: settings.tradingMode,
  }
  return createHash('sha256').update(JSON.stringify(material)).digest('hex')
}

function latestIso(values: Array<string | null | undefined>): string | null {
  let latest: string | null = null
  let latestMs = -Infinity
  for (const value of values) {
    if (!value) continue
    const ms = Date.parse(value)
    if (Number.isFinite(ms) && ms > latestMs) {
      latestMs = ms
      latest = value
    }
  }
  return latest
}

function evidenceGate(
  id: 'paper_evidence' | 'sandbox_evidence',
  label: string,
  trades: Array<{ closedAt: string }>,
  enoughSample: boolean,
  minTrades: number,
  now: number,
): ReadinessGate {
  const lastClosedAt = latestIso(trades.map((t) => t.closedAt))
  const evidenceAgeMs = lastClosedAt === null ? null : now - Date.parse(lastClosedAt)
  const fresh = evidenceAgeMs !== null && evidenceAgeMs <= MAX_EVIDENCE_AGE_MS
  const sampleOk = enoughSample && trades.length >= minTrades
  const pass = sampleOk && fresh
  let detail: string
  if (!trades.length) {
    detail = `no closed trades recorded yet — need at least ${minTrades}`
  } else if (!sampleOk) {
    detail = `only ${trades.length} closed trade(s), need at least ${minTrades}`
  } else if (evidenceAgeMs === null || !fresh) {
    const ageDays = evidenceAgeMs === null ? null : Math.round(evidenceAgeMs / 86_400_000)
    detail = `most recent closed trade is ${ageDays ?? 'unknown'} day(s) old — evidence is stale (max ${MAX_EVIDENCE_AGE_MS / 86_400_000} days)`
  } else {
    detail = `${trades.length} closed trade(s), most recent ${Math.round(evidenceAgeMs / 3_600_000)}h ago`
  }
  return { id, label, pass, blocking: true, detail, evidenceAgeMs }
}

function ledgerIntegrityGate(): ReadinessGate {
  const storage = financeStorageStatus({ selfHeal: false })
  const storageOk = storage.health.status !== 'mirror_mismatch' && storage.health.status !== 'postgres_behind'
  const records = Array.isArray(buildLedgerRecords()) ? buildLedgerRecords() : []
  const anomalies = records.filter((r) => {
    if (r.status === 'open') {
      return (
        r.quantity == null ||
        r.quantity <= 0 ||
        r.entryPrice == null ||
        r.entryPrice <= 0
      )
    }
    return (
      r.entryPrice == null ||
      r.entryPrice <= 0 ||
      r.exitPrice == null ||
      r.exitPrice <= 0
    )
  })
  const pass = storageOk && anomalies.length === 0
  const detail = !storageOk
    ? `finance storage health is "${storage.health.status}" — resolve the mirror mismatch before trusting the ledger`
    : anomalies.length > 0
      ? `${anomalies.length} ledger record(s) have missing/invalid price or quantity data`
      : `storage healthy (${storage.health.status}), ${records.length} ledger record(s), no anomalies`
  return {
    id: 'ledger_integrity',
    label: 'Ledger integrity',
    pass,
    blocking: true,
    detail,
    evidenceAgeMs: null,
  }
}

function strategySampleSizeGate(): ReadinessGate {
  const reviews = Array.isArray(strategyGuardReview()) ? strategyGuardReview() : []
  const insufficient = reviews.filter((r) => !r.window.sufficientSample)
  const pass = reviews.length > 0 && insufficient.length === 0
  const detail =
    reviews.length === 0
      ? 'no enabled strategies to evaluate'
      : insufficient.length > 0
        ? `${insufficient.map((r) => r.strategyId).join(', ')} below the minimum sample size for their evidence window`
        : `all ${reviews.length} enabled strategies have sufficient recent-window sample size`
  return {
    id: 'strategy_sample_size',
    label: 'Strategy sample sufficiency',
    pass,
    blocking: true,
    detail,
    evidenceAgeMs: null,
  }
}

function recoveryVisibilityGate(db: FinanceDatabase): ReadinessGate {
  const settings = db.settings as Record<string, unknown>
  const config = resolveEngineConfig(settings.demoTrading)
  const hasDrawdownCap = config.guardian.maxOpenDrawdownQuote > 0
  const hasDailyCap = config.guardian.maxDailyLossQuote > 0
  const pass = config.noLossExitMode === true && hasDrawdownCap && hasDailyCap
  const missing = [
    !config.noLossExitMode && 'patient-hold/no-loss visibility is off',
    !hasDrawdownCap && 'no open-drawdown halt configured',
    !hasDailyCap && 'no daily-loss halt configured',
  ].filter(Boolean)
  const detail = pass
    ? 'patient-hold visibility on, open-drawdown and daily-loss halts configured'
    : missing.join('; ')
  return {
    id: 'recovery_visibility',
    label: 'Recovery / loss visibility',
    pass,
    blocking: true,
    detail,
    evidenceAgeMs: null,
  }
}

function accountConnectivityGate(): ReadinessGate {
  const breakerTripped = isConnectivityBreakerTripped()
  const testnet = createDemoClientFromEnv()
  const live = createLiveClientFromEnv()
  const pass = !breakerTripped && testnet.client !== null && live.client !== null
  const problems = [
    breakerTripped && 'connectivity breaker is tripped',
    !testnet.client && `testnet credentials: ${testnet.reason}`,
    !live.client && `live credentials: ${live.reason}`,
  ].filter(Boolean)
  const detail = pass
    ? 'testnet and live credentials present, connectivity breaker not tripped'
    : problems.join('; ')
  return {
    id: 'account_connectivity',
    label: 'Account / credential connectivity',
    pass,
    blocking: true,
    detail,
    evidenceAgeMs: null,
  }
}

function killSwitchGate(db: FinanceDatabase): ReadinessGate {
  const engaged = db.settings.emergencyKillSwitch === true
  return {
    id: 'kill_switch',
    label: 'Kill switch disengaged',
    pass: !engaged,
    blocking: true,
    detail: engaged
      ? 'emergency kill switch is currently engaged — disengage it explicitly via set_kill_switch before requesting live approval'
      : 'emergency kill switch is disengaged',
    evidenceAgeMs: null,
  }
}

function exposureCapsGate(db: FinanceDatabase): ReadinessGate {
  const settings = db.settings as Record<string, unknown>
  const config = resolveEngineConfig(settings.demoTrading)
  const cap = settings.livePerOrderCapUsdt
  const capOk =
    typeof cap === 'number' &&
    Number.isFinite(cap) &&
    cap > 0 &&
    cap <= MAX_LIVE_PER_ORDER_CAP_USDT
  const g = config.guardian
  const guardianOk =
    g.maxOpenPositions > 0 &&
    g.perTradeQuoteCap > 0 &&
    g.maxDailyLossQuote > 0 &&
    g.minQuoteBalance >= 0
  const pass = capOk && guardianOk
  const problems = [
    !capOk &&
      `livePerOrderCapUsdt (${String(cap)}) must be a positive number <= ${MAX_LIVE_PER_ORDER_CAP_USDT}`,
    !guardianOk && 'guardian position/quote/loss caps are not fully configured',
  ].filter(Boolean)
  const detail = pass
    ? `per-order cap ${cap} USDT, position cap ${g.maxOpenPositions}, per-trade cap ${g.perTradeQuoteCap} USDT`
    : problems.join('; ')
  return {
    id: 'exposure_caps',
    label: 'Order-size / exposure caps',
    pass,
    blocking: true,
    detail,
    evidenceAgeMs: null,
  }
}

function patientHoldIsolationGate(): ReadinessGate {
  const history = getFullEngineHistory() ?? {
    positions: [],
    archivedPositions: [],
  }
  const positions = Array.isArray(history.positions) ? history.positions : []
  const archived = Array.isArray(history.archivedPositions)
    ? history.archivedPositions
    : []
  const liveOpen = [...positions, ...archived].filter(
    (p) => p.executionMode === 'live',
  )
  const pass = liveOpen.length === 0
  return {
    id: 'patient_hold_isolation',
    label: 'Patient-hold / no-loss live isolation',
    pass,
    blocking: true,
    detail: pass
      ? 'patient-hold is coded to bypass "live" execution mode and no live-tagged positions currently exist'
      : `${liveOpen.length} open position(s) already tagged executionMode="live" — resolve before (re)confirming live isolation`,
    evidenceAgeMs: null,
  }
}

function emergencyStopReadinessGate(db: FinanceDatabase): ReadinessGate {
  const auditDir = path.dirname(FINANCE_AUDIT_PATH)
  const auditDirWritable = (() => {
    try {
      fs.accessSync(auditDir, fs.constants.W_OK)
      return true
    } catch {
      return false
    }
  })()
  const schemaOk =
    typeof db.settings.emergencyKillSwitch === 'boolean' &&
    typeof db.settings.tradingMode === 'string' &&
    typeof db.settings.executionAccount === 'string'
  const pass = auditDirWritable && schemaOk
  const problems = [
    !auditDirWritable && `audit log directory (${auditDir}) is not writable`,
    !schemaOk && 'settings schema for emergency stop is incomplete',
  ].filter(Boolean)
  return {
    id: 'emergency_stop_readiness',
    label: 'Emergency stop readiness',
    pass,
    blocking: true,
    detail: pass
      ? 'audit log writable and emergency-stop settings schema intact'
      : problems.join('; '),
    evidenceAgeMs: null,
  }
}

/** Pure(ish) assessment — reads the finance store and a handful of other
 * already-computed reports, never writes anything. Safe to call as often as
 * a dashboard poll wants ("dry run"). */
export function assessReadiness(now: Date = new Date()): ReadinessSnapshot {
  const db = readFinanceStore()
  const nowMs = now.getTime()
  const history = getFullEngineHistory()
  const quality: DecisionQualityReport = decisionQualityReport()
  const allTrades = [...history.trades, ...history.archivedTrades]
  const paperTrades = allTrades.filter(
    (t) => (t.executionMode ?? 'paper') === 'paper',
  )
  const testnetTrades = allTrades.filter((t) => t.executionMode === 'testnet')

  const gates: Array<ReadinessGate> = [
    evidenceGate(
      'paper_evidence',
      'Paper trading evidence',
      paperTrades,
      quality.validations.enoughPaperData,
      MIN_PAPER_TRADES,
      nowMs,
    ),
    evidenceGate(
      'sandbox_evidence',
      'Sandbox / testnet evidence',
      testnetTrades,
      quality.validations.enoughDataForTestnet,
      MIN_TESTNET_TRADES,
      nowMs,
    ),
    ledgerIntegrityGate(),
    strategySampleSizeGate(),
    recoveryVisibilityGate(db),
    accountConnectivityGate(),
    killSwitchGate(db),
    exposureCapsGate(db),
    patientHoldIsolationGate(),
    emergencyStopReadinessGate(db),
  ]

  const blockers = gates.filter((g) => !g.pass).map((g) => g.label)
  const priorVersion = loadReadinessState(db).snapshot?.version ?? 0

  return {
    version: priorVersion + 1,
    computedAt: now.toISOString(),
    gates,
    blockers,
    allPassed: blockers.length === 0,
    settingsFingerprint: computeSettingsFingerprint(db),
  }
}

/** Computes AND persists a versioned snapshot (bumping `version`, bounding
 * history, audit-logging). Distinct from `assessReadiness()` so read-only
 * dashboard polling never writes to the store. */
export function assessAndPersistReadiness(
  now: Date = new Date(),
): ReadinessSnapshot {
  const db = readFinanceStore()
  const snapshot = assessReadiness(now)
  const state = loadReadinessState(db)
  state.snapshotHistory = [snapshot, ...state.snapshotHistory].slice(
    0,
    READINESS_HISTORY_CAP,
  )
  state.snapshot = snapshot
  saveReadinessState(db, state)
  writeFinanceStore(db)
  appendAuditLog('live_readiness_assessed', {
    version: snapshot.version,
    allPassed: snapshot.allPassed,
    blockers: snapshot.blockers,
  })
  return snapshot
}

export function getReadinessState(): ReadinessState {
  return loadReadinessState(readFinanceStore())
}

function approvalIsExpired(
  approval: LiveApprovalRecord,
  nowMs: number,
): boolean {
  if (!approval.expiresAt) return false
  return Date.parse(approval.expiresAt) <= nowMs
}

/** Re-checks status/expiry/fingerprint drift without mutating anything —
 * callers use this to decide whether a stored approval can still be
 * trusted before reusing/activating it. */
export function evaluateApproval(
  approval: LiveApprovalRecord | null,
  db: FinanceDatabase,
  now: Date = new Date(),
): { valid: boolean; reason: string } {
  if (!approval) return { valid: false, reason: 'no approval on record' }
  if (approval.status === 'activated')
    return { valid: false, reason: 'approval was already activated' }
  if (approval.status === 'deactivated')
    return { valid: false, reason: 'approval was deactivated' }
  if (approval.status === 'invalidated')
    return { valid: false, reason: 'approval was invalidated' }
  if (approval.status === 'expired')
    return { valid: false, reason: 'approval expired' }
  if (approvalIsExpired(approval, now.getTime()))
    return { valid: false, reason: 'approval expired' }
  const currentFingerprint = computeSettingsFingerprint(db)
  if (currentFingerprint !== approval.settingsFingerprint) {
    return {
      valid: false,
      reason:
        'risk-relevant settings changed since this approval was requested — re-assess and re-request',
    }
  }
  return { valid: true, reason: 'ok' }
}

/** Marks a stored approval's status if it has silently lapsed (expiry or
 * fingerprint drift) since it was last written, so `getReadinessState()`
 * callers (the UI) see an accurate status instead of a stale "approved". */
function reconcileStoredApproval(
  db: FinanceDatabase,
  state: ReadinessState,
  now: Date,
): ReadinessState {
  if (!state.approval) return state
  if (state.approval.status !== 'approved' && state.approval.status !== 'pending')
    return state
  const check = evaluateApproval(state.approval, db, now)
  if (check.valid) return state
  const isExpiry = check.reason === 'approval expired'
  const nextStatus: LiveApprovalStatus = isExpiry ? 'expired' : 'invalidated'
  const updated: LiveApprovalRecord = { ...state.approval, status: nextStatus }
  state.approval = updated
  state.approvalHistory = [updated, ...state.approvalHistory].slice(
    0,
    APPROVAL_HISTORY_CAP,
  )
  return state
}

export interface RequestApprovalResult {
  ok: boolean
  error?: string
  reused?: boolean
  snapshot?: ReadinessSnapshot
  approval?: LiveApprovalRecord
}

/** Requests a time-bounded approval for live activation. Fail-closed: a
 * fresh snapshot is required with zero blockers. Idempotent — repeated
 * calls while a still-valid pending/approved request exists return that
 * same record rather than minting a new one each time. */
export function requestLiveApproval(
  now: Date = new Date(),
): RequestApprovalResult {
  const db = readFinanceStore()
  let state = loadReadinessState(db)
  state = reconcileStoredApproval(db, state, now)

  const existing = state.approval
  if (existing && (existing.status === 'pending' || existing.status === 'approved')) {
    const check = evaluateApproval(existing, db, now)
    if (check.valid) {
      saveReadinessState(db, state)
      writeFinanceStore(db)
      return {
        ok: true,
        reused: true,
        approval: existing,
        snapshot: state.snapshot ?? undefined,
      }
    }
  }

  const snapshot = assessReadiness(now)
  state.snapshotHistory = [snapshot, ...state.snapshotHistory].slice(
    0,
    READINESS_HISTORY_CAP,
  )
  state.snapshot = snapshot

  if (!snapshot.allPassed) {
    saveReadinessState(db, state)
    writeFinanceStore(db)
    appendAuditLog('live_readiness_request_blocked', {
      blockers: snapshot.blockers,
    })
    return {
      ok: false,
      error: `readiness gates failing: ${snapshot.blockers.join(', ')}`,
      snapshot,
    }
  }

  const approval: LiveApprovalRecord = {
    id: `live_readiness_${Date.now()}_${randomUUID()}`,
    status: 'pending',
    requestedAt: now.toISOString(),
    approvedAt: null,
    expiresAt: new Date(now.getTime() + LIVE_APPROVAL_PENDING_TTL_MS).toISOString(),
    activatedAt: null,
    deactivatedAt: null,
    snapshotVersion: snapshot.version,
    settingsFingerprint: snapshot.settingsFingerprint,
    note: 'awaiting explicit approval phrase',
  }
  state.approval = approval
  state.approvalHistory = [approval, ...state.approvalHistory].slice(
    0,
    APPROVAL_HISTORY_CAP,
  )
  saveReadinessState(db, state)
  writeFinanceStore(db)
  appendAuditLog('live_readiness_requested', {
    approvalId: approval.id,
    snapshotVersion: snapshot.version,
  })
  return { ok: true, reused: false, approval, snapshot }
}

export interface ApproveResult {
  ok: boolean
  error?: string
  approval?: LiveApprovalRecord
}

/** Finalizes a pending approval — requires the exact phrase and a still-
 * valid (unexpired, fingerprint-matched, gates-still-passing) pending
 * request. Does not itself flip any trading setting. */
export function approveLiveApproval(
  phrase: string,
  now: Date = new Date(),
): ApproveResult {
  if (phrase !== LIVE_READINESS_APPROVAL_PHRASE) {
    appendAuditLog('live_readiness_approve_blocked', {
      reason: 'missing explicit approval phrase',
    })
    return { ok: false, error: 'explicit approval phrase is required' }
  }
  const db = readFinanceStore()
  let state = loadReadinessState(db)
  state = reconcileStoredApproval(db, state, now)
  const approval = state.approval
  if (!approval || approval.status !== 'pending') {
    return {
      ok: false,
      error: 'no pending approval on record — call request first',
    }
  }
  const check = evaluateApproval(approval, db, now)
  if (!check.valid) {
    saveReadinessState(db, state)
    writeFinanceStore(db)
    return { ok: false, error: check.reason }
  }
  // Re-assess rather than trust the snapshot captured at request time —
  // evidence can go stale between request and approve.
  const snapshot = assessReadiness(now)
  state.snapshotHistory = [snapshot, ...state.snapshotHistory].slice(
    0,
    READINESS_HISTORY_CAP,
  )
  state.snapshot = snapshot
  if (!snapshot.allPassed) {
    saveReadinessState(db, state)
    writeFinanceStore(db)
    appendAuditLog('live_readiness_approve_blocked', {
      reason: 'readiness gates failing at approve time',
      blockers: snapshot.blockers,
    })
    return {
      ok: false,
      error: `readiness gates failing: ${snapshot.blockers.join(', ')}`,
    }
  }
  const updated: LiveApprovalRecord = {
    ...approval,
    status: 'approved',
    approvedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + LIVE_APPROVAL_TTL_MS).toISOString(),
    snapshotVersion: snapshot.version,
    settingsFingerprint: snapshot.settingsFingerprint,
    note: 'approved — awaiting activation',
  }
  state.approval = updated
  state.approvalHistory = [updated, ...state.approvalHistory].slice(
    0,
    APPROVAL_HISTORY_CAP,
  )
  saveReadinessState(db, state)
  writeFinanceStore(db)
  appendAuditLog('live_readiness_approved', {
    approvalId: updated.id,
    expiresAt: updated.expiresAt,
  })
  return { ok: true, approval: updated }
}

export interface ActivateResult {
  ok: boolean
  error?: string
  approval?: LiveApprovalRecord
}

/**
 * The one and only place in this module that flips
 * `liveTradingEnabled`/`liveBinanceApprovedAt` — the exact fields
 * `demo-trading-engine.ts`'s cycle bail-out requires before it will place a
 * real order. Requires the phrase again (defense in depth beyond
 * `approveLiveApproval`), a still-valid approval, and rechecks the kill
 * switch / connectivity breaker live rather than trusting the snapshot.
 */
export function activateLiveReadiness(
  phrase: string,
  now: Date = new Date(),
): ActivateResult {
  if (phrase !== LIVE_READINESS_APPROVAL_PHRASE) {
    appendAuditLog('live_readiness_activate_blocked', {
      reason: 'missing explicit approval phrase',
    })
    return { ok: false, error: 'explicit approval phrase is required' }
  }
  const db = readFinanceStore()
  // Defense in depth: never trust the fingerprint alone for the two most
  // safety-critical instantaneous states — recheck them live.
  if (db.settings.emergencyKillSwitch) {
    appendAuditLog('live_readiness_activate_blocked', {
      reason: 'emergency kill switch is engaged',
    })
    return { ok: false, error: 'emergency kill switch is engaged' }
  }
  if (isConnectivityBreakerTripped()) {
    appendAuditLog('live_readiness_activate_blocked', {
      reason: 'connectivity breaker is tripped',
    })
    return { ok: false, error: 'connectivity breaker is tripped' }
  }
  const liveSnapshot = assessReadiness(now)
  if (!liveSnapshot.allPassed) {
    appendAuditLog('live_readiness_activate_blocked', {
      reason: 'readiness gates failing at activation time',
      blockers: liveSnapshot.blockers,
    })
    return {
      ok: false,
      error: `readiness gates failing: ${liveSnapshot.blockers.join(', ')}`,
    }
  }
  let state = loadReadinessState(db)
  const approval = state.approval
  if (!approval) {
    return {
      ok: false,
      error: 'no approved live-readiness approval on record',
    }
  }
  const check = evaluateApproval(approval, db, now)
  if (!check.valid) {
    state = reconcileStoredApproval(db, state, now)
    saveReadinessState(db, state)
    writeFinanceStore(db)
    return { ok: false, error: check.reason }
  }
  if (approval.status !== 'approved') {
    return {
      ok: false,
      error: `approval status is "${approval.status}" — call approve first`,
    }
  }

  const approvedAt = now.toISOString()
  db.settings.executionAccount = 'binance_live'
  db.settings.tradingMode = 'live_manual_approval'
  db.settings.liveTradingEnabled = true
  db.settings.paperShadowEnabled = true
  db.settings.liveBinanceApprovedAt = approvedAt
  db.settings.liveBinanceApprovalId = approval.id

  const updated: LiveApprovalRecord = {
    ...approval,
    status: 'activated',
    activatedAt: approvedAt,
    note: 'activated — live trading enabled',
  }
  state.approval = updated
  state.approvalHistory = [updated, ...state.approvalHistory].slice(
    0,
    APPROVAL_HISTORY_CAP,
  )
  saveReadinessState(db, state)
  writeFinanceStore(db)
  appendAuditLog('live_readiness_activated', {
    approvalId: updated.id,
    livePerOrderCapUsdt: db.settings.livePerOrderCapUsdt,
  })
  return { ok: true, approval: updated }
}

export interface DeactivateResult {
  ok: boolean
  approval?: LiveApprovalRecord
}

/** Safe direction — no phrase required, mirrors `set_kill_switch
 * engaged:true`. Retreats to testnet (not straight to observe_only) so
 * validation can continue; use the existing `emergency_stop` action for a
 * full halt. */
export function deactivateLiveReadiness(
  reason: string,
  now: Date = new Date(),
): DeactivateResult {
  const db = readFinanceStore()
  db.settings.executionAccount = 'binance_testnet'
  db.settings.tradingMode = 'testnet_execute'
  db.settings.liveTradingEnabled = false
  db.settings.liveBinanceApprovedAt = null
  db.settings.liveBinanceApprovalId = null

  const state = loadReadinessState(db)
  let approval = state.approval
  if (approval) {
    approval = {
      ...approval,
      status: 'deactivated',
      deactivatedAt: now.toISOString(),
      note: reason || 'deactivated',
    }
    state.approval = approval
    state.approvalHistory = [approval, ...state.approvalHistory].slice(
      0,
      APPROVAL_HISTORY_CAP,
    )
  }
  saveReadinessState(db, state)
  writeFinanceStore(db)
  appendAuditLog('live_readiness_deactivated', { reason })
  return { ok: true, approval: approval ?? undefined }
}
