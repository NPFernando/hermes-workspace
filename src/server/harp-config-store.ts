import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import YAML from 'yaml'
import { safeErrorMessage } from './rate-limit'

// ── Path resolution ────────────────────────────────────────────────────────
// Probes standard locations in priority order.
// Override all of these with the HARP_CONFIG_PATH environment variable.

function candidatePaths(): Array<string> {
  const home = os.homedir()
  const hermesHome =
    process.env.HERMES_HOME ??
    process.env.CLAUDE_HOME ??
    path.join(home, '.hermes')
  const openClawHome = process.env.OPENCLAW_HOME ?? path.join(home, '.openclaw')

  return [
    // 1. Explicit env override — highest priority
    process.env.HARP_CONFIG_PATH ?? '',
    // 2. Standard Hermes home location (most common for new setups)
    path.join(hermesHome, 'harp-config.yaml'),
    // 3. OpenClaw home
    path.join(openClawHome, 'harp-config.yaml'),
    // 4. XDG config
    path.join(home, '.config', 'hermes', 'harp-config.yaml'),
    // 5. Legacy / custom control-repo layout
    '/srv/projects/_hermes-control/harp-config.yaml',
    path.join(home, 'hermes-control', 'harp-config.yaml'),
  ].filter(Boolean)
}

function resolveHarpConfigPath(): string {
  for (const candidate of candidatePaths()) {
    if (fs.existsSync(candidate)) return candidate
  }
  // Default write location when creating a fresh config
  const hermesHome =
    process.env.HERMES_HOME ??
    process.env.CLAUDE_HOME ??
    path.join(os.homedir(), '.hermes')
  return (
    process.env.HARP_CONFIG_PATH ?? path.join(hermesHome, 'harp-config.yaml')
  )
}

function getHarpCandidatePaths(): Array<string> {
  return candidatePaths()
}

// ── Types ──────────────────────────────────────────────────────────────────

export type HarpTierModel = {
  model: string
  role: string
  provider?: string
  notes?: string
  bin?: string
  command?: string
  skill?: string
  tier?: string
}

export type HarpTier = {
  key:
    | 'tier1_free'
    | 'tier2_paid'
    | 'tier3_codex'
    | 'tier4_gemini'
    | 'tier5_local'
  label: string
  provider: string
  trigger: unknown
  models: Array<HarpTierModel>
  base_url?: string
  key_env?: string
  setup_instructions?: string
}

export type HarpBlocklistEntry = {
  model: string
  reason: string
}

export type HarpGlobalSettings = {
  enabled: boolean
  mode: string
  auto_route: boolean
  route_delegation_only: boolean
  allow_paid_benchmarking: boolean
  paid_benchmark_daily_cap_usd: number
  require_paid_final_review_for_production: boolean
}

export type HarpAutoImprove = {
  enabled: boolean
  script: string
  trigger: unknown
  min_evals_to_rank: number
  report_dir: string
  deliver: string
  notes?: string
}

export type HarpConfig = {
  harp_vm: HarpGlobalSettings
  routing: {
    strategy: string
    free_first: boolean
    tier1_free: {
      provider: string
      trigger: unknown
      models: Array<HarpTierModel>
    }
    tier2_paid: {
      provider: string
      trigger: unknown
      models: Array<HarpTierModel>
    }
    tier3_codex?: {
      provider: string
      trigger: unknown
      models: Array<HarpTierModel>
      auth_check?: string
      setup_instructions?: string
    }
    tier4_gemini?: {
      provider: string
      trigger: unknown
      models: Array<HarpTierModel>
      base_url?: string
      key_env?: string
      setup_instructions?: string
    }
    tier5_local?: {
      provider: string
      trigger: unknown
      model?: string
      base_url?: string
    }
  }
  routing_blocklist: Array<HarpBlocklistEntry>
  auto_improve: HarpAutoImprove
  [key: string]: unknown
}

// ── Read ───────────────────────────────────────────────────────────────────

function readHarpConfig(): HarpConfig | null {
  const configPath = resolveHarpConfigPath()
  try {
    if (!fs.existsSync(configPath)) return null
    const raw = fs.readFileSync(configPath, 'utf-8')
    return YAML.parse(raw) as HarpConfig
  } catch {
    return null
  }
}

// ── Write ──────────────────────────────────────────────────────────────────

function writeHarpConfig(config: HarpConfig): void {
  const configPath = resolveHarpConfigPath()
  const raw = YAML.stringify(config, { lineWidth: 120 })
  fs.writeFileSync(configPath, raw, 'utf-8')
}

// ── Patch Actions ──────────────────────────────────────────────────────────

export type HarpPatchSetGlobal = {
  action: 'set-global'
  field: keyof HarpGlobalSettings
  value: unknown
}

export type HarpPatchReorderTierModels = {
  action: 'reorder-tier-models'
  tier: 'tier1_free' | 'tier2_paid'
  models: Array<HarpTierModel>
}

export type HarpPatchAddTierModel = {
  action: 'add-tier-model'
  tier: 'tier1_free' | 'tier2_paid'
  model: HarpTierModel
}

export type HarpPatchRemoveTierModel = {
  action: 'remove-tier-model'
  tier: 'tier1_free' | 'tier2_paid'
  modelId: string
}

export type HarpPatchAddBlocklist = {
  action: 'add-blocklist'
  entry: HarpBlocklistEntry
}

export type HarpPatchRemoveBlocklist = {
  action: 'remove-blocklist'
  modelId: string
}

export type HarpPatchSetAutoImprove = {
  action: 'set-auto-improve'
  field: keyof HarpAutoImprove
  value: unknown
}

export type HarpPatch =
  | HarpPatchSetGlobal
  | HarpPatchReorderTierModels
  | HarpPatchAddTierModel
  | HarpPatchRemoveTierModel
  | HarpPatchAddBlocklist
  | HarpPatchRemoveBlocklist
  | HarpPatchSetAutoImprove

export type HarpPatchResult = { ok: boolean; error?: string }

export function applyHarpPatch(patch: HarpPatch): HarpPatchResult {
  const config = readHarpConfig()
  if (!config) {
    return { ok: false, error: 'HARP config file not found or unreadable' }
  }

  try {
    switch (patch.action) {
      case 'set-global': {
        const hv = config.harp_vm as Record<string, unknown>
        hv[patch.field] = patch.value
        break
      }

      case 'reorder-tier-models': {
        config.routing[patch.tier].models = patch.models
        break
      }

      case 'add-tier-model': {
        config.routing[patch.tier].models.push(patch.model)
        break
      }

      case 'remove-tier-model': {
        config.routing[patch.tier].models = config.routing[
          patch.tier
        ].models.filter((m) => m.model !== patch.modelId)
        break
      }

      case 'add-blocklist': {
        const exists = config.routing_blocklist.some(
          (e) => e.model === patch.entry.model,
        )
        if (!exists) {
          config.routing_blocklist.push(patch.entry)
        }
        break
      }

      case 'remove-blocklist': {
        config.routing_blocklist = config.routing_blocklist.filter(
          (e) => e.model !== patch.modelId,
        )
        break
      }

      case 'set-auto-improve': {
        const ai = config.auto_improve as Record<string, unknown>
        ai[patch.field] = patch.value
        break
      }
    }

    writeHarpConfig(config)
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: safeErrorMessage(err),
    }
  }
}

// ── Starter config ─────────────────────────────────────────────────────────

export function createStarterHarpConfig(): HarpPatchResult {
  const configPath = resolveHarpConfigPath()
  if (fs.existsSync(configPath))
    return { ok: false, error: 'Config already exists' }
  const starter: HarpConfig = {
    harp_vm: {
      enabled: true,
      mode: 'tiered_with_degradation',
      auto_route: true,
      route_delegation_only: false,
      allow_paid_benchmarking: false,
      paid_benchmark_daily_cap_usd: 0.1,
      require_paid_final_review_for_production: false,
    },
    routing: {
      strategy: 'tiered_with_degradation',
      free_first: true,
      tier1_free: {
        provider: 'openrouter',
        trigger: 'always',
        models: [
          { model: 'nvidia/nemotron-3-super-120b-a12b:free', role: 'primary' },
          { model: 'google/gemma-4-31b-it:free', role: 'fallback' },
        ],
      },
      tier2_paid: {
        provider: 'openrouter',
        trigger: ['tier1_exhausted', 'tier1_unavailable'],
        models: [
          {
            model: 'deepseek/deepseek-v4-pro',
            provider: 'openrouter',
            role: 'primary',
          },
        ],
      },
    },
    routing_blocklist: [],
    auto_improve: {
      enabled: false,
      script: '',
      trigger: [],
      min_evals_to_rank: 3,
      report_dir: '',
      deliver: '',
    },
  }
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    writeHarpConfig(starter)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: safeErrorMessage(err) }
  }
}

// ── Serialised view for the UI ─────────────────────────────────────────────

export type HarpHealthAttempt = {
  modelId: string
  attempts: number
  successes: number
  failures: number
  rateLimitCount: number
  cooldownUntil: string | null
  cooldownReason: string | null
  lastFailureAt: string | null
  lastSuccessAt: string | null
}

export type HarpHealthRoute = {
  provider: string
  model: string
  tier: string
  role: string
  score: number | null
  status: 'ready' | 'cooldown' | 'dead_catalog'
}

export type HarpHealthView = {
  generatedAt: string
  dbPath: string
  routeDecision: string
  routeReason: string
  primaryProvider: string
  primaryModel: string
  cooldowns: Array<HarpHealthAttempt>
  deadCatalogModels: Array<string>
  routes: Array<HarpHealthRoute>
  openrouterCredits: string
}

export type HarpConfigView = {
  available: boolean
  configPath: string
  candidatePaths: Array<string>
  global: HarpGlobalSettings
  tiers: Array<HarpTier>
  blocklist: Array<HarpBlocklistEntry>
  autoImprove: HarpAutoImprove
  health?: HarpHealthView
}

const TIER_META: Record<string, { label: string }> = {
  tier1_free: { label: 'Tier 1 — OpenRouter Free' },
  tier2_paid: { label: 'Tier 2 — Paid / Claude CLI' },
  tier3_codex: { label: 'Tier 3 — OpenAI Codex' },
  tier4_gemini: { label: 'Tier 4 — Gemini Free' },
  tier5_local: { label: 'Tier 5 — Local Ollama' },
}

function runTextCommand(
  command: string,
  args: Array<string>,
  timeout = 8_000,
): string {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      timeout,
      maxBuffer: 256 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    return safeErrorMessage(error).slice(0, 500)
  }
}

function getOpenRouterCreditsSummary(): string {
  const script = path.join(
    os.homedir(),
    '.hermes',
    'scripts',
    'openrouter_credits_check.sh',
  )
  if (!fs.existsSync(script)) return 'OpenRouter credit checker not found'
  return runTextCommand(script, [], 10_000)
    .replace(/(sk-or-v1-)[A-Za-z0-9_-]+/g, '$1[REDACTED]')
    .replace(/"user_id"\s*:\s*"[^"]+"/g, '"user_id":"REDACTED"')
}

interface RuntimeCooldownResult {
  source: string
  cooldowns: Array<HarpHealthAttempt>
}

// Reads live cooldown state Postgres-first (the HARP store went PG-primary on
// this machine 2026-07-08; the SQLite file is frozen and stale), falling back
// to the SQLite path so the feature still works on stock installs.
function getRuntimeCooldowns(dbPath: string): RuntimeCooldownResult {
  const script = `
import json, os, sys
from datetime import datetime, timezone
now = datetime.now(timezone.utc).isoformat()
sql = """
  select model_id, attempts, successes, failures, rate_limit_count,
         cooldown_until, cooldown_reason, last_failure_at, last_success_at
  from model_runtime_state
  where cooldown_until is not null and cooldown_until != '' and cooldown_until > ?
  order by cooldown_until desc
  limit 20
"""
rows, source = [], "none"
try:
    sys.path.insert(0, "/srv/projects/_hermes-control/scripts")
    import harp_pg
    with harp_pg.connect() as con:
        cur = con.cursor()
        cur.execute(sql, (now,))
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        source = "postgres"
except Exception:
    import sqlite3
    path = sys.argv[1]
    if os.path.exists(path):
        con = sqlite3.connect(path)
        con.row_factory = sqlite3.Row
        rows = [dict(r) for r in con.execute(sql, (now,)).fetchall()]
        source = "sqlite"
print(json.dumps({"source": source, "rows": rows}, default=str))
`
  try {
    const raw = execFileSync('python3', ['-c', script, dbPath], {
      encoding: 'utf8',
      timeout: 8_000,
      maxBuffer: 128 * 1024,
    })
    const parsed = JSON.parse(raw) as {
      source?: unknown
      rows?: Array<Record<string, unknown>>
    }
    const source = String(parsed.source ?? 'none')
    const rows = parsed.rows ?? []
    return {
      source,
      cooldowns: rows
        .map((row) => ({
          modelId: String(row.model_id ?? ''),
          attempts: Number(row.attempts ?? 0),
          successes: Number(row.successes ?? 0),
          failures: Number(row.failures ?? 0),
          rateLimitCount: Number(row.rate_limit_count ?? 0),
          cooldownUntil:
            typeof row.cooldown_until === 'string' ? row.cooldown_until : null,
          cooldownReason:
            typeof row.cooldown_reason === 'string'
              ? row.cooldown_reason
              : null,
          lastFailureAt:
            typeof row.last_failure_at === 'string'
              ? row.last_failure_at
              : null,
          lastSuccessAt:
            typeof row.last_success_at === 'string'
              ? row.last_success_at
              : null,
        }))
        .filter((row) => row.modelId.length > 0),
    }
  } catch {
    return { source: 'none', cooldowns: [] }
  }
}

function getRouteHealth(
  cooldowns: Array<HarpHealthAttempt>,
): Pick<
  HarpHealthView,
  | 'routeDecision'
  | 'routeReason'
  | 'primaryProvider'
  | 'primaryModel'
  | 'routes'
  | 'deadCatalogModels'
> {
  const selector =
    '/home/ubuntu/workspace/projects/universal-harp-engine/scripts/harp-select-route.py'
  if (!fs.existsSync(selector)) {
    return {
      routeDecision: 'unavailable',
      routeReason: 'harp-select-route.py not found',
      primaryProvider: '',
      primaryModel: '',
      routes: [],
      deadCatalogModels: [],
    }
  }
  try {
    const raw = execFileSync(
      'python3',
      [selector, '--task', 'debugging', '--risk', 'complex', '--json'],
      {
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 256 * 1024,
      },
    )
    const parsed = JSON.parse(raw) as {
      decision?: unknown
      reason?: unknown
      provider?: unknown
      model?: unknown
      routes?: Array<Record<string, unknown>>
    }
    const cooldownByModel = new Set(cooldowns.map((item) => item.modelId))
    const routes = (parsed.routes ?? []).slice(0, 12).map((route) => {
      const model = String(route.model ?? '')
      const role = String(route.role ?? '')
      const status =
        role === 'reserve_free'
          ? 'dead_catalog'
          : cooldownByModel.has(model)
            ? 'cooldown'
            : 'ready'
      return {
        provider: String(route.provider ?? ''),
        model,
        tier: String(route.tier ?? ''),
        role,
        score: typeof route.score === 'number' ? route.score : null,
        status,
      } satisfies HarpHealthRoute
    })
    return {
      routeDecision: String(parsed.decision ?? ''),
      routeReason: String(parsed.reason ?? ''),
      primaryProvider: String(parsed.provider ?? ''),
      primaryModel: String(parsed.model ?? ''),
      routes,
      deadCatalogModels: routes
        .filter((route) => route.status === 'dead_catalog')
        .map((route) => route.model),
    }
  } catch (error) {
    return {
      routeDecision: 'error',
      routeReason: safeErrorMessage(error).slice(0, 500),
      primaryProvider: '',
      primaryModel: '',
      routes: [],
      deadCatalogModels: [],
    }
  }
}

function getHarpHealthView(): HarpHealthView {
  const sqlitePath = path.join(os.homedir(), '.hermes', 'harp-routing-state.db')
  const { source, cooldowns } = getRuntimeCooldowns(sqlitePath)
  const routeHealth = getRouteHealth(cooldowns)
  return {
    generatedAt: new Date().toISOString(),
    dbPath:
      source === 'postgres'
        ? 'postgresql://127.0.0.1:5432/harp (model_runtime_state)'
        : sqlitePath,
    ...routeHealth,
    cooldowns,
    openrouterCredits: getOpenRouterCreditsSummary(),
  }
}

export function getHarpConfigView(): HarpConfigView {
  const configPath = resolveHarpConfigPath()
  const config = readHarpConfig()

  if (!config) {
    return {
      available: false,
      configPath,
      candidatePaths: getHarpCandidatePaths(),
      global: {
        enabled: false,
        mode: 'tiered_with_degradation',
        auto_route: false,
        route_delegation_only: false,
        allow_paid_benchmarking: false,
        paid_benchmark_daily_cap_usd: 0.1,
        require_paid_final_review_for_production: false,
      },
      tiers: [],
      blocklist: [],
      autoImprove: {
        enabled: false,
        script: '',
        trigger: [],
        min_evals_to_rank: 3,
        report_dir: '',
        deliver: '',
      },
    }
  }

  const tierKeys = [
    'tier1_free',
    'tier2_paid',
    'tier3_codex',
    'tier4_gemini',
    'tier5_local',
  ] as const
  const tiers: Array<HarpTier> = tierKeys
    .filter((k) => k in config.routing)
    .map((k) => {
      const raw = config.routing[k] as Record<string, unknown>
      return {
        key: k,
        label: TIER_META[k].label,
        provider: String(raw.provider ?? ''),
        trigger: (raw.trigger ?? []) as Array<unknown>,
        models:
          (raw.models as Array<HarpTierModel> | undefined) ??
          (raw.model ? [{ model: String(raw.model), role: 'primary' }] : []),
        base_url: raw.base_url as string | undefined,
        key_env: raw.key_env as string | undefined,
        setup_instructions: raw.setup_instructions as string | undefined,
      }
    })

  return {
    available: true,
    configPath,
    candidatePaths: getHarpCandidatePaths(),
    global: config.harp_vm,
    tiers,
    blocklist: config.routing_blocklist,
    autoImprove: config.auto_improve,
    health: getHarpHealthView(),
  }
}
