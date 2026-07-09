/**
 * Thin client for the `research` Postgres schema (see
 * scripts/init-research-schema.ts for DDL). Deliberately separate from
 * `finance-store.ts` — this is an analysis-friendly mirror/audit trail, not
 * the operational source of truth. The finance-store JSON (and whatever
 * Codex's migration lands in the `public` schema of the same `finance`
 * database) remains authoritative; nothing here is ever read by the live
 * engines to make trading decisions, only written to for later analysis.
 *
 * A missing/invalid RESEARCH_DATABASE_URL degrades to a no-op logger rather
 * than throwing — research logging must never be able to break a trading
 * cycle, mirroring how sendTradeAlert in demo-trading-engine.ts is designed.
 */
import { Pool } from 'pg'

export type Engine = 'council' | 'grid' | 'rebalance' | 'llm_signal'
export type RunType = 'backtest' | 'split' | 'walk_forward' | 'sanity'
export type AppliedBy = 'auto' | 'naveen' | 'claude'
export type RiskDirection = 'reducing' | 'neutral' | 'increasing'
export type LlmDecisionValue = 'BUY' | 'SELL' | 'HOLD'

let pool: Pool | null | undefined

function getPool(): Pool | null {
  if (pool !== undefined) return pool
  const connectionString = process.env.RESEARCH_DATABASE_URL
  if (!connectionString) {
    pool = null
    return pool
  }
  pool = new Pool({ connectionString, max: 5 })
  pool.on('error', (err) => {
    console.error('research-store: idle client error (non-fatal)', err)
  })
  return pool
}

async function safeQuery(text: string, params: Array<unknown>): Promise<void> {
  const p = getPool()
  if (!p) return
  try {
    await p.query(text, params)
  } catch (err) {
    // Never let research logging break a caller's trading cycle.
    console.error('research-store: write failed (non-fatal)', err)
  }
}

export async function recordResearchRun(input: {
  engine: Engine
  runType: RunType
  config: unknown
  result: unknown
  notes?: string
}): Promise<void> {
  await safeQuery(
    `INSERT INTO research.research_runs (engine, run_type, config, result, notes)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input.engine,
      input.runType,
      JSON.stringify(input.config),
      JSON.stringify(input.result),
      input.notes ?? null,
    ],
  )
}

export async function recordParameterChange(input: {
  engine: Engine
  paramName: string
  oldValue: unknown
  newValue: unknown
  reason: string
  evidence?: unknown
  appliedBy: AppliedBy
  riskDirection: RiskDirection
  applied: boolean
}): Promise<void> {
  await safeQuery(
    `INSERT INTO research.parameter_changes
       (engine, param_name, old_value, new_value, reason, evidence, applied_by, risk_direction, applied)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.engine,
      input.paramName,
      JSON.stringify(input.oldValue),
      JSON.stringify(input.newValue),
      input.reason,
      input.evidence != null ? JSON.stringify(input.evidence) : null,
      input.appliedBy,
      input.riskDirection,
      input.applied,
    ],
  )
}

export async function recordFormulaVersion(input: {
  engine: Engine
  strategyId?: string
  versionLabel: string
  description: string
  evidence?: unknown
}): Promise<void> {
  await safeQuery(
    `INSERT INTO research.strategy_formula_versions
       (engine, strategy_id, version_label, description, evidence)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input.engine,
      input.strategyId ?? null,
      input.versionLabel,
      input.description,
      input.evidence != null ? JSON.stringify(input.evidence) : null,
    ],
  )
}

export async function recordLlmDecision(input: {
  symbol: string
  contextSummary: unknown
  model: string
  rawResponse?: string
  decision: LlmDecisionValue
  confidence?: number
  applied: boolean
}): Promise<void> {
  await safeQuery(
    `INSERT INTO research.llm_decisions
       (symbol, context_summary, model, raw_response, decision, confidence, applied)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.symbol,
      JSON.stringify(input.contextSummary),
      input.model,
      input.rawResponse ?? null,
      input.decision,
      input.confidence ?? null,
      input.applied,
    ],
  )
}

/** For tests/admin scripts only — closes the pool so a process can exit cleanly. */
export async function closeResearchPool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = undefined
  }
}
