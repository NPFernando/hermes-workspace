/**
 * Thin client for the localhost HARP memory HTTP API
 * (`harp-memory-api.service`, `127.0.0.1:8765`).
 *
 * Used to store the vendor -> category rules the user teaches at
 * ingestion-confirm time as *governed* HARP `preference` candidates (scope
 * `user`, `data_class: confidential`) instead of only an ungoverned flat map
 * on `FinanceSettings.categoryCorrections`. HARP gives them provenance,
 * review, confidence and decay; the flat map stays as an instant
 * write-through cache and offline fallback.
 *
 * Every call is best-effort and time-boxed: a missing token/URL, a down
 * service, or a slow response degrades to a no-op. HARP being unavailable must
 * never slow or break ingestion — mirroring `research-store.ts`.
 */
const DEFAULT_URL = 'http://127.0.0.1:8765'
const REQUEST_TIMEOUT_MS = 1500
const SEARCH_CACHE_TTL_MS = 60_000
const CATEGORY_RULE_TYPE = 'category_rule'
const SOURCE_REF = 'hermes-finance'

type Config = { url: string; token: string } | null

let configResolved = false
let config: Config = null

function getConfig(): Config {
  if (configResolved) return config
  configResolved = true
  const token = process.env.HARP_MEMORY_API_TOKEN
  if (!token) {
    config = null
    return config
  }
  config = { url: process.env.HARP_MEMORY_API_URL || DEFAULT_URL, token }
  return config
}

async function call(
  method: 'GET' | 'POST',
  routePath: string,
  body?: unknown,
): Promise<unknown | null> {
  const cfg = getConfig()
  if (!cfg) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${cfg.url}${routePath}`, {
      method,
      headers: {
        authorization: `Bearer ${cfg.token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    if (!res.ok) return null
    return (await res.json()) as unknown
  } catch {
    // timeout / connection refused / bad JSON — treated as "HARP unavailable".
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Category rules
// ---------------------------------------------------------------------------

function categoryRuleContent(vendor: string, category: string): string {
  return `Categorize finance transactions from "${vendor}" as "${category}".`
}

/**
 * Propose a vendor -> category rule as a HARP `preference` candidate.
 * Fire-and-forget: callers `void` this. Promotion to an active memory still
 * requires `harp memory approve` (or the dashboard panel).
 */
export async function proposeCategoryPreference(input: {
  vendor: string
  category: string
}): Promise<void> {
  const vendor = input.vendor.trim()
  const category = input.category.trim()
  if (!vendor || !category) return
  await call('POST', '/api/propose', {
    content: categoryRuleContent(vendor, category),
    memory_type: CATEGORY_RULE_TYPE,
    scope: 'user',
    intent: 'preference',
    data_class: 'confidential',
    source_ref: SOURCE_REF,
    tags: ['finance', 'category-rule'],
    metadata: { vendor: vendor.toLowerCase(), category },
  })
}

type SearchResult = {
  results?: Array<{
    id?: string
    content?: string
    metadata?: { vendor?: unknown; category?: unknown }
  }>
}

let searchCache: { at: number; map: Record<string, string> } | null = null
let searchInFlight: Promise<void> | null = null

function extractRule(
  entry: NonNullable<SearchResult['results']>[number],
): [string, string] | null {
  const meta = entry.metadata ?? {}
  let vendor = typeof meta.vendor === 'string' ? meta.vendor : ''
  let category = typeof meta.category === 'string' ? meta.category : ''
  if ((!vendor || !category) && typeof entry.content === 'string') {
    // Fallback for candidates proposed elsewhere without structured metadata:
    // `Categorize finance transactions from "X" as "Y".`
    const m = entry.content.match(/from "([^"]+)" as "([^"]+)"/i)
    if (m) {
      vendor = vendor || m[1]
      category = category || m[2]
    }
  }
  vendor = vendor.trim().toLowerCase()
  category = category.trim()
  return vendor && category ? [vendor, category] : null
}

/** Background refresh of the active-memory cache (never awaited by callers). */
function refreshCategoryPreferenceCache(): void {
  if (!getConfig()) return
  if (searchInFlight) return
  if (searchCache && Date.now() - searchCache.at < SEARCH_CACHE_TTL_MS) return
  searchInFlight = (async () => {
    const raw = (await call(
      'GET',
      `/api/search?${new URLSearchParams({
        query: 'finance vendor category rule',
        intent: 'preference',
        scope: 'user',
        limit: '50',
      }).toString()}`,
    )) as SearchResult | null
    if (raw && Array.isArray(raw.results)) {
      const map: Record<string, string> = {}
      for (const entry of raw.results) {
        const rule = extractRule(entry)
        if (rule) map[rule[0]] = rule[1]
      }
      searchCache = { at: Date.now(), map }
    } else if (!searchCache) {
      // Service reachable but nothing yet — cache an empty result so we don't
      // hammer it, but keep the short TTL.
      searchCache = { at: Date.now(), map: {} }
    }
  })().finally(() => {
    searchInFlight = null
  })
}

/**
 * Synchronous view of the approved HARP category rules (last background
 * refresh). Kicks off a refresh if the cache is stale. Empty when HARP is
 * disabled or has not been reached yet — callers merge this over the flat map.
 */
export function getCachedCategoryPreferences(): Record<string, string> {
  refreshCategoryPreferenceCache()
  return searchCache?.map ?? {}
}

/** Test-only: drop config + cache. */
export function __resetHarpMemoryClient(): void {
  configResolved = false
  config = null
  searchCache = null
  searchInFlight = null
}
