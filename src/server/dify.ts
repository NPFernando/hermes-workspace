export type DifyStatus = {
  enabled: boolean
  configured: boolean
  available: boolean
  url: string | null
  detail: string
}

function safeHttpUrl(raw: string | undefined): string | null {
  if (!raw?.trim()) return null
  try {
    const parsed = new URL(raw.trim())
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export function difyConfig(): { enabled: boolean; url: string | null; healthUrl: string | null } {
  const enabled = ['1', 'true', 'yes'].includes((process.env.DIFY_WORKBENCH_ENABLED || '').trim().toLowerCase())
  const url = safeHttpUrl(process.env.DIFY_WORKBENCH_URL || process.env.DIFY_BASE_URL)
  const rawHealthUrl = process.env.DIFY_HEALTHCHECK_URL
  const healthUrl = rawHealthUrl ? safeHttpUrl(rawHealthUrl) : url
  return { enabled, url, healthUrl }
}

export async function getDifyStatus(fetchImpl = fetch): Promise<DifyStatus> {
  const config = difyConfig()
  if (!config.enabled) return { enabled: false, configured: false, available: false, url: null, detail: 'Dify workbench is disabled.' }
  if (!config.url || !config.healthUrl) return { enabled: true, configured: false, available: false, url: null, detail: 'Set a browser-reachable DIFY_WORKBENCH_URL using http or https; URL credentials, query strings, and fragments are not accepted.' }
  try {
    const response = await fetchImpl(`${config.healthUrl}/`, { signal: AbortSignal.timeout(3000), headers: { accept: 'text/html,application/json' } })
    return { enabled: true, configured: true, available: response.ok, url: config.url, detail: response.ok ? 'Dify provider is reachable.' : `Dify provider returned HTTP ${response.status}.` }
  } catch {
    return { enabled: true, configured: true, available: false, url: config.url, detail: 'Dify provider is not reachable.' }
  }
}
