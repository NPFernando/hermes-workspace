const DEFAULT_DIFY_URL = 'http://127.0.0.1:5001'

export type DifyStatus = {
  enabled: boolean
  configured: boolean
  available: boolean
  url: string | null
  detail: string
}

export function difyConfig(): { enabled: boolean; url: string | null } {
  const enabled = ['1', 'true', 'yes'].includes((process.env.DIFY_WORKBENCH_ENABLED || '').trim().toLowerCase())
  const rawUrl = (process.env.DIFY_WORKBENCH_URL || process.env.DIFY_BASE_URL || DEFAULT_DIFY_URL).trim()
  try {
    const parsed = new URL(rawUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) return { enabled, url: null }
    return { enabled, url: parsed.toString().replace(/\/$/, '') }
  } catch {
    return { enabled, url: null }
  }
}

export async function getDifyStatus(fetchImpl = fetch): Promise<DifyStatus> {
  const config = difyConfig()
  if (!config.enabled) return { enabled: false, configured: false, available: false, url: null, detail: 'Dify workbench is disabled.' }
  if (!config.url) return { enabled: true, configured: false, available: false, url: null, detail: 'Dify URL is invalid.' }
  try {
    const response = await fetchImpl(`${config.url}/health`, { signal: AbortSignal.timeout(3000), headers: { accept: 'application/json' } })
    return { enabled: true, configured: true, available: response.ok, url: config.url, detail: response.ok ? 'Dify provider is reachable.' : `Dify provider returned HTTP ${response.status}.` }
  } catch {
    return { enabled: true, configured: true, available: false, url: config.url, detail: 'Dify provider is not reachable.' }
  }
}
