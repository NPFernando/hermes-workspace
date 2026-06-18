import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import YAML from 'yaml'
import { getGrowthLevel, getGrowthLog } from './sisters-growth'

export type SisterType = 'ai_sister' | 'business_agent' | 'delegation_profile'

export type Sister = {
  id: string
  name: string
  emoji: string
  description: string
  model?: string
  modelPreference?: string
  role: string
  type: SisterType
  profilePath: string
  hasProfile: boolean
  isLive: boolean
  systemPrompt?: string
  priority?: number
  handoffTo?: string
  // Growth / self-improvement fields
  growthLevel?: number
  growthLabel?: string
  growthEmoji?: string
  growthEntryCount?: number
  lastNote?: string
}

function getHermesRoot(): string {
  return (
    process.env.HERMES_HOME ??
    process.env.CLAUDE_HOME ??
    path.join(os.homedir(), '.hermes')
  )
}

function safeParseYaml(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {}
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = YAML.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

// Role → emoji defaults
const ROLE_EMOJIS: Record<string, string> = {
  orchestrator: '🌟',
  main: '🌟',
  researcher: '🔬',
  coder: '💻',
  builder: '🔨',
  reviewer: '👁️',
  local: '🏠',
  vision: '📸',
  legal: '⚖️',
  sac: '📋',
  sales: '💼',
  monitor: '📡',
  creative: '🎨',
  ops: '⚙️',
  default: '🤖',
}

function emojiForRole(role: string, fallbackEmoji?: string): string {
  if (fallbackEmoji) return fallbackEmoji
  return ROLE_EMOJIS[role.toLowerCase()] ?? ROLE_EMOJIS.default
}

// Model preference → display tier
export function tierLabel(modelPreference?: string): string {
  if (!modelPreference) return 'any'
  if (modelPreference.startsWith('local:')) return 'local'
  if (modelPreference.includes(':free')) return 'free'
  if (modelPreference.includes(':paid')) return 'paid'
  return modelPreference
}

// Color for badge UI rendering
export const SISTER_COLORS: Partial<Record<string, { bg: string; text: string; border: string }>> = {
  astra:      { bg: 'bg-violet-500/15',  text: 'text-violet-400',  border: 'border-violet-400/30' },
  novus:      { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-400/30' },
  nova:       { bg: 'bg-sky-500/15',     text: 'text-sky-400',     border: 'border-sky-400/30' },
  researcher: { bg: 'bg-sky-500/15',     text: 'text-sky-400',     border: 'border-sky-400/30' },
  coder:      { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-400/30' },
  business:   { bg: 'bg-amber-500/15',   text: 'text-amber-400',   border: 'border-amber-400/30' },
  default:    { bg: 'bg-primary-500/10', text: 'text-primary-400', border: 'border-primary-300/20' },
}

export function colorForSister(id: string, type: SisterType) {
  if (SISTER_COLORS[id]) return SISTER_COLORS[id]
  if (type === 'business_agent') return SISTER_COLORS.business
  return SISTER_COLORS.default
}

// Map swarm worker roles to sister personalities
export const WORKER_ROLE_TO_SISTER: Record<string, string> = {
  orchestrator: 'astra',
  'km-agent':   'astra',
  strategist:   'astra',
  'ops-watch':  'astra',
  'inbox-triage': 'astra',
  researcher:   'nova',
  reviewer:     'nova',
  builder:      'novus',
  qa:           'novus',
  maintainer:   'novus',
  docs:         'nova',
}

// Astra IS the default profile — its path is ~/.hermes/ itself, not a subdir.
// The workspace profiles-browser always synthesizes it from config.yaml at root.
const ASTRA_IS_DEFAULT = true

function getProfilePath(hermesRoot: string, id: string): string {
  if (id === 'astra') return hermesRoot
  return path.join(hermesRoot, 'profiles', id)
}

function checkProfileLive(profilePath: string, id?: string): { hasProfile: boolean; isLive: boolean } {
  if (id === 'astra') {
    // Astra's "profile" is always live — it IS the root hermes config
    return { hasProfile: true, isLive: true }
  }
  const hasProfile = fs.existsSync(profilePath)
  if (!hasProfile) return { hasProfile: false, isLive: false }
  const configPath = path.join(profilePath, 'config.yaml')
  return { hasProfile: true, isLive: fs.existsSync(configPath) }
}

// ── Source readers ──────────────────────────────────────────────────────────

function readAiSisters(hermesRoot: string): Array<Sister> {
  const sistersYaml = safeParseYaml(path.join(hermesRoot, 'config', 'sisters.yaml'))
  const raw = sistersYaml.sisters

  // sisters.yaml may use list format [{id, name, ...}] or dict format {id: {...}}
  let entries: Array<[string, Record<string, unknown>]>
  if (Array.isArray(raw)) {
    entries = raw
      .filter((item): item is Record<string, unknown> => item && typeof item === 'object' && !Array.isArray(item))
      .filter((item) => typeof item.id === 'string' && item.id)
      .map((item) => [item.id as string, item])
  } else {
    entries = Object.entries(obj(raw)).map(([k, v]) => [k, obj(v)])
  }

  const result: Array<Sister> = []

  for (const [id, entry_] of entries) {
    const entry = obj(entry_)
    if (entry.enabled === false) continue
    const profilePath = getProfilePath(hermesRoot, id)
    const { hasProfile, isLive } = checkProfileLive(profilePath, id)
    const role = str(entry.role) || (id === 'astra' ? 'orchestrator' : id === 'novus' ? 'builder' : id === 'nova' ? 'researcher' : 'assistant')
    result.push({
      id,
      name: str(entry.name) || (id.charAt(0).toUpperCase() + id.slice(1)),
      emoji: str(entry.emoji) || emojiForRole(role),
      description: str(entry.description),
      model: str(entry.model) || undefined,
      modelPreference: str(entry.model_preference) || undefined,
      role,
      type: 'ai_sister',
      profilePath,
      hasProfile,
      isLive,
      systemPrompt: str(entry.system_prompt) || undefined,
      priority: typeof entry.priority === 'number' ? entry.priority : undefined,
    })
  }

  // Sort by priority
  result.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
  return result
}

function readBusinessAgents(hermesRoot: string): Array<Sister> {
  const sistersYaml = safeParseYaml(path.join(hermesRoot, 'config', 'sisters.yaml'))
  const businessMap = obj(sistersYaml.business_agents)
  const result: Array<Sister> = []

  for (const [id, raw] of Object.entries(businessMap)) {
    const entry = obj(raw)
    if (entry.enabled === false) continue
    const profilePath = getProfilePath(hermesRoot, id)
    const { hasProfile, isLive } = checkProfileLive(profilePath)
    const role = str(entry.role) || 'business'
    result.push({
      id,
      name: str(entry.name) || id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      emoji: str(entry.emoji) || emojiForRole(role),
      description: str(entry.description),
      role,
      type: 'business_agent',
      profilePath,
      hasProfile,
      isLive,
      handoffTo: str(entry.handoff_to) || undefined,
    })
  }

  return result
}

function readDelegationProfiles(hermesRoot: string): Array<Sister> {
  const profilesYaml = safeParseYaml(path.join(hermesRoot, 'sister_profiles.yaml'))
  const result: Array<Sister> = []

  for (const [id, raw] of Object.entries(profilesYaml)) {
    const entry = obj(raw)
    if (id.startsWith('#') || entry.enabled === false) continue
    const profilePath = getProfilePath(hermesRoot, id)
    const { hasProfile, isLive } = checkProfileLive(profilePath)
    const overrides = obj(entry.config_overrides)
    const profileRole = str(entry.role) || id
    result.push({
      id,
      name: str(entry.name) || (id.charAt(0).toUpperCase() + id.slice(1)),
      emoji: str(entry.emoji) || emojiForRole(profileRole),
      description: str(entry.description),
      model: str(overrides.model) || undefined,
      role: profileRole,
      type: 'delegation_profile',
      profilePath,
      hasProfile,
      isLive,
    })
  }

  return result
}

// ── Public API ──────────────────────────────────────────────────────────────

let _cached: Array<Sister> | null = null
let _cachedAt = 0
const CACHE_TTL = 30_000

export function listSisters(skipCache = false): Array<Sister> {
  const now = Date.now()
  if (!skipCache && _cached && now - _cachedAt < CACHE_TTL) return _cached

  const hermesRoot = getHermesRoot()
  const ai = readAiSisters(hermesRoot)
  const delegation = readDelegationProfiles(hermesRoot)
  const business = readBusinessAgents(hermesRoot)

  // De-duplicate: AI sisters take priority over delegation profiles with same id
  const seen = new Set<string>()
  const deduped: Array<Sister> = []
  for (const s of [...ai, ...delegation, ...business]) {
    if (!seen.has(s.id)) {
      seen.add(s.id)
      deduped.push(s)
    }
  }

  // Attach growth level (filesystem reads — tolerate errors)
  const result = deduped.map((s) => {
    try {
      const gl = getGrowthLevel(s.id)
      const lastEntry = gl.entryCount > 0
        ? (getGrowthLog(s.id, 1)[0]?.content.slice(0, 120) ?? undefined)
        : undefined
      return {
        ...s,
        growthLevel: gl.level,
        growthLabel: gl.label,
        growthEmoji: gl.emoji,
        growthEntryCount: gl.entryCount,
        lastNote: lastEntry,
      }
    } catch {
      return s
    }
  })

  _cached = result
  _cachedAt = now
  return result
}

export function getSisterById(id: string): Sister | undefined {
  return listSisters().find((s) => s.id === id)
}

export function invalidateSistersCache(): void {
  _cached = null
  _cachedAt = 0
}

// ── Profile bootstrap ───────────────────────────────────────────────────────

function buildProfileConfig(sister: Sister): string {
  const config: Record<string, unknown> = {
    description: sister.description || `${sister.name} — ${sister.role}`,
  }
  if (sister.model) config.model = sister.model
  if (sister.systemPrompt) config.system_prompt = sister.systemPrompt

  const display: Record<string, unknown> = {
    emoji: sister.emoji,
    role: sister.role,
    type: sister.type,
  }
  if (sister.modelPreference) display.model_preference = sister.modelPreference
  if (sister.handoffTo) display.handoff_to = sister.handoffTo
  config.display = display

  return YAML.stringify(config)
}

export function ensureSisterProfile(sister: Sister): void {
  // Astra IS the default profile (root ~/.hermes/). Never create a subdir for it —
  // that would produce a duplicate entry in the profiles list.
  if (sister.id === 'astra') return

  const { profilePath } = sister
  if (!fs.existsSync(profilePath)) {
    fs.mkdirSync(profilePath, { recursive: true })
  }
  const configPath = path.join(profilePath, 'config.yaml')
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, buildProfileConfig(sister), 'utf-8')
  }
}

export function bootstrapAllSisters(): void {
  const sisters = listSisters(true)
  for (const sister of sisters) {
    try {
      ensureSisterProfile(sister)
    } catch {
      // Non-fatal — log but continue
    }
  }
  invalidateSistersCache()
}

let _bootstrapped = false

export function bootstrapOnceLazy(): void {
  if (_bootstrapped) return
  _bootstrapped = true
  try {
    bootstrapAllSisters()
  } catch {
    // Non-fatal — don't block the request
  }
}
