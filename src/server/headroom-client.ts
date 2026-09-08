/**
 * Best-effort read client for the local Headroom context-compression proxy
 * (`headroom-proxy.service`, default `http://127.0.0.1:8787`). Headroom sits in
 * front of Hermes' delegated-subagent OpenRouter traffic and compresses tool
 * output / logs / RAG chunks before they reach the model.
 *
 * This module only *reads* the proxy's `/stats` endpoint for the Ops → Cost
 * screen. Every call is time-boxed (1.5 s) and returns `null` on any failure —
 * a stopped proxy just means the Headroom panel shows "not running", never an
 * error. Mirrors `harp-memory-client.ts`.
 */
const DEFAULT_URL = 'http://127.0.0.1:8787'
const REQUEST_TIMEOUT_MS = 1500

function baseUrl(): string {
  return (process.env.HEADROOM_STATS_URL || DEFAULT_URL).replace(/\/$/, '')
}

/** Shape returned to the Ops screen — a trimmed projection of `/stats`. */
export interface HeadroomStats {
  running: true
  apiRequests: number
  requestsCompressed: number
  avgCompressionPct: number
  bestCompressionPct: number
  tokensSaved: number
  tokensBefore: number
  costSavedUsd: number
  savingsPct: number
  agents: Array<{
    label: string
    requests: number
    tokensSaved: number
    savingsPercent: number
    topModels: Array<{ model: string; requests: number }>
  }>
}

type RawStats = {
  summary?: {
    api_requests?: unknown
    compression?: {
      requests_compressed?: unknown
      avg_compression_pct?: unknown
      best_compression_pct?: unknown
      total_tokens_removed?: unknown
      total_tokens_before?: unknown
      total_tokens_saved_all_layers?: unknown
    }
    cost?: { total_saved_usd?: unknown; savings_pct?: unknown }
  }
  agent_usage?: {
    agents?: Array<{
      label?: unknown
      agent?: unknown
      requests?: unknown
      tokens_saved?: unknown
      savings_percent?: unknown
      models?: Record<string, unknown>
    }>
  }
}

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0

/**
 * Fetch + normalize the proxy's compression stats. `null` when the proxy is not
 * reachable within the timeout (treated as "Headroom not running").
 */
export async function getHeadroomStats(): Promise<HeadroomStats | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${baseUrl()}/stats`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!res.ok) return null
    const raw = (await res.json()) as RawStats
    const c = raw.summary?.compression ?? {}
    const cost = raw.summary?.cost ?? {}
    const agents = (raw.agent_usage?.agents ?? []).map((a) => ({
      label:
        typeof a.label === 'string'
          ? a.label
          : typeof a.agent === 'string'
            ? a.agent
            : 'unknown',
      requests: num(a.requests),
      tokensSaved: num(a.tokens_saved),
      savingsPercent: num(a.savings_percent),
      topModels: Object.entries(a.models ?? {})
        .map(([model, n]) => ({ model, requests: num(n) }))
        .sort((x, y) => y.requests - x.requests)
        .slice(0, 3),
    }))
    return {
      running: true,
      apiRequests: num(raw.summary?.api_requests),
      requestsCompressed: num(c.requests_compressed),
      avgCompressionPct: num(c.avg_compression_pct),
      bestCompressionPct: num(c.best_compression_pct),
      tokensSaved: num(c.total_tokens_saved_all_layers ?? c.total_tokens_removed),
      tokensBefore: num(c.total_tokens_before),
      costSavedUsd: num(cost.total_saved_usd),
      savingsPct: num(cost.savings_pct),
      agents,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
