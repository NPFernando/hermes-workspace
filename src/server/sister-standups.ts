import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getHermesRoot } from './claude-paths'
import { listSisters, type Sister } from './sisters-registry'
import { listTasks, type ActivityEntry, type TaskRecord } from './tasks-store'

export type SisterStandupEntry = {
  id: string
  date: string
  agentId: string
  agentName: string
  emoji: string
  role: string
  timestamp: number
  yesterday: string
  today: string
  blockers: string
  summary: string
}

type StandupFile = {
  lastRunDate?: string
  standups: Array<SisterStandupEntry>
}

type StandupConfig = {
  enabled?: boolean
  time?: string
}

type BuildStandupInput = {
  sister: Sister
  tasks: Array<TaskRecord>
  now: Date
}

const STANDUPS_FILE = 'operations-standups.json'
const STANDUPS_CONFIG_FILE = 'operations-standups.config.json'
const MAX_STANDUPS = 500
const DEFAULT_STANDUP_TIME = '09:00'

let schedulerStarted = false
let schedulerTimer: NodeJS.Timeout | null = null
let schedulerLastCheckDate = ''

function standupsPath(): string {
  return path.join(getHermesRoot(), STANDUPS_FILE)
}

function configPath(): string {
  return path.join(getHermesRoot(), STANDUPS_CONFIG_FILE)
}

function ensureRoot(): void {
  fs.mkdirSync(getHermesRoot(), { recursive: true })
}

function readStandupFile(): StandupFile {
  ensureRoot()
  const filePath = standupsPath()
  if (!fs.existsSync(filePath)) return { standups: [] }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<StandupFile>
    return {
      lastRunDate: typeof parsed.lastRunDate === 'string' ? parsed.lastRunDate : undefined,
      standups: Array.isArray(parsed.standups)
        ? parsed.standups.filter(isStandupEntry)
        : [],
    }
  } catch {
    return { standups: [] }
  }
}

function writeStandupFile(file: StandupFile): void {
  ensureRoot()
  const next: StandupFile = {
    lastRunDate: file.lastRunDate,
    standups: [...file.standups]
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, MAX_STANDUPS),
  }
  const filePath = standupsPath()
  const tmpPath = `${filePath}.tmp`
  fs.writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8')
  fs.renameSync(tmpPath, filePath)
}

function readConfig(): Required<StandupConfig> {
  let config: StandupConfig = {}
  const filePath = configPath()
  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StandupConfig
      if (parsed && typeof parsed === 'object') config = parsed
    } catch {
      config = {}
    }
  }

  const envEnabled = process.env.HERMES_STANDUP_ENABLED?.trim().toLowerCase()
  const enabled =
    envEnabled === '0' || envEnabled === 'false' || envEnabled === 'off'
      ? false
      : config.enabled !== false
  const time = sanitizeStandupTime(process.env.HERMES_STANDUP_TIME || config.time)

  return { enabled, time }
}

function sanitizeStandupTime(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_STANDUP_TIME
  const trimmed = value.trim()
  return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : DEFAULT_STANDUP_TIME
}

function isStandupEntry(value: unknown): value is SisterStandupEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Partial<Record<keyof SisterStandupEntry, unknown>>
  return (
    typeof row.id === 'string' &&
    typeof row.date === 'string' &&
    typeof row.agentId === 'string' &&
    typeof row.agentName === 'string' &&
    typeof row.timestamp === 'number' &&
    typeof row.summary === 'string'
  )
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatLocalTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function sisterAliases(sister: Sister): Set<string> {
  const aliases = new Set(
    [sister.id, sister.name, sister.role]
      .map(normalize)
      .filter(Boolean),
  )
  if (sister.id === 'astra') aliases.add('default')
  return aliases
}

function activityBelongsToSister(entry: ActivityEntry, aliases: Set<string>): boolean {
  return aliases.has(normalize(entry.by))
}

function taskBelongsToSister(task: TaskRecord, sister: Sister, aliases: Set<string>): boolean {
  if (task.assignee && aliases.has(normalize(task.assignee))) return true
  if (!task.assignee && (sister.id === 'astra' || aliases.has('default'))) return true
  return (task.agent_history ?? []).some((entry) => activityBelongsToSister(entry, aliases))
}

function titleList(tasks: Array<TaskRecord>, fallback: string): string {
  const titles = tasks
    .map((task) => task.title.trim())
    .filter(Boolean)
    .slice(0, 3)
  if (titles.length === 0) return fallback
  return titles.join('; ')
}

function hasRecentCompletion(task: TaskRecord, aliases: Set<string>, sinceMs: number): boolean {
  if (task.column === 'done' && Date.parse(task.updated_at) >= sinceMs) return true
  return (task.agent_history ?? []).some((entry) => {
    if (!activityBelongsToSister(entry, aliases)) return false
    if (Date.parse(entry.at) < sinceMs) return false
    return ['completed', 'done', 'deployed'].includes(normalize(entry.action))
  })
}

export function buildSisterStandupEntry({
  sister,
  tasks,
  now,
}: BuildStandupInput): SisterStandupEntry {
  const aliases = sisterAliases(sister)
  const dayAgoMs = now.getTime() - 24 * 60 * 60 * 1000
  const ownedTasks = tasks.filter((task) => taskBelongsToSister(task, sister, aliases))
  const completed = ownedTasks.filter((task) => hasRecentCompletion(task, aliases, dayAgoMs))
  const active = ownedTasks.filter((task) =>
    ['todo', 'in_progress', 'review', 'backlog'].includes(task.column),
  )
  const blocked = ownedTasks.filter((task) => task.column === 'blocked')

  const yesterday = titleList(completed, 'No completed tasks recorded in the last 24h')
  const today = titleList(active, 'Standing by for the next assigned task')
  const blockers = titleList(blocked, 'No blockers reported')
  const summary = `${sister.name} daily standup: yesterday: ${yesterday}; today: ${today}; blockers: ${blockers}.`

  return {
    id: randomUUID(),
    date: formatLocalDate(now),
    agentId: sister.id,
    agentName: sister.name,
    emoji: sister.emoji,
    role: sister.role,
    timestamp: now.getTime(),
    yesterday,
    today,
    blockers,
    summary,
  }
}

export function listSisterStandups(limit = 50): Array<SisterStandupEntry> {
  return readStandupFile()
    .standups
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, Math.max(1, Math.min(200, limit)))
}

export function generateDailyStandups(options: {
  force?: boolean
  now?: Date
} = {}): Array<SisterStandupEntry> {
  const now = options.now ?? new Date()
  const date = formatLocalDate(now)
  const file = readStandupFile()

  if (!options.force && file.lastRunDate === date) {
    return file.standups.filter((entry) => entry.date === date)
  }

  const existingByAgent = new Set(
    file.standups
      .filter((entry) => entry.date === date)
      .map((entry) => entry.agentId),
  )
  const tasks = listTasks({ includeDone: true })
  const sisters = listSisters(true).filter((sister) =>
    sister.isLive && sister.type !== 'business_agent',
  )
  const generated: Array<SisterStandupEntry> = []

  for (const sister of sisters) {
    if (!options.force && existingByAgent.has(sister.id)) continue
    generated.push(buildSisterStandupEntry({ sister, tasks, now }))
  }

  const retained = options.force
    ? file.standups.filter((entry) => entry.date !== date)
    : file.standups
  writeStandupFile({
    lastRunDate: date,
    standups: [...generated, ...retained],
  })

  return [...generated, ...retained.filter((entry) => entry.date === date)]
    .sort((left, right) => right.timestamp - left.timestamp)
}

export function maybeRunScheduledStandups(now = new Date()): Array<SisterStandupEntry> {
  const config = readConfig()
  if (!config.enabled) return []

  const date = formatLocalDate(now)
  if (schedulerLastCheckDate === date) return []
  if (formatLocalTime(now) < config.time) return []

  schedulerLastCheckDate = date
  return generateDailyStandups({ now })
}

export function startSisterStandupScheduler(): void {
  if (schedulerStarted) return
  schedulerStarted = true
  maybeRunScheduledStandups()
  schedulerTimer = setInterval(() => {
    try {
      maybeRunScheduledStandups()
    } catch {
      // Keep the SSR process alive even if the filesystem is temporarily unavailable.
    }
  }, 60_000)
  schedulerTimer.unref?.()
}

export function stopSisterStandupSchedulerForTests(): void {
  if (schedulerTimer) clearInterval(schedulerTimer)
  schedulerTimer = null
  schedulerStarted = false
  schedulerLastCheckDate = ''
}
