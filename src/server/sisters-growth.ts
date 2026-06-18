import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import YAML from 'yaml'

export type GrowthEntryType = 'note' | 'description' | 'cron' | 'skill' | 'reflection' | 'improvement'

export type GrowthEntry = {
  ts: number
  type: GrowthEntryType
  content: string
  author?: string
}

export type GrowthLevel = {
  level: number
  label: string
  emoji: string
  entryCount: number
}

// CronJob shape matching ~/.hermes/cron/jobs.json
type HermesCronJob = {
  id: string
  name: string
  prompt: string
  skills: Array<string>
  skill: string | null
  model: string | null
  provider: string | null
  base_url: string | null
  script: string | null
  no_agent: boolean
  context_from: null
  schedule: { kind: 'cron'; expr: string; display: string }
  schedule_display: string
  repeat: { times: number | null; completed: number }
  enabled: boolean
  state: string
  paused_at: string | null
  paused_reason: string | null
  created_at: string
  next_run_at: string | null
  last_run_at: string | null
  last_status: string | null
  last_error: string | null
  last_delivery_error: string | null
  deliver: string
  origin: { platform: string; chat_id: string; chat_name: string | null; thread_id: null } | null
  enabled_toolsets: Array<string> | null
  workdir: string | null
  profile: string | null
}

export type SisterCronRequest = {
  name: string
  schedule: string
  prompt: string
  skills?: Array<string>
  deliver?: string
  toolsets?: Array<string>
  profile?: string
}

const GROWTH_LEVELS: Array<{ label: string; emoji: string; min: number }> = [
  { label: 'Seed',         emoji: '🌱', min: 0  },
  { label: 'Sprout',       emoji: '🌿', min: 1  },
  { label: 'Growing',      emoji: '🌳', min: 6  },
  { label: 'Mature',       emoji: '⭐', min: 16 },
  { label: 'Wise',         emoji: '✨', min: 31 },
  { label: 'Transcendent', emoji: '💫', min: 61 },
]

function getHermesRoot(): string {
  return process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes')
}

function growthLogPath(sisterId: string): string {
  const root = getHermesRoot()
  // Astra's profile IS the hermes root, so her log lives there
  if (sisterId === 'astra') return path.join(root, 'growth.jsonl')
  return path.join(root, 'profiles', sisterId, 'growth.jsonl')
}

export function appendGrowthEntry(
  sisterId: string,
  entry: Omit<GrowthEntry, 'ts'>,
): GrowthEntry {
  const full: GrowthEntry = { ts: Date.now(), ...entry }
  const logPath = growthLogPath(sisterId)
  const dir = path.dirname(logPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.appendFileSync(logPath, JSON.stringify(full) + '\n', 'utf-8')
  return full
}

export function getGrowthLog(sisterId: string, limit = 50): Array<GrowthEntry> {
  const logPath = growthLogPath(sisterId)
  if (!fs.existsSync(logPath)) return []
  try {
    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean)
    const entries = lines
      .map((line) => {
        try { return JSON.parse(line) as GrowthEntry } catch { return null }
      })
      .filter((e): e is GrowthEntry => e !== null)
    return entries.slice(-limit)
  } catch {
    return []
  }
}

export function getGrowthLevel(sisterId: string): GrowthLevel {
  const entries = getGrowthLog(sisterId, 10_000)
  const count = entries.length
  let idx = 0
  for (let i = GROWTH_LEVELS.length - 1; i >= 0; i--) {
    if (count >= GROWTH_LEVELS[i].min) { idx = i; break }
  }
  return {
    level: idx,
    label: GROWTH_LEVELS[idx].label,
    emoji: GROWTH_LEVELS[idx].emoji,
    entryCount: count,
  }
}

export function updateSisterDescription(sisterId: string, description: string): void {
  const root = getHermesRoot()
  // For Astra: write a sidecar rather than touching root config.yaml
  if (sisterId === 'astra') {
    fs.writeFileSync(path.join(root, 'astra_growth_description.txt'), description, 'utf-8')
    return
  }
  const configPath = path.join(root, 'profiles', sisterId, 'config.yaml')
  if (!fs.existsSync(configPath)) return
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    const parsed = YAML.parse(raw) as Record<string, unknown>
    parsed.description = description
    fs.writeFileSync(configPath, YAML.stringify(parsed), 'utf-8')
  } catch {
    // non-fatal
  }
}

// Validate a cron expression (5 or 6 fields, no injection chars)
export function isValidCronExpr(expr: string): boolean {
  if (typeof expr !== 'string') return false
  const clean = expr.trim()
  if (!/^[\d\s/*,\-?LW#]+$/.test(clean)) return false
  const fields = clean.split(/\s+/)
  return fields.length >= 5 && fields.length <= 6
}

export function registerSisterCron(
  sisterId: string,
  req: SisterCronRequest,
): { id: string } {
  const root = getHermesRoot()
  const cronPath = path.join(root, 'cron', 'jobs.json')

  let jobs: Array<HermesCronJob> = []
  if (fs.existsSync(cronPath)) {
    try {
      const raw = fs.readFileSync(cronPath, 'utf-8')
      const parsed = JSON.parse(raw) as { jobs?: Array<HermesCronJob> }
      if (Array.isArray(parsed.jobs)) jobs = parsed.jobs
    } catch {
      // start fresh
    }
  }

  // Prevent duplicate names from same sister
  const dedupName = `sister-${sisterId}:${req.name}`
  if (jobs.some((j) => j.name === dedupName || j.name === req.name)) {
    const existing = jobs.find((j) => j.name === dedupName || j.name === req.name)!
    return { id: existing.id }
  }

  const id = crypto.randomBytes(6).toString('hex')
  const now = new Date().toISOString()

  const newJob: HermesCronJob = {
    id,
    name: dedupName,
    prompt: req.prompt,
    skills: req.skills ?? [],
    skill: req.skills?.[0] ?? null,
    model: null,
    provider: null,
    base_url: null,
    script: null,
    no_agent: false,
    context_from: null,
    schedule: { kind: 'cron', expr: req.schedule, display: req.schedule },
    schedule_display: req.schedule,
    repeat: { times: null, completed: 0 },
    enabled: true,
    state: 'scheduled',
    paused_at: null,
    paused_reason: null,
    created_at: now,
    next_run_at: null,
    last_run_at: null,
    last_status: null,
    last_error: null,
    last_delivery_error: null,
    deliver: req.deliver ?? 'local',
    origin: {
      platform: 'sister_self_improve',
      chat_id: sisterId,
      chat_name: null,
      thread_id: null,
    },
    enabled_toolsets: req.toolsets ?? null,
    workdir: null,
    profile: req.profile ?? sisterId,
  }

  jobs.push(newJob)
  const dir = path.dirname(cronPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    cronPath,
    JSON.stringify({ jobs, updated_at: now }, null, 2),
    'utf-8',
  )
  return { id }
}
