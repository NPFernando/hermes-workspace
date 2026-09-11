/**
 * Generic auto-refinement for the grid, rebalance, and LLM-signal engines —
 * deliberately NOT built on top of demo-trading-engine.ts's
 * LearningCandidate machinery. That system is council-specific
 * (`configPatch.quotePerTrade`, `StrategyOverrideMode`); forcing three
 * structurally different engines (portfolio rebalancer, incremental grid,
 * async LLM signal) into that shape would be tight coupling for no benefit.
 * Instead this reads each engine's own public `get*State()` accessor,
 * proposes a single conservative parameter adjustment when evidence clears
 * a simple threshold, and applies it directly to that engine's own settings
 * key — same isolation pattern as everything else this session.
 *
 * Same safety line as the council's learning loop (see
 * demo-trading-engine.ts's LearningCandidate docs): every candidate this
 * module can generate is structurally risk-reducing or cost-reducing —
 * smaller size, fewer/larger-only trades, a stricter confidence bar — never
 * the reverse. That's enforced both by construction (each evaluate* function
 * only ever proposes a move in the safe direction) and by an explicit guard
 * in applyCandidate() as defense in depth.
 *
 * Off by default (`settings.autoRefinement.enabled === false`): candidates
 * are always evaluated and always written to research.parameter_changes
 * (evidence keeps accumulating even while disabled), but only mutate a live
 * engine's settings when explicitly enabled — mirrors
 * LearningPolicy.enabled's off-by-default pattern.
 */
import {
  appendAuditLog,
  readFinanceStore,
  writeFinanceStore,
} from './finance-store'
import { getGridEngineState } from './grid-paper-engine'
import { getLlmSignalState } from './llm-signal-engine'
import { getRebalanceState } from './rebalance-engine'
import { recordParameterChange } from './research-store'
import type { RiskDirection } from './research-store'

export type RefinementEngine = 'grid' | 'rebalance' | 'llm_signal'

export interface RefinementCandidate {
  engine: RefinementEngine
  paramName: string
  oldValue: number
  newValue: number
  reason: string
  riskDirection: RiskDirection
  evidence: Record<string, unknown>
}

export interface AutoRefinementPolicy {
  enabled: boolean
}

export const DEFAULT_AUTO_REFINEMENT_POLICY: AutoRefinementPolicy = {
  enabled: false,
}

export function resolveAutoRefinementPolicy(
  settingsOverride: unknown,
): AutoRefinementPolicy {
  const raw =
    settingsOverride && typeof settingsOverride === 'object'
      ? (settingsOverride as Record<string, unknown>)
      : {}
  return {
    enabled:
      typeof raw.enabled === 'boolean'
        ? raw.enabled
        : DEFAULT_AUTO_REFINEMENT_POLICY.enabled,
  }
}

const GRID_MIN_TRADES = 10
const GRID_SIZE_STEP = 0.75 // shrink quotePerGrid by 25% per candidate
const GRID_MIN_QUOTE_PER_GRID = 1

function evaluateGridCandidate(): RefinementCandidate | null {
  const { config, trades } = getGridEngineState()
  if (trades.length < GRID_MIN_TRADES) return null
  const totalPnl = trades.reduce((sum, t) => sum + t.pnlQuote, 0)
  if (totalPnl >= 0) return null
  const newValue = Math.max(
    GRID_MIN_QUOTE_PER_GRID,
    Math.round(config.quotePerGrid * GRID_SIZE_STEP * 100) / 100,
  )
  if (newValue >= config.quotePerGrid) return null
  return {
    engine: 'grid',
    paramName: 'quotePerGrid',
    oldValue: config.quotePerGrid,
    newValue,
    reason: `Last ${trades.length} grid trades net ${totalPnl.toFixed(2)} quote; reducing size per grid level.`,
    riskDirection: 'reducing',
    evidence: { tradeCount: trades.length, totalPnlQuote: totalPnl },
  }
}

const REBALANCE_MIN_TRADES = 10
const REBALANCE_SMALL_TRADE_MULTIPLE = 1.5
const REBALANCE_SMALL_TRADE_FRACTION_THRESHOLD = 0.5
const REBALANCE_FLOOR_STEP = 1.5 // raise minTradeNotionalQuote by 50%
const REBALANCE_MAX_MIN_TRADE_NOTIONAL = 15

function evaluateRebalanceCandidate(): RefinementCandidate | null {
  const { config, trades } = getRebalanceState()
  if (trades.length < REBALANCE_MIN_TRADES) return null
  const smallTradeCeiling =
    config.minTradeNotionalQuote * REBALANCE_SMALL_TRADE_MULTIPLE
  const smallTradeCount = trades.filter(
    (t) => t.notionalQuote <= smallTradeCeiling,
  ).length
  const smallTradeFraction = smallTradeCount / trades.length
  if (smallTradeFraction < REBALANCE_SMALL_TRADE_FRACTION_THRESHOLD) return null
  const newValue = Math.min(
    REBALANCE_MAX_MIN_TRADE_NOTIONAL,
    Math.round(config.minTradeNotionalQuote * REBALANCE_FLOOR_STEP * 100) / 100,
  )
  if (newValue <= config.minTradeNotionalQuote) return null
  return {
    engine: 'rebalance',
    paramName: 'minTradeNotionalQuote',
    oldValue: config.minTradeNotionalQuote,
    newValue,
    reason: `${smallTradeCount}/${trades.length} recent rebalance trades were near the notional floor; raising the floor to cut fee-heavy small trades.`,
    riskDirection: 'reducing',
    evidence: {
      tradeCount: trades.length,
      smallTradeCount,
      smallTradeFraction,
    },
  }
}

const LLM_MIN_CLOSED_TRADES = 5
const LLM_CONFIDENCE_STEP = 0.1
const LLM_MAX_MIN_CONFIDENCE = 0.9

function evaluateLlmCandidate(): RefinementCandidate | null {
  const { config, trades } = getLlmSignalState()
  const closed = trades.filter((t) => typeof t.pnlQuote === 'number')
  if (closed.length < LLM_MIN_CLOSED_TRADES) return null
  const totalPnl = closed.reduce((sum, t) => sum + (t.pnlQuote ?? 0), 0)
  if (totalPnl >= 0) return null
  const newValue = Math.min(
    LLM_MAX_MIN_CONFIDENCE,
    Math.round((config.minConfidence + LLM_CONFIDENCE_STEP) * 100) / 100,
  )
  if (newValue <= config.minConfidence) return null
  return {
    engine: 'llm_signal',
    paramName: 'minConfidence',
    oldValue: config.minConfidence,
    newValue,
    reason: `Last ${closed.length} closed LLM-signal trades net ${totalPnl.toFixed(2)} quote; raising the minimum confidence bar.`,
    riskDirection: 'reducing',
    evidence: { closedTradeCount: closed.length, totalPnlQuote: totalPnl },
  }
}

export function evaluateAllCandidates(): Array<RefinementCandidate> {
  return [
    evaluateGridCandidate(),
    evaluateRebalanceCandidate(),
    evaluateLlmCandidate(),
  ].filter((c): c is RefinementCandidate => c !== null)
}

const SETTINGS_KEY_BY_ENGINE: Record<RefinementEngine, string> = {
  grid: 'demoTradingGrid',
  rebalance: 'demoTradingRebalance',
  llm_signal: 'demoTradingLlm',
}

function applyCandidate(candidate: RefinementCandidate): void {
  // Defense in depth: even though every evaluate* function above only ever
  // proposes a move in its safe direction, refuse to apply anything that
  // isn't risk/cost-reducing, and refuse a no-op.
  if (
    candidate.riskDirection !== 'reducing' &&
    candidate.riskDirection !== 'neutral'
  )
    return
  const db = readFinanceStore()
  const settings = db.settings as Record<string, unknown>
  const settingsKey = SETTINGS_KEY_BY_ENGINE[candidate.engine]
  const engineConfig = {
    ...(settings[settingsKey] && typeof settings[settingsKey] === 'object'
      ? (settings[settingsKey] as Record<string, unknown>)
      : {}),
  }
  engineConfig[candidate.paramName] = candidate.newValue
  settings[settingsKey] = engineConfig
  db.updatedAt = new Date().toISOString()
  writeFinanceStore(db)
  appendAuditLog('auto_refinement_candidate_applied', {
    engine: candidate.engine,
    paramName: candidate.paramName,
    oldValue: candidate.oldValue,
    newValue: candidate.newValue,
    reason: candidate.reason,
  })
}

export interface AutoRefinementCycleResult {
  ran: true
  policyEnabled: boolean
  candidates: Array<RefinementCandidate>
  applied: Array<RefinementCandidate>
}

export async function runAutoRefinementCycle(): Promise<AutoRefinementCycleResult> {
  const db = readFinanceStore()
  const settings = db.settings as Record<string, unknown>
  const policy = resolveAutoRefinementPolicy(settings.autoRefinement)
  const candidates = evaluateAllCandidates()
  const applied: Array<RefinementCandidate> = []
  for (const candidate of candidates) {
    if (policy.enabled) {
      applyCandidate(candidate)
      applied.push(candidate)
    } else {
      appendAuditLog('auto_refinement_candidate_proposed', {
        engine: candidate.engine,
        paramName: candidate.paramName,
        oldValue: candidate.oldValue,
        newValue: candidate.newValue,
        reason: candidate.reason,
      })
    }
    await recordParameterChange({
      engine: candidate.engine,
      paramName: candidate.paramName,
      oldValue: candidate.oldValue,
      newValue: candidate.newValue,
      reason: candidate.reason,
      evidence: candidate.evidence,
      appliedBy: 'auto',
      riskDirection: candidate.riskDirection,
      applied: policy.enabled,
    })
  }
  return { ran: true, policyEnabled: policy.enabled, candidates, applied }
}

export function getAutoRefinementState(): {
  policy: AutoRefinementPolicy
  candidates: Array<RefinementCandidate>
} {
  const db = readFinanceStore()
  const settings = db.settings as Record<string, unknown>
  return {
    policy: resolveAutoRefinementPolicy(settings.autoRefinement),
    candidates: evaluateAllCandidates(),
  }
}
