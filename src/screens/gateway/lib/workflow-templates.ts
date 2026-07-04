export const WORKFLOW_TEMPLATE_SCHEMA_VERSION = 1

export type WorkflowTemplateTask = {
  title: string
  description?: string
}

export type WorkflowTemplate = {
  id: string
  name: string
  description: string
  icon: string
  goal: string
  tags?: Array<string>
  teamConfigId?: string
  tasks: Array<WorkflowTemplateTask>
  createdAt: number
  updatedAt: number
  isBuiltIn?: boolean
  schemaVersion: typeof WORKFLOW_TEMPLATE_SCHEMA_VERSION
}

type WorkflowTemplateInput = Omit<
  WorkflowTemplate,
  'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'
> & {
  schemaVersion?: number
}

type WorkflowTemplatesApiResponse = {
  ok?: boolean
  templates?: Array<unknown>
  template?: unknown
  error?: string
}

export type WorkflowTemplateImportResult = {
  imported: number
  skipped: number
  templates: Array<WorkflowTemplate>
}

const STORAGE_KEY = 'clawsuite:workflow-templates'
const API_PATH = '/api/workflow-templates'

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

function templateTaskValue(value: unknown): WorkflowTemplateTask | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const title = stringValue(row.title)
  if (!title) return null
  const description = stringValue(row.description)
  return description ? { title, description } : { title }
}

function templateTasksValue(value: unknown): Array<WorkflowTemplateTask> {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => templateTaskValue(item))
    .filter((item): item is WorkflowTemplateTask => Boolean(item))
}

function timestampValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function customTemplatesOnly(
  templates: Array<unknown>,
): Array<WorkflowTemplate> {
  return templates
    .map((item) => toWorkflowTemplate(item))
    .filter((item): item is WorkflowTemplate => Boolean(item))
    .filter((item) => !item.isBuiltIn)
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

function mergeTemplates(
  customTemplates: Array<WorkflowTemplate>,
): Array<WorkflowTemplate> {
  const customIds = new Set(customTemplates.map((template) => template.id))
  return [
    ...BUILT_IN_TEMPLATES.filter((template) => !customIds.has(template.id)),
    ...customTemplates,
  ]
}

async function requestWorkflowTemplates(
  init?: RequestInit,
): Promise<WorkflowTemplatesApiResponse> {
  const response = await fetch(API_PATH, init)
  const data = (await response
    .json()
    .catch(() => ({}))) as WorkflowTemplatesApiResponse
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || 'Workflow templates request failed')
  }
  return data
}

export function toWorkflowTemplate(value: unknown): WorkflowTemplate | null {
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
  const tasks = templateTasksValue(row.tasks)
  const isBuiltIn = row.isBuiltIn === true

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
    ...(isBuiltIn ? { isBuiltIn } : {}),
    schemaVersion: WORKFLOW_TEMPLATE_SCHEMA_VERSION,
  }
}

// Built-in templates that ship with ClawSuite
export const BUILT_IN_TEMPLATES: Array<WorkflowTemplate> = [
  {
    id: 'tpl-code-review',
    name: 'Code Review',
    description:
      'Review codebase for bugs, performance issues, and code quality',
    icon: '🔍',
    goal: 'Review the codebase for bugs, performance issues, and code quality improvements',
    tags: ['review', 'quality', 'audit'],
    tasks: [
      { title: 'Read all source files and understand architecture' },
      { title: 'Identify bugs and logic errors' },
      { title: 'Check for security vulnerabilities' },
      { title: 'Suggest code quality improvements' },
      { title: 'Write summary report with prioritized findings' },
    ],
    createdAt: 0,
    updatedAt: 0,
    isBuiltIn: true,
    schemaVersion: WORKFLOW_TEMPLATE_SCHEMA_VERSION,
  },
  {
    id: 'tpl-bug-fix',
    name: 'Bug Fix',
    description: 'Diagnose and fix a specific bug with tests',
    icon: '🐛',
    goal: 'Investigate the reported bug, identify the root cause, implement a fix, and verify it works. Write tests if appropriate.',
    tasks: [
      { title: 'Reproduce the bug and understand the symptoms' },
      { title: 'Trace the code path to find root cause' },
      { title: 'Implement the fix' },
      { title: 'Run type check (npx tsc --noEmit)' },
      { title: 'Commit with descriptive message' },
    ],
    createdAt: 0,
    updatedAt: 0,
    isBuiltIn: true,
    schemaVersion: WORKFLOW_TEMPLATE_SCHEMA_VERSION,
  },
  {
    id: 'tpl-feature-build',
    name: 'Feature Build',
    description: 'Plan and implement a new feature end-to-end',
    icon: '🏗️',
    goal: 'Plan, implement, test, and document the new feature',
    tags: ['build', 'feature', 'implementation'],
    tasks: [
      { title: 'Analyze existing code patterns and architecture' },
      { title: 'Create new files and components' },
      { title: 'Wire up routes, state management, and API calls' },
      { title: 'Add error handling and edge cases' },
      { title: 'Run type check and fix any issues' },
      { title: 'Commit and push' },
    ],
    createdAt: 0,
    updatedAt: 0,
    isBuiltIn: true,
    schemaVersion: WORKFLOW_TEMPLATE_SCHEMA_VERSION,
  },
  {
    id: 'tpl-research',
    name: 'Research & Analysis',
    description: 'Research a topic and produce a structured report',
    icon: '📊',
    goal: 'Research the given topic thoroughly. Analyze findings and produce a structured report with key insights, comparisons, and recommendations.',
    tasks: [
      { title: 'Search for relevant sources and documentation' },
      { title: 'Analyze and compare approaches' },
      { title: 'Write structured findings report' },
      { title: 'Add recommendations section' },
    ],
    createdAt: 0,
    updatedAt: 0,
    isBuiltIn: true,
    schemaVersion: WORKFLOW_TEMPLATE_SCHEMA_VERSION,
  },
  {
    id: 'tpl-refactor',
    name: 'Refactor',
    description:
      'Refactor code for better organization, performance, or readability',
    icon: '♻️',
    goal: 'Refactor the specified code area to improve organization, reduce complexity, and maintain existing functionality. No behavioral changes.',
    tasks: [
      { title: 'Read and understand current implementation' },
      { title: 'Identify refactoring opportunities' },
      { title: 'Implement changes incrementally' },
      { title: 'Verify no behavioral changes (type check + manual review)' },
      { title: 'Commit with clear refactoring message' },
    ],
    createdAt: 0,
    updatedAt: 0,
    isBuiltIn: true,
    schemaVersion: WORKFLOW_TEMPLATE_SCHEMA_VERSION,
  },
  {
    id: 'tpl-audit',
    name: 'Security Audit',
    description:
      'Audit codebase for security vulnerabilities and best practices',
    icon: '🛡️',
    goal: 'Perform a security audit of the codebase. Check for common vulnerabilities (XSS, injection, auth bypass, secrets exposure, dependency issues). Produce a severity-ranked report.',
    tasks: [
      { title: 'Scan for hardcoded secrets and API keys' },
      { title: 'Check input validation and sanitization' },
      { title: 'Review authentication and authorization flows' },
      { title: 'Check dependency vulnerabilities' },
      { title: 'Write security audit report with severity ratings' },
    ],
    createdAt: 0,
    updatedAt: 0,
    isBuiltIn: true,
    schemaVersion: WORKFLOW_TEMPLATE_SCHEMA_VERSION,
  },
]

export function loadCustomTemplates(): Array<WorkflowTemplate> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return customTemplatesOnly(parsed)
  } catch {
    return []
  }
}

export function saveCustomTemplates(templates: Array<WorkflowTemplate>): void {
  try {
    const cleanTemplates = customTemplatesOnly(templates)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanTemplates))
  } catch {
    // Ignore storage failures; templates remain usable in memory for the current action.
  }
}

export function getAllTemplates(): Array<WorkflowTemplate> {
  return mergeTemplates(loadCustomTemplates())
}

export function exportCustomWorkflowTemplates(): string {
  return JSON.stringify(
    {
      schemaVersion: WORKFLOW_TEMPLATE_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      templates: loadCustomTemplates(),
    },
    null,
    2,
  )
}

export async function importWorkflowTemplatesFromJson(
  raw: string,
): Promise<WorkflowTemplateImportResult> {
  const parsed = JSON.parse(raw) as unknown
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { templates?: unknown }).templates)
      ? (parsed as { templates: Array<unknown> }).templates
      : null

  if (!rows) {
    throw new Error(
      'Template import must be a JSON array or an object with a templates array',
    )
  }

  const importedTemplates = customTemplatesOnly(rows)
  const existingTemplates = loadCustomTemplates()
  const byId = new Map(
    existingTemplates.map((template) => [template.id, template]),
  )
  for (const template of importedTemplates) {
    byId.set(template.id, template)
  }

  const mergedTemplates = [...byId.values()].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  )
  const templates = await saveWorkflowTemplatesToServer(mergedTemplates)
  return {
    imported: importedTemplates.length,
    skipped: rows.length - importedTemplates.length,
    templates,
  }
}

export async function loadWorkflowTemplates(): Promise<
  Array<WorkflowTemplate>
> {
  const localTemplates = loadCustomTemplates()
  try {
    const data = await requestWorkflowTemplates()
    const serverTemplates = customTemplatesOnly(data.templates ?? [])

    if (serverTemplates.length === 0 && localTemplates.length > 0) {
      await saveWorkflowTemplatesToServer(localTemplates)
      return mergeTemplates(localTemplates)
    }

    saveCustomTemplates(serverTemplates)
    return mergeTemplates(serverTemplates)
  } catch {
    return mergeTemplates(localTemplates)
  }
}

export async function saveWorkflowTemplatesToServer(
  templates: Array<WorkflowTemplate>,
): Promise<Array<WorkflowTemplate>> {
  const cleanTemplates = customTemplatesOnly(templates)
  const data = await requestWorkflowTemplates({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templates: cleanTemplates }),
  })
  const serverTemplates = customTemplatesOnly(data.templates ?? cleanTemplates)
  saveCustomTemplates(serverTemplates)
  return mergeTemplates(serverTemplates)
}

export async function updateWorkflowTemplateRemote(
  template: WorkflowTemplate,
): Promise<Array<WorkflowTemplate>> {
  const updatedTemplate = toWorkflowTemplate({
    ...template,
    updatedAt: Date.now(),
    isBuiltIn: false,
  })

  if (!updatedTemplate) {
    throw new Error('Cannot update invalid workflow template')
  }

  const existing = loadCustomTemplates().filter(
    (item) => item.id !== updatedTemplate.id,
  )
  saveCustomTemplates([updatedTemplate, ...existing])
  return saveWorkflowTemplatesToServer([updatedTemplate, ...existing])
}

export async function duplicateWorkflowTemplateRemote(
  template: WorkflowTemplate,
): Promise<Array<WorkflowTemplate>> {
  const now = Date.now()
  const clone = toWorkflowTemplate({
    ...template,
    id: `tpl-custom-${now}-${Math.random().toString(36).slice(2, 6)}`,
    name: `${template.name} (copy)`.slice(0, 64),
    createdAt: now,
    updatedAt: now,
    isBuiltIn: false,
  })

  if (!clone) {
    throw new Error('Cannot duplicate invalid workflow template')
  }

  const existing = loadCustomTemplates()
  saveCustomTemplates([clone, ...existing])
  try {
    const data = await requestWorkflowTemplates({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: clone }),
    })
    const serverTemplates = customTemplatesOnly(data.templates ?? [])
    if (serverTemplates.length > 0) {
      saveCustomTemplates(serverTemplates)
      return mergeTemplates(serverTemplates)
    }
  } catch {
    // Keep local clone even when the server is unreachable.
  }
  return mergeTemplates([clone, ...existing])
}

export function saveAsTemplate(
  template: WorkflowTemplateInput,
): WorkflowTemplate {
  const now = Date.now()
  const newTemplate = toWorkflowTemplate({
    ...template,
    id: `tpl-custom-${now}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: now,
    updatedAt: now,
    isBuiltIn: false,
  })

  if (!newTemplate) {
    throw new Error('Cannot save invalid workflow template')
  }

  const existing = loadCustomTemplates()
  saveCustomTemplates([newTemplate, ...existing])
  return newTemplate
}

export async function saveAsTemplateRemote(
  template: WorkflowTemplateInput,
): Promise<WorkflowTemplate> {
  const newTemplate = saveAsTemplate(template)
  try {
    const data = await requestWorkflowTemplates({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: newTemplate }),
    })
    const savedTemplate = toWorkflowTemplate(data.template) ?? newTemplate
    const serverTemplates = customTemplatesOnly(data.templates ?? [])
    saveCustomTemplates(
      serverTemplates.length > 0
        ? serverTemplates
        : [savedTemplate, ...loadCustomTemplates()],
    )
    return savedTemplate
  } catch {
    return newTemplate
  }
}

export function deleteTemplate(id: string): void {
  const existing = loadCustomTemplates()
  saveCustomTemplates(existing.filter((template) => template.id !== id))
}

export async function deleteWorkflowTemplate(id: string): Promise<void> {
  deleteTemplate(id)
  try {
    const data = await requestWorkflowTemplates({
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    saveCustomTemplates(customTemplatesOnly(data.templates ?? []))
  } catch {
    // Local deletion already succeeded; keep the UI responsive if the server is unavailable.
  }
}
