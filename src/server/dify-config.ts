export type DifyAppMode =
  | 'chat'
  | 'completion'
  | 'workflow'
  | 'agent'
  | 'advanced-chat'
  | 'unknown'

export type DifyAppRegistration = {
  id: string
  label: string
  keyEnv: string
  enabled?: boolean
  rateLimit?: number
}

export type DifyConfig = {
  enabled: boolean
  baseUrl: string
  apps: Array<DifyAppRegistration>
  errors: Array<string>
  allowedFileTypes: Array<string>
  fileScannerCommand: string
}

function readBoolean(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true'
}

function normalizeBaseUrl(value: string | undefined): string {
  return (value || '').trim().replace(/\/+$/, '')
}

function readApps(value: string | undefined): Array<DifyAppRegistration> {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const candidate = entry as Record<string, unknown>
      const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
      const label =
        typeof candidate.label === 'string' ? candidate.label.trim() : ''
      const keyEnv =
        typeof candidate.keyEnv === 'string' ? candidate.keyEnv.trim() : ''
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !label || !keyEnv) return []
      const configuredRate = Number(candidate.rateLimit)
      const rateLimit =
        Number.isFinite(configuredRate) && configuredRate > 0
          ? Math.floor(configuredRate)
          : undefined
      return [
        { id, label, keyEnv, enabled: candidate.enabled !== false, rateLimit },
      ]
    })
  } catch {
    return []
  }
}

function readFileTypes(value: string | undefined): Array<string> {
  const defaults = [
    'application/pdf',
    'application/json',
    'text/plain',
    'text/markdown',
    'image/png',
    'image/jpeg',
    'image/webp',
  ]
  if (!value?.trim()) return defaults
  return value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item === '*/*' || /^[\w.+-]+\/[\w.+*-]+$/.test(item))
}

export function getDifyConfig(): DifyConfig {
  const baseUrl = normalizeBaseUrl(process.env.DIFY_BASE_URL)
  const apps = readApps(process.env.DIFY_APPS_JSON)
  const enabled = readBoolean(process.env.DIFY_ENABLED)
  const errors: Array<string> = []
  if (enabled && !baseUrl) errors.push('DIFY_BASE_URL is required when enabled')
  if (process.env.DIFY_APPS_JSON && apps.length === 0) {
    errors.push('DIFY_APPS_JSON contains no valid app registrations')
  }
  return {
    enabled: enabled && Boolean(baseUrl),
    baseUrl,
    apps,
    errors,
    allowedFileTypes: readFileTypes(process.env.DIFY_ALLOWED_FILE_TYPES),
    fileScannerCommand: (process.env.DIFY_FILE_SCANNER_COMMAND || '').trim(),
  }
}

export function getDifyApp(
  appId: string,
  config = getDifyConfig(),
): DifyAppRegistration | null {
  return (
    config.apps.find((app) => app.id === appId && app.enabled !== false) ?? null
  )
}

export function getDifyAppKey(app: DifyAppRegistration): string {
  return process.env[app.keyEnv]?.trim() || ''
}
