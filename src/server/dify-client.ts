import { getDifyApp, getDifyAppKey, getDifyConfig } from './dify-config'
import type { DifyAppMode } from './dify-config'

export type DifyAppInfo = {
  name?: string
  description?: string
  tags?: Array<unknown>
  mode?: DifyAppMode
}

export type DifyAppParameters = Record<string, unknown>
export type DifyRunMode = 'workflow' | 'chat' | 'completion'

const circuitState = new Map<string, { failures: number; openedAt: number }>()
const CIRCUIT_FAILURE_THRESHOLD = 3
const CIRCUIT_COOLDOWN_MS = 30_000

export class DifyClientError extends Error {
  status: number
  code: string

  constructor(message: string, status = 502, code = 'dify_error') {
    super(message)
    this.name = 'DifyClientError'
    this.status = status
    this.code = code
  }
}

function safeMessage(status: number): string {
  if (status === 401) return 'Dify credentials were rejected'
  if (status === 403) return 'Dify access was denied'
  if (status === 404) return 'Dify app or endpoint was not found'
  if (status === 429) return 'Dify rate limit reached'
  return `Dify request failed (${status})`
}

function requireConfig() {
  const config = getDifyConfig()
  if (!config.enabled) {
    throw new DifyClientError('Dify integration is disabled', 503, 'disabled')
  }
  return config
}

function requireApp(appId: string) {
  const config = requireConfig()
  const app = getDifyApp(appId, config)
  if (!app) {
    throw new DifyClientError('Dify app is not configured', 404, 'unknown_app')
  }
  const apiKey = getDifyAppKey(app)
  if (!apiKey) {
    throw new DifyClientError(
      'Dify app credentials are not configured',
      503,
      'missing_credentials',
    )
  }
  return { config, app, apiKey }
}

function serviceApiUrl(baseUrl: string, path: string): string {
  return `${baseUrl}/v1${path}`
}

async function requestDify(
  appId: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { config, apiKey } = requireApp(appId)
  const circuit = circuitState.get(config.baseUrl)
  if (
    circuit &&
    circuit.failures >= CIRCUIT_FAILURE_THRESHOLD &&
    Date.now() - circuit.openedAt < CIRCUIT_COOLDOWN_MS
  ) {
    throw new DifyClientError(
      'Dify is temporarily unavailable; retry shortly',
      503,
      'circuit_open',
    )
  }
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${apiKey}`)
  headers.set('Accept', headers.get('Accept') || 'application/json')
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const retryable = !init.method || init.method.toUpperCase() === 'GET'
  const attempts = retryable ? 2 : 1
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response
    try {
      response = await fetch(serviceApiUrl(config.baseUrl, path), {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(30_000),
      })
    } catch {
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 150))
        continue
      }
      const previous = circuitState.get(config.baseUrl)
      const failures = (previous?.failures ?? 0) + 1
      circuitState.set(config.baseUrl, { failures, openedAt: Date.now() })
      throw new DifyClientError('Dify is unreachable', 502, 'unreachable')
    }
    if (!response.ok) {
      if (attempt + 1 < attempts && [502, 503, 504].includes(response.status)) {
        await new Promise((resolve) => setTimeout(resolve, 150))
        continue
      }
      throw new DifyClientError(safeMessage(response.status), response.status)
    }
    circuitState.delete(config.baseUrl)
    return response
  }
  throw new DifyClientError('Dify request failed', 502)
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = (await response.json()) as unknown
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    throw new DifyClientError('Dify returned invalid JSON', 502, 'invalid_json')
  }
}

export async function probeDify(): Promise<{
  configured: boolean
  reachable: boolean
  apps: number
}> {
  const config = getDifyConfig()
  if (!config.enabled) return { configured: false, reachable: false, apps: 0 }
  try {
    // Dify's public nginx route does not expose the API service's internal
    // /health endpoint. The setup endpoint is unauthenticated and provides a
    // stable reachability check for the public console surface.
    const response = await fetch(`${config.baseUrl}/console/api/setup`, {
      signal: AbortSignal.timeout(3_000),
    })
    return {
      configured: true,
      reachable: response.ok,
      apps: config.apps.filter((app) => app.enabled !== false).length,
    }
  } catch {
    return {
      configured: true,
      reachable: false,
      apps: config.apps.filter((app) => app.enabled !== false).length,
    }
  }
}

export async function getDifyAppInfo(appId: string): Promise<DifyAppInfo> {
  return (await readJson(await requestDify(appId, '/info'))) as DifyAppInfo
}

export async function getDifyAppParameters(
  appId: string,
): Promise<DifyAppParameters> {
  return readJson(await requestDify(appId, '/parameters'))
}

export async function runDifyApp(
  appId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const mode: DifyRunMode =
    body.mode === 'workflow'
      ? 'workflow'
      : body.mode === 'completion'
        ? 'completion'
        : 'chat'
  const payload = { ...body }
  delete payload.mode
  if (mode === 'completion' && typeof payload.query === 'string') {
    const inputs =
      payload.inputs &&
      typeof payload.inputs === 'object' &&
      !Array.isArray(payload.inputs)
        ? (payload.inputs as Record<string, unknown>)
        : {}
    if (typeof inputs.query !== 'string') {
      payload.inputs = { ...inputs, query: payload.query }
    }
  }
  const path =
    mode === 'workflow'
      ? '/workflows/run'
      : mode === 'completion'
        ? '/completion-messages'
        : '/chat-messages'
  return requestDify(appId, path, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function stopDifyRun(
  appId: string,
  taskId: string,
  mode: DifyRunMode,
  user = 'hermes-workspace',
): Promise<Record<string, unknown>> {
  const path =
    mode === 'workflow'
      ? `/workflows/tasks/${encodeURIComponent(taskId)}/stop`
      : mode === 'completion'
        ? `/completion-messages/${encodeURIComponent(taskId)}/stop`
        : `/chat-messages/${encodeURIComponent(taskId)}/stop`
  return readJson(
    await requestDify(appId, path, {
      method: 'POST',
      body: JSON.stringify({ user }),
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

export async function uploadDifyFile(
  appId: string,
  file: File,
  user = 'hermes-workspace',
): Promise<Record<string, unknown>> {
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('user', user)
  return readJson(
    await requestDify(appId, '/files/upload', {
      method: 'POST',
      body: form,
    }),
  )
}

export async function resumeDifyWorkflow(
  appId: string,
  runId: string,
  user = 'hermes-workspace',
): Promise<Response> {
  return requestDify(
    appId,
    `/workflow/${encodeURIComponent(runId)}/events?user=${encodeURIComponent(user)}`,
    { headers: { Accept: 'text/event-stream' } },
  )
}
