import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getStateDir } from './workspace-state-dir'

export type DifyStatus = {
  enabled: boolean
  configured: boolean
  available: boolean
  url: string | null
  detail: string
}

export type DifyWorkflow = {
  id: string
  name: string
  description?: string
  version?: string
  provider: string
  publicOnly: true
}

/**
 * A version is a server-configured workflow mapping. Dify does not expose a
 * portable version selector through the run API, so each entry may point at a
 * version-specific API base/key environment variable. The key itself never
 * leaves the server.
 */
export type DifyWorkflowVersion = {
  workflowId: string
  version: string
  name: string
  description?: string
  provider: string
  apiBaseUrl?: string
  apiKeyEnv?: string
  publicOnly: true
}

export type DifyWorkflowChange = {
  field: 'name' | 'description' | 'provider' | 'apiBaseUrl' | 'apiKeyEnv'
  before: string | null
  after: string | null
}

export type DifyWorkflowComparison = {
  workflowId: string
  fromVersion: string
  toVersion: string
  changes: Array<DifyWorkflowChange>
}

export type DifyRollbackRecord = {
  workflowId: string
  version: string
  requestedAt: string
  requestedBy: 'authenticated-operator'
  note: string
}

export type DifyExecution = {
  id: string
  workflowId: string
  workflowName: string
  provider: string
  workflowVersion?: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
  startedAt: string
  finishedAt: string
  runId: string | null
  error: string | null
}

export type DifyIntegration = {
  enabled: boolean
  configured: boolean
  workflows: Array<DifyWorkflow>
  versions: Array<DifyWorkflowVersion>
  rollbackEnabled: boolean
  activeVersions: Record<string, string>
  rollbackHistory: Array<DifyRollbackRecord>
  history: Array<DifyExecution>
  privacy: {
    mode: 'public-only'
    historyStores: 'metadata-only'
    rejectedFields: string
  }
  detail: string
}

type DifyInternalConfig = {
  enabled: boolean
  url: string | null
  healthUrl: string | null
  apiBaseUrl: string | null
  apiKey: string | null
  workflows: Array<DifyWorkflow>
  versions: Array<DifyWorkflowVersion>
}

const HISTORY_LIMIT = 100
const PUBLIC_INPUT_MAX_FIELDS = 24
const PUBLIC_INPUT_MAX_TEXT = 8_000
const SENSITIVE_FIELD =
  /(birth|location|address|finance|account|bank|branch|wallet|payment|card|tax|income|salary|transaction|repo|repository|path|password|secret|token|cookie|session|email|phone|medical|health|private|credential|api.?key)/i
const SENSITIVE_TEXT =
  /\b(date of birth|birth date|home address|account number|bank account|password|api key|secret key|social security|private repository|phone number|email address)\b|(?:^|\s)(?:~\/|\/home\/|\/Users\/)/i
const VERSION_STATE_LIMIT = 100

function safeHttpUrl(raw: string | undefined): string | null {
  if (!raw?.trim()) return null
  try {
    const parsed = new URL(raw.trim())
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    if (parsed.username || parsed.password || parsed.search || parsed.hash)
      return null
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function enabledEnv(name: string): boolean {
  return ['1', 'true', 'yes'].includes(
    (process.env[name] || '').trim().toLowerCase(),
  )
}

function parseWorkflows(): Array<DifyWorkflow> {
  const raw = process.env.DIFY_WORKFLOWS_JSON?.trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((value): DifyWorkflow | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          return null
        const row = value as Record<string, unknown>
        const id = typeof row.id === 'string' ? row.id.trim() : ''
        const name = typeof row.name === 'string' ? row.name.trim() : ''
        if (
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(id) ||
          !name ||
          name.length > 120
        )
          return null
        const description =
          typeof row.description === 'string'
            ? row.description.trim().slice(0, 400)
            : undefined
        const version =
          typeof row.version === 'string' &&
          /^[A-Za-z0-9._-]{1,80}$/.test(row.version.trim())
            ? row.version.trim()
            : undefined
        const provider =
          typeof row.provider === 'string' && row.provider.trim()
            ? row.provider.trim().slice(0, 80)
            : 'Dify'
        return {
          id,
          name,
          ...(description ? { description } : {}),
          ...(version ? { version } : {}),
          provider,
          publicOnly: true,
        }
      })
      .filter((value): value is DifyWorkflow => Boolean(value))
      .slice(0, 32)
  } catch {
    return []
  }
}

function parseWorkflowVersions(): Array<DifyWorkflowVersion> {
  const raw = process.env.DIFY_WORKFLOW_VERSIONS_JSON?.trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((value): DifyWorkflowVersion | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          return null
        const row = value as Record<string, unknown>
        const workflowId =
          typeof row.workflowId === 'string' ? row.workflowId.trim() : ''
        const version =
          typeof row.version === 'string' ? row.version.trim() : ''
        const name = typeof row.name === 'string' ? row.name.trim() : ''
        if (
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(workflowId) ||
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(version) ||
          !name ||
          name.length > 120
        )
          return null
        const description =
          typeof row.description === 'string'
            ? row.description.trim().slice(0, 400)
            : undefined
        const provider =
          typeof row.provider === 'string' && row.provider.trim()
            ? row.provider.trim().slice(0, 80)
            : 'Dify'
        const apiBaseUrl =
          typeof row.apiBaseUrl === 'string'
            ? safeHttpUrl(row.apiBaseUrl)
            : null
        const apiKeyEnv =
          typeof row.apiKeyEnv === 'string' &&
          /^[A-Z][A-Z0-9_]{0,79}$/.test(row.apiKeyEnv.trim())
            ? row.apiKeyEnv.trim()
            : undefined
        return {
          workflowId,
          version,
          name,
          ...(description ? { description } : {}),
          provider,
          ...(apiBaseUrl ? { apiBaseUrl } : {}),
          ...(apiKeyEnv ? { apiKeyEnv } : {}),
          publicOnly: true,
        }
      })
      .filter((value): value is DifyWorkflowVersion => Boolean(value))
      .slice(0, 256)
  } catch {
    return []
  }
}

function internalConfig(): DifyInternalConfig {
  const url = safeHttpUrl(
    process.env.DIFY_WORKBENCH_URL || process.env.DIFY_BASE_URL,
  )
  const rawHealthUrl = process.env.DIFY_HEALTHCHECK_URL
  const healthUrl = rawHealthUrl ? safeHttpUrl(rawHealthUrl) : url
  const apiBaseUrl = safeHttpUrl(
    process.env.DIFY_API_BASE_URL || process.env.DIFY_BASE_URL,
  )
  const apiKey = process.env.DIFY_API_KEY?.trim() || null
  return {
    enabled: enabledEnv('DIFY_WORKBENCH_ENABLED'),
    url,
    healthUrl,
    apiBaseUrl,
    apiKey,
    workflows: parseWorkflows(),
    versions: parseWorkflowVersions(),
  }
}

export function difyConfig(): {
  enabled: boolean
  url: string | null
  healthUrl: string | null
} {
  const config = internalConfig()
  return {
    enabled: config.enabled,
    url: config.url,
    healthUrl: config.healthUrl,
  }
}

export async function getDifyStatus(fetchImpl = fetch): Promise<DifyStatus> {
  const config = internalConfig()
  if (!config.enabled)
    return {
      enabled: false,
      configured: false,
      available: false,
      url: null,
      detail: 'Dify workbench is disabled.',
    }
  if (!config.url || !config.healthUrl)
    return {
      enabled: true,
      configured: false,
      available: false,
      url: null,
      detail:
        'Set a browser-reachable DIFY_WORKBENCH_URL using http or https; URL credentials, query strings, and fragments are not accepted.',
    }
  try {
    const response = await fetchImpl(`${config.healthUrl}/`, {
      signal: AbortSignal.timeout(3000),
      headers: { accept: 'text/html,application/json' },
    })
    return {
      enabled: true,
      configured: true,
      available: response.ok,
      url: config.url,
      detail: response.ok
        ? 'Dify provider is reachable.'
        : `Dify provider returned HTTP ${response.status}.`,
    }
  } catch {
    return {
      enabled: true,
      configured: true,
      available: false,
      url: config.url,
      detail: 'Dify provider is not reachable.',
    }
  }
}

function historyPath(): string {
  return join(getStateDir(), 'dify-execution-history.json')
}

function versionStatePath(): string {
  return join(getStateDir(), 'dify-workflow-state.json')
}

type DifyVersionState = {
  activeVersions: Record<string, string>
  rollbackHistory: Array<DifyRollbackRecord>
}

function readVersionState(file = versionStatePath()): DifyVersionState {
  try {
    if (!existsSync(file)) return { activeVersions: {}, rollbackHistory: [] }
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return { activeVersions: {}, rollbackHistory: [] }
    const row = parsed as Record<string, unknown>
    const activeVersions: Record<string, string> = {}
    if (row.activeVersions && typeof row.activeVersions === 'object') {
      for (const [workflowId, version] of Object.entries(
        row.activeVersions as Record<string, unknown>,
      )) {
        if (
          /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(workflowId) &&
          typeof version === 'string' &&
          /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(version)
        )
          activeVersions[workflowId] = version
      }
    }
    const rollbackHistory = Array.isArray(row.rollbackHistory)
      ? (row.rollbackHistory.slice(0, VERSION_STATE_LIMIT) as Array<DifyRollbackRecord>)
      : []
    return { activeVersions, rollbackHistory }
  } catch {
    return { activeVersions: {}, rollbackHistory: [] }
  }
}

function writeVersionState(
  state: DifyVersionState,
  file = versionStatePath(),
): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
  renameSync(temp, file)
  try {
    chmodSync(file, 0o600)
  } catch {
    /* best effort on Windows */
  }
}

function versionFor(
  config: DifyInternalConfig,
  workflowId: string,
  version: string | undefined,
): DifyWorkflowVersion | null {
  return (
    config.versions.find(
      (item) =>
        item.workflowId === workflowId &&
        (!version || item.version === version),
    ) ?? null
  )
}

function activeWorkflow(
  config: DifyInternalConfig,
  workflow: DifyWorkflow,
  state: DifyVersionState,
): { workflow: DifyWorkflow; apiBaseUrl: string | null; apiKey: string | null } {
  const selectedVersion = versionFor(
    config,
    workflow.id,
    state.activeVersions[workflow.id] ?? workflow.version,
  )
  if (!selectedVersion)
    return {
      workflow,
      apiBaseUrl: config.apiBaseUrl,
      apiKey: config.apiKey,
    }
  return {
    workflow: {
      ...workflow,
      name: selectedVersion.name,
      ...(selectedVersion.description
        ? { description: selectedVersion.description }
        : {}),
      version: selectedVersion.version,
      provider: selectedVersion.provider,
    },
    apiBaseUrl: selectedVersion.apiBaseUrl ?? config.apiBaseUrl,
    apiKey: selectedVersion.apiKeyEnv
      ? process.env[selectedVersion.apiKeyEnv]?.trim() || null
      : config.apiKey,
  }
}

export function compareDifyWorkflowVersions(
  workflowId: string,
  fromVersion: string,
  toVersion: string,
): DifyWorkflowComparison {
  const config = internalConfig()
  const from = versionFor(config, workflowId, fromVersion)
  const to = versionFor(config, workflowId, toVersion)
  if (!from || !to) throw new Error('Both Dify workflow versions must be configured.')
  const changes: Array<DifyWorkflowChange> = []
  for (const field of [
    'name',
    'description',
    'provider',
    'apiBaseUrl',
    'apiKeyEnv',
  ] as const) {
    const before = from[field] ?? null
    const after = to[field] ?? null
    if (before !== after) changes.push({ field, before, after })
  }
  return { workflowId, fromVersion, toVersion, changes }
}

export function rollbackDifyWorkflow(
  workflowId: string,
  version: string,
  note: string,
): DifyIntegration {
  const config = internalConfig()
  if (!config.enabled || !enabledEnv('DIFY_API_ENABLED'))
    throw new Error('Dify API workflows are disabled.')
  if (!enabledEnv('DIFY_WORKFLOW_ROLLBACK_ENABLED'))
    throw new Error('Dify workflow rollback is disabled by server policy.')
  if (!versionFor(config, workflowId, version))
    throw new Error('The requested Dify workflow version is not configured.')
  const cleanNote = note.trim()
  if (cleanNote.length < 8 || cleanNote.length > 500)
    throw new Error('Rollback note must be between 8 and 500 characters.')
  const state = readVersionState()
  const record: DifyRollbackRecord = {
    workflowId,
    version,
    requestedAt: new Date().toISOString(),
    requestedBy: 'authenticated-operator',
    note: cleanNote,
  }
  writeVersionState({
    activeVersions: { ...state.activeVersions, [workflowId]: version },
    rollbackHistory: [record, ...state.rollbackHistory].slice(
      0,
      VERSION_STATE_LIMIT,
    ),
  })
  return getDifyIntegration()
}

function readHistory(file = historyPath()): Array<DifyExecution> {
  try {
    if (!existsSync(file)) return []
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    return Array.isArray(parsed)
      ? (parsed.slice(0, HISTORY_LIMIT) as Array<DifyExecution>)
      : []
  } catch {
    return []
  }
}

function writeHistory(
  history: Array<DifyExecution>,
  file = historyPath(),
): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(
    temp,
    JSON.stringify(history.slice(0, HISTORY_LIMIT), null, 2) + '\n',
    { mode: 0o600 },
  )
  renameSync(temp, file)
  try {
    chmodSync(file, 0o600)
  } catch {
    /* best effort on Windows */
  }
}

function recordExecution(execution: DifyExecution, file?: string): void {
  writeHistory([execution, ...readHistory(file)], file)
}

function publicInputs(
  value: unknown,
): Record<string, string | number | boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Dify inputs must be a flat public-data object.')
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > PUBLIC_INPUT_MAX_FIELDS)
    throw new Error(
      `Dify accepts at most ${PUBLIC_INPUT_MAX_FIELDS} public input fields.`,
    )
  const result: Record<string, string | number | boolean> = {}
  let totalText = 0
  for (const [key, raw] of entries) {
    if (
      !/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(key) ||
      SENSITIVE_FIELD.test(key)
    )
      throw new Error(`Dify input field is not allowed: ${key}`)
    if (typeof raw === 'string') {
      if (raw.length > PUBLIC_INPUT_MAX_TEXT)
        throw new Error(`Dify input '${key}' is too large.`)
      if (SENSITIVE_TEXT.test(raw))
        throw new Error(`Dify input '${key}' appears to contain private data.`)
      totalText += raw.length
      result[key] = raw
    } else if (typeof raw === 'number' && Number.isFinite(raw))
      result[key] = raw
    else if (typeof raw === 'boolean') result[key] = raw
    else
      throw new Error(
        `Dify input '${key}' must be text, a finite number, or a boolean.`,
      )
  }
  if (totalText > PUBLIC_INPUT_MAX_TEXT * 2)
    throw new Error('Dify public input payload is too large.')
  return result
}

function integrationStatus(
  config: DifyInternalConfig,
  history: Array<DifyExecution>,
): DifyIntegration {
  const versionState = readVersionState()
  const configured = Boolean(
    config.apiBaseUrl && config.apiKey && config.workflows.length > 0,
  )
  return {
    enabled: config.enabled && enabledEnv('DIFY_API_ENABLED'),
    configured,
    workflows: config.workflows.map(
      (workflow) => activeWorkflow(config, workflow, versionState).workflow,
    ),
    versions: config.versions.map(({ apiBaseUrl: _apiBaseUrl, apiKeyEnv: _apiKeyEnv, ...version }) => version),
    rollbackEnabled:
      config.enabled &&
      enabledEnv('DIFY_API_ENABLED') &&
      enabledEnv('DIFY_WORKFLOW_ROLLBACK_ENABLED'),
    activeVersions: versionState.activeVersions,
    rollbackHistory: versionState.rollbackHistory,
    history,
    privacy: {
      mode: 'public-only',
      historyStores: 'metadata-only',
      rejectedFields:
        'birth, location, finance, account, repository, credentials, contact, medical, and other private fields',
    },
    detail: !config.enabled
      ? 'Dify workbench is disabled.'
      : !enabledEnv('DIFY_API_ENABLED')
        ? 'Dify API workflows require the separate DIFY_API_ENABLED flag.'
        : !configured
          ? 'Configure DIFY_API_BASE_URL, DIFY_API_KEY, and DIFY_WORKFLOWS_JSON on the server.'
          : 'Public-only Dify workflows are ready.',
  }
}

export function getDifyIntegration(): DifyIntegration {
  return integrationStatus(internalConfig(), readHistory())
}

export type DifyWorkflowRunOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  maxRetries?: number
}

function workflowTimeoutMs(options?: DifyWorkflowRunOptions): number {
  const configured = Number(process.env.DIFY_WORKFLOW_TIMEOUT_MS || 120_000)
  return Math.min(
    120_000,
    Math.max(
      1_000,
      options?.timeoutMs ??
        (Number.isFinite(configured) ? configured : 120_000),
    ),
  )
}

function workflowRetries(options?: DifyWorkflowRunOptions): number {
  const configured = Number(process.env.DIFY_WORKFLOW_MAX_RETRIES || 2)
  return Math.min(
    3,
    Math.max(
      0,
      options?.maxRetries ?? (Number.isFinite(configured) ? configured : 2),
    ),
  )
}

function retryableDifyStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function abortableDelay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted)
    return Promise.reject(
      signal.reason ?? new Error('Dify workflow request was cancelled.'),
    )
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(
          signal.reason ?? new Error('Dify workflow request was cancelled.'),
        )
      },
      { once: true },
    )
  })
}

export async function runDifyWorkflow(
  workflowId: string,
  inputs: unknown,
  fetchImpl = fetch,
  file?: string,
  options?: DifyWorkflowRunOptions,
): Promise<{ execution: DifyExecution; outputs: unknown }> {
  const config = internalConfig()
  const configuredWorkflow = config.workflows.find((item) => item.id === workflowId)
  const state = readVersionState()
  const resolved = configuredWorkflow
    ? activeWorkflow(config, configuredWorkflow, state)
    : null
  const workflow = resolved?.workflow
  if (
    !config.enabled ||
    !enabledEnv('DIFY_API_ENABLED') ||
    !resolved?.apiBaseUrl ||
    !resolved.apiKey ||
    !workflow
  )
    throw new Error(
      'Dify workflow execution is not configured for this workflow.',
    )
  const cleanInputs = publicInputs(inputs)
  const startedAt = new Date().toISOString()
  const executionId = `dify-${randomUUID()}`
  let requestSignal: AbortSignal | undefined
  try {
    const retries = workflowRetries(options)
    const timeoutMs = workflowTimeoutMs(options)
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = options?.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal
    requestSignal = signal
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetchImpl(`${resolved.apiBaseUrl}/workflows/run`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${resolved.apiKey}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({
            inputs: cleanInputs,
            response_mode: 'blocking',
            user: 'hermes-workspace-public',
          }),
          signal,
        })
        const body = (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >
        if (!response.ok) {
          if (!retryableDifyStatus(response.status) || attempt === retries)
            throw new Error(`Dify returned HTTP ${response.status}.`)
          await abortableDelay(
            Math.min(1_000, 250 * 2 ** attempt),
            options?.signal,
          )
          continue
        }
        const data =
          body.data && typeof body.data === 'object'
            ? (body.data as Record<string, unknown>)
            : body
        const runId =
          typeof data.id === 'string'
            ? data.id
            : typeof body.workflow_run_id === 'string'
              ? body.workflow_run_id
              : null
        const execution: DifyExecution = {
          id: executionId,
          workflowId,
          workflowName: workflow.name,
          provider: workflow.provider,
          ...(workflow.version ? { workflowVersion: workflow.version } : {}),
          status: 'succeeded',
          startedAt,
          finishedAt: new Date().toISOString(),
          runId,
          error: null,
        }
        recordExecution(execution, file)
        return { execution, outputs: data.outputs ?? body.answer ?? body }
      } catch (error) {
        if (signal.aborted || attempt === retries) throw error
        await abortableDelay(
          Math.min(1_000, 250 * 2 ** attempt),
          options?.signal,
        )
      }
    }
    throw new Error('Dify workflow failed after retry attempts.')
  } catch (error) {
    const execution: DifyExecution = {
      id: executionId,
      workflowId,
      workflowName: workflow.name,
      provider: workflow.provider,
      ...(workflow.version ? { workflowVersion: workflow.version } : {}),
      status: requestSignal?.aborted ? 'cancelled' : 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      runId: null,
      error: requestSignal?.aborted
        ? 'Dify workflow cancelled.'
        : error instanceof Error
          ? error.message
          : 'Dify workflow failed.',
    }
    recordExecution(execution, file)
    throw error
  }
}

export function validateDifyPublicInputs(
  value: unknown,
): Record<string, string | number | boolean> {
  return publicInputs(value)
}
