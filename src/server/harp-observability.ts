import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { safeErrorMessage } from './rate-limit'

// ── HARP routing observability ─────────────────────────────────────────────
// Read-only view over what HARP routing has actually been deciding:
//   1. gateway routing telemetry  (~/.local/state/hermes/harp-routing.jsonl)
//   2. route-combo shadow log      (~/.hermes/logs/harp-combo-shadow.log)
//   3. model-discovery status      (Postgres harp.model_discovery_runs + harp.models)
//
// Every source here is append-only or a plain SELECT — this module never runs
// the selector (harp-select-route.py appends a synthetic record to the combo
// shadow log on every invocation, so polling it would pollute source #2) and
// never writes anything.

// ── Path resolution ────────────────────────────────────────────────────────

function routingLogPath(): string {
  if (process.env.HARP_ROUTING_LOG_PATH) return process.env.HARP_ROUTING_LOG_PATH
  const stateHome =
    process.env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state')
  return path.join(stateHome, 'hermes', 'harp-routing.jsonl')
}

function comboShadowLogPath(): string {
  if (process.env.HARP_COMBO_SHADOW_LOG_PATH)
    return process.env.HARP_COMBO_SHADOW_LOG_PATH
  const hermesHome =
    process.env.HERMES_HOME ??
    process.env.CLAUDE_HOME ??
    path.join(os.homedir(), '.hermes')
  return path.join(hermesHome, 'logs', 'harp-combo-shadow.log')
}

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * One line of harp-routing.jsonl. The gateway hook writes two shapes:
 * `selected` rows carry provider/model/tier/fallbackCount; `policy_blocked`
 * rows carry only at/status/task/risk/reason. Everything past task/risk is
 * therefore optional.
 */
export type HarpRoutingDecision = {
  at: string
  status: string
  task: string
  risk: string
  reason?: string
  provider?: string
  model?: string
  tier?: string
  fallbackCount?: number
}

export type HarpComboShadowEntry = {
  ts: string
  task: string
  risk: string
  combo: string
  applied: boolean
  decision: string
  comboWouldSelect?: { provider: string; model: string }
  actual?: { provider: string; model: string }
  stepsSurviving?: number
  stepsFiltered?: number
}

export type HarpDiscoveryStatus = {
  source: 'postgres' | 'none'
  startedAt: string | null
  totalModels: number | null
  newModels: number | null
  removedModels: number | null
  changedModels: number | null
  notes: string | null
  activeModels: number | null
  catalogModels: number | null
  error?: string
}

export type HarpObservabilityView = {
  generatedAt: string
  routingLogPath: string
  comboShadowLogPath: string
  routingLogExists: boolean
  comboShadowLogExists: boolean
  decisions: Array<HarpRoutingDecision>
  decisionSummary: {
    total: number
    selected: number
    policyBlocked: number
    windowFrom: string | null
    windowTo: string | null
  }
  comboShadow: Array<HarpComboShadowEntry>
  discovery: HarpDiscoveryStatus
}

// ── JSONL tail ─────────────────────────────────────────────────────────────

const MAX_SCAN_BYTES = 512 * 1024

/**
 * Return the last `maxLines` parseable JSON objects from a JSONL file, oldest
 * first. Missing file → []. Unparseable lines (including a torn final line from
 * a concurrent append) are skipped.
 */
function tailJsonl(filePath: string, maxLines: number): Array<unknown> {
  let text: string
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return []
    if (stat.size <= MAX_SCAN_BYTES) {
      text = fs.readFileSync(filePath, 'utf8')
    } else {
      const fd = fs.openSync(filePath, 'r')
      try {
        const buf = Buffer.alloc(MAX_SCAN_BYTES)
        fs.readSync(fd, buf, 0, MAX_SCAN_BYTES, stat.size - MAX_SCAN_BYTES)
        text = buf.toString('utf8')
        // Drop the first (probably partial) line after a mid-file seek.
        const nl = text.indexOf('\n')
        if (nl >= 0) text = text.slice(nl + 1)
      } finally {
        fs.closeSync(fd)
      }
    }
  } catch {
    return []
  }

  const out: Array<unknown> = []
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  for (const line of lines.slice(-maxLines)) {
    try {
      out.push(JSON.parse(line))
    } catch {
      // torn / non-JSON line — skip
    }
  }
  return out
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function asOptString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function asOptNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function normalizeDecision(raw: unknown): HarpRoutingDecision | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const at = asString(r.at)
  const status = asString(r.status)
  if (!at || !status) return null
  return {
    at,
    status,
    task: asString(r.task),
    risk: asString(r.risk),
    reason: asOptString(r.reason),
    provider: asOptString(r.provider),
    model: asOptString(r.model),
    tier: asOptString(r.tier),
    fallbackCount: asOptNumber(r.fallback_count),
  }
}

function normalizePair(
  raw: unknown,
): { provider: string; model: string } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const provider = asString(r.provider)
  const model = asString(r.model)
  if (!provider && !model) return undefined
  return { provider, model }
}

function normalizeComboShadow(raw: unknown): HarpComboShadowEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const ts = asString(r.ts)
  const combo = asString(r.combo)
  if (!ts || !combo) return null
  return {
    ts,
    task: asString(r.task),
    risk: asString(r.risk),
    combo,
    applied: r.applied === true,
    decision: asString(r.decision),
    comboWouldSelect: normalizePair(r.combo_would_select),
    actual: normalizePair(r.actual),
    stepsSurviving: asOptNumber(r.steps_surviving),
    stepsFiltered: Array.isArray(r.steps_filtered)
      ? r.steps_filtered.length
      : asOptNumber(r.steps_filtered),
  }
}

// ── Discovery status (Postgres) ────────────────────────────────────────────

// Postgres-first (HARP store went PG-primary 2026-07-08). No SQLite fallback:
// model_discovery_runs never existed in the frozen SQLite file.
function getDiscoveryStatus(): HarpDiscoveryStatus {
  const empty: HarpDiscoveryStatus = {
    source: 'none',
    startedAt: null,
    totalModels: null,
    newModels: null,
    removedModels: null,
    changedModels: null,
    notes: null,
    activeModels: null,
    catalogModels: null,
  }
  const script = `
import json, sys
out = {"source": "none"}
try:
    sys.path.insert(0, "/srv/projects/_hermes-control/scripts")
    import harp_pg
    with harp_pg.connect() as con:
        cur = con.cursor()
        cur.execute("""
            select started_at, total_models, new_models, removed_models,
                   changed_models, notes
            from model_discovery_runs
            order by started_at desc
            limit 1
        """)
        row = cur.fetchone()
        cur.execute("select count(*) filter (where active = 1), count(*) from models")
        counts = cur.fetchone()
    if row:
        out = {
            "source": "postgres",
            "started_at": row[0], "total_models": row[1], "new_models": row[2],
            "removed_models": row[3], "changed_models": row[4], "notes": row[5],
            "active_models": counts[0] if counts else None,
            "catalog_models": counts[1] if counts else None,
        }
except Exception as exc:  # noqa: BLE001
    out = {"source": "none", "error": str(exc)[:300]}
print(json.dumps(out, default=str))
`
  try {
    const raw = execFileSync('python3', ['-c', script], {
      encoding: 'utf8',
      timeout: 8_000,
      maxBuffer: 128 * 1024,
    })
    const p = JSON.parse(raw) as Record<string, unknown>
    if (p.source !== 'postgres') {
      return { ...empty, error: asOptString(p.error) }
    }
    return {
      source: 'postgres',
      startedAt: asOptString(p.started_at) ?? null,
      totalModels: asOptNumber(p.total_models) ?? null,
      newModels: asOptNumber(p.new_models) ?? null,
      removedModels: asOptNumber(p.removed_models) ?? null,
      changedModels: asOptNumber(p.changed_models) ?? null,
      notes: asOptString(p.notes) ?? null,
      activeModels: asOptNumber(p.active_models) ?? null,
      catalogModels: asOptNumber(p.catalog_models) ?? null,
    }
  } catch (err) {
    return { ...empty, error: safeErrorMessage(err).slice(0, 300) }
  }
}

// ── View ───────────────────────────────────────────────────────────────────

const DECISION_TAIL = 40
const COMBO_TAIL = 25

export function getHarpObservabilityView(): HarpObservabilityView {
  const routingLog = routingLogPath()
  const comboLog = comboShadowLogPath()

  const decisions = tailJsonl(routingLog, DECISION_TAIL)
    .map(normalizeDecision)
    .filter((d): d is HarpRoutingDecision => d !== null)
    .reverse() // newest first

  const comboShadow = tailJsonl(comboLog, COMBO_TAIL)
    .map(normalizeComboShadow)
    .filter((c): c is HarpComboShadowEntry => c !== null)
    .reverse() // newest first

  const ats = decisions.map((d) => d.at).sort()

  return {
    generatedAt: new Date().toISOString(),
    routingLogPath: routingLog,
    comboShadowLogPath: comboLog,
    routingLogExists: fs.existsSync(routingLog),
    comboShadowLogExists: fs.existsSync(comboLog),
    decisions,
    decisionSummary: {
      total: decisions.length,
      selected: decisions.filter((d) => d.status === 'selected').length,
      policyBlocked: decisions.filter((d) => d.status === 'policy_blocked')
        .length,
      windowFrom: ats[0] ?? null,
      windowTo: ats[ats.length - 1] ?? null,
    },
    comboShadow,
    discovery: getDiscoveryStatus(),
  }
}
