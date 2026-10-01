import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { personaName } from './agent-personas'

/** One row of harp-route-stats-v1 `routes`. */
export type HarpRouteStatsRow = {
  task_family: string
  provider: string
  model: string
  n: number
  success: number
  failure: number
  escalated: number
  success_rate: number
  demoted: boolean
  /** Optional (1.1.0): how many of n were observed (shadow-mode) outcomes. */
  observed: number
  /** Optional (1.2.0): personas whose outcomes fed this route. */
  agents: Array<string>
}

/** harp-route-stats-v1: outcome learning aggregates from `harp route stats --json`. */
export type HarpRouteStats = {
  window_days: number
  outcomes: number
  min_samples: number
  demote_below: number
  routes: Array<HarpRouteStatsRow>
  classifier: { agreed: number; corrected: number; accuracy: number | null }
  /** Optional in the contract: planned routes in the window and how many reported back. */
  coverage: HarpRouteCoverage | null
}

export type HarpRouteCoverage = {
  plans: number
  reported: number
  rate: number | null
  by_host: Array<{ host: string; plans: number; reported: number }>
  /** Optional (1.2.0): per persona, old agent names folded in; most plans first. */
  by_agent: Array<{ agent: string; plans: number; reported: number }>
}

const STATS_TIMEOUT_MS = 15_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isRate(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 1
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function parseAgents(value: unknown): Array<string> | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every(isName)) return null
  return [...new Set(value.map(personaName))].sort()
}

function parseRow(value: unknown): HarpRouteStatsRow | null {
  if (!isRecord(value)) return null
  const { task_family, provider, model, n, success, failure, escalated } = value
  if (!isName(task_family) || !isName(provider) || !isName(model)) return null
  if (![n, success, failure, escalated].every(isCount)) return null
  if (!isRate(value.success_rate) || typeof value.demoted !== 'boolean')
    return null
  const observed = value.observed ?? 0
  const agents = parseAgents(value.agents)
  if (!isCount(observed) || !agents) return null
  return {
    task_family,
    provider,
    model,
    n: n as number,
    success: success as number,
    failure: failure as number,
    escalated: escalated as number,
    success_rate: value.success_rate,
    demoted: value.demoted,
    observed,
    agents,
  }
}

function parseCoverage(value: unknown): HarpRouteCoverage | null {
  if (!isRecord(value)) return null
  const { plans, reported, rate } = value
  if (!isCount(plans) || !isCount(reported)) return null
  if (rate !== null && !isRate(rate)) return null
  if (!Array.isArray(value.by_host)) return null
  const byHost: HarpRouteCoverage['by_host'] = []
  for (const raw of value.by_host) {
    if (!isRecord(raw) || !isName(raw.host)) return null
    if (!isCount(raw.plans) || !isCount(raw.reported)) return null
    byHost.push({ host: raw.host, plans: raw.plans, reported: raw.reported })
  }
  const byAgent = new Map<string, { plans: number; reported: number }>()
  const rawAgents = value.by_agent ?? []
  if (!Array.isArray(rawAgents)) return null
  for (const raw of rawAgents) {
    if (!isRecord(raw) || !isName(raw.agent)) return null
    if (!isCount(raw.plans) || !isCount(raw.reported)) return null
    const agent = personaName(raw.agent)
    const row = byAgent.get(agent) ?? { plans: 0, reported: 0 }
    row.plans += raw.plans
    row.reported += raw.reported
    byAgent.set(agent, row)
  }
  return {
    plans,
    reported,
    rate,
    by_host: byHost,
    by_agent: [...byAgent]
      .map(([agent, row]) => ({ agent, ...row }))
      .sort((a, b) => b.plans - a.plans || a.agent.localeCompare(b.agent)),
  }
}

/** Validate a harp-route-stats-v1 payload; null when it does not match the contract. */
export function parseHarpRouteStats(value: unknown): HarpRouteStats | null {
  if (!isRecord(value) || value.contract !== 'harp-route-stats-v1') return null
  const { window_days, outcomes, min_samples, demote_below, classifier } = value
  if (typeof window_days !== 'number' || !isCount(outcomes)) return null
  if (!isCount(min_samples) || !isRate(demote_below)) return null
  if (!Array.isArray(value.routes) || !isRecord(classifier)) return null
  if (!isCount(classifier.agreed) || !isCount(classifier.corrected)) return null
  if (classifier.accuracy !== null && !isRate(classifier.accuracy)) return null
  const routes: Array<HarpRouteStatsRow> = []
  for (const raw of value.routes) {
    const row = parseRow(raw)
    if (!row) return null
    routes.push(row)
  }
  // Weakest first: demoted, then lowest success rate, then most samples.
  routes.sort(
    (a, b) =>
      Number(b.demoted) - Number(a.demoted) ||
      a.success_rate - b.success_rate ||
      b.n - a.n,
  )
  return {
    window_days,
    outcomes,
    min_samples,
    demote_below,
    routes,
    classifier: {
      agreed: classifier.agreed,
      corrected: classifier.corrected,
      accuracy: classifier.accuracy,
    },
    coverage: parseCoverage(value.coverage),
  }
}

/** `HARP_BIN` env, else the uv/pipx-installed `~/.local/bin/harp`, else `harp` on PATH. */
export function resolveHarpBin(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.HARP_BIN?.trim()
  if (override) return override
  const local = join(homedir(), '.local', 'bin', 'harp')
  return existsSync(local) ? local : 'harp'
}

export function clampDays(value: unknown): number {
  const days = Number(value)
  if (!Number.isFinite(days) || days <= 0) return 30
  return Math.min(365, Math.max(1, Math.round(days)))
}

/** Read-only: runs `harp route stats --json --days N` (no network, no token). */
export function loadHarpRouteStats(
  days: number = 30,
  harpBin: string = resolveHarpBin(),
): Promise<HarpRouteStats> {
  return new Promise((resolve, reject) => {
    execFile(
      harpBin,
      ['route', 'stats', '--json', '--days', String(clampDays(days))],
      { timeout: STATS_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(new Error('harp route stats failed'))
          return
        }
        let payload: unknown
        try {
          payload = JSON.parse(stdout)
        } catch {
          reject(new Error('harp route stats returned invalid JSON'))
          return
        }
        const stats = parseHarpRouteStats(payload)
        if (!stats) {
          reject(
            new Error(
              'harp route stats payload does not match harp-route-stats-v1',
            ),
          )
          return
        }
        resolve(stats)
      },
    )
  })
}
