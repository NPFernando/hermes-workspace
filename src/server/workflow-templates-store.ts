import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { getStateDir } from './workspace-state-dir'

export const WORKFLOW_TEMPLATE_SCHEMA_VERSION = 1

export type StoredWorkflowTemplateTask = {
  title: string
  description?: string
}

export type StoredWorkflowTemplate = {
  id: string
  name: string
  description: string
  icon: string
  goal: string
  tags?: Array<string>
  teamConfigId?: string
  tasks: Array<StoredWorkflowTemplateTask>
  createdAt: number
  updatedAt: number
  isBuiltIn?: boolean
  schemaVersion: typeof WORKFLOW_TEMPLATE_SCHEMA_VERSION
}

const STORE_PATH = join(getStateDir(), 'workflow-templates.json')

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function stringArrayValue(value: unknown): Array<string> | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value
    .map((item) => stringValue(item))
    .filter((item): item is string => Boolean(item))
  return strings.length > 0 ? strings : undefined
}

function taskValue(value: unknown): StoredWorkflowTemplateTask | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const title = stringValue(row.title)
  if (!title) return null
  const description = stringValue(row.description)
  return description ? { title, description } : { title }
}

function tasksValue(value: unknown): Array<StoredWorkflowTemplateTask> {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => taskValue(item))
    .filter((item): item is StoredWorkflowTemplateTask => Boolean(item))
}

function timestampValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function toStoredWorkflowTemplate(
  value: unknown,
): StoredWorkflowTemplate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const id = stringValue(row.id)
  const name = stringValue(row.name)
  const description = stringValue(row.description)
  const goal = stringValue(row.goal)
  if (!id || !name || !description || !goal) return null

  const now = Date.now()
  const icon = stringValue(row.icon) ?? '⚙️'
  const createdAt = timestampValue(row.createdAt, now)
  const updatedAt = timestampValue(row.updatedAt, createdAt)
  const tags = stringArrayValue(row.tags)
  const teamConfigId = stringValue(row.teamConfigId) ?? undefined
  const tasks = tasksValue(row.tasks)

  return {
    id,
    name,
    description,
    icon,
    goal,
    ...(tags ? { tags } : {}),
    ...(teamConfigId ? { teamConfigId } : {}),
    tasks,
    createdAt,
    updatedAt,
    schemaVersion: WORKFLOW_TEMPLATE_SCHEMA_VERSION,
  }
}

function readRawStore(): unknown {
  if (!existsSync(STORE_PATH)) return []
  const raw = readFileSync(STORE_PATH, 'utf-8')
  if (!raw.trim()) return []
  return JSON.parse(raw)
}

export function readWorkflowTemplates(): Array<StoredWorkflowTemplate> {
  const parsed = readRawStore()
  if (!Array.isArray(parsed)) return []
  return parsed
    .map((item) => toStoredWorkflowTemplate(item))
    .filter((item): item is StoredWorkflowTemplate => Boolean(item))
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

export function writeWorkflowTemplates(
  templates: Array<unknown>,
): Array<StoredWorkflowTemplate> {
  const cleanTemplates = templates
    .map((item) => toStoredWorkflowTemplate(item))
    .filter((item): item is StoredWorkflowTemplate => Boolean(item))
    .filter((item) => !item.isBuiltIn)

  mkdirSync(dirname(STORE_PATH), { recursive: true })
  const tmpPath = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(
    tmpPath,
    JSON.stringify(cleanTemplates, null, 2) + '\n',
    'utf-8',
  )
  renameSync(tmpPath, STORE_PATH)
  return cleanTemplates
}

export function upsertWorkflowTemplate(
  template: unknown,
): StoredWorkflowTemplate | null {
  const cleanTemplate = toStoredWorkflowTemplate(template)
  if (!cleanTemplate) return null
  const existing = readWorkflowTemplates().filter(
    (item) => item.id !== cleanTemplate.id,
  )
  writeWorkflowTemplates([cleanTemplate, ...existing])
  return cleanTemplate
}

export function deleteWorkflowTemplate(id: string): boolean {
  const existing = readWorkflowTemplates()
  const next = existing.filter((template) => template.id !== id)
  if (next.length === existing.length) return false
  writeWorkflowTemplates(next)
  return true
}
