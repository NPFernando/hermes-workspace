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
}

const HISTORY_LIMIT = 100
const PUBLIC_INPUT_MAX_FIELDS = 24
const PUBLIC_INPUT_MAX_TEXT = 8_000
const SENSITIVE_FIELD =
  /(birth|location|address|finance|account|bank|branch|wallet|payment|card|tax|income|salary|transaction|repo|repository|path|password|secret|token|cookie|session|email|phone|medical|health|private|credential|api.?key)/i
const SENSITIVE_TEXT =
  /\b(date of birth|birth date|home address|account number|bank account|password|api key|secret key|social security|private repository|phone number|email address)\b|(?:^|\s)(?:~\/|\/home\/|\/Users\/)/i

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
  const configured = Boolean(
    config.apiBaseUrl && config.apiKey && config.workflows.length > 0,
  )
  return {
    enabled: config.enabled && enabledEnv('DIFY_API_ENABLED'),
    configured,
    workflows: config.workflows,
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
  const workflow = config.workflows.find((item) => item.id === workflowId)
  if (
    !config.enabled ||
    !enabledEnv('DIFY_API_ENABLED') ||
    !config.apiBaseUrl ||
    !config.apiKey ||
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
        const response = await fetchImpl(`${config.apiBaseUrl}/workflows/run`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.apiKey}`,
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
