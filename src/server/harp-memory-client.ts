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

// ---------------------------------------------------------------------------
// Analyst context (Phase 4A)
// ---------------------------------------------------------------------------

type AnalystSearchResult = {
  results?: Array<{ id?: string; content?: unknown; memory_type?: unknown }>
}

const CATEGORY_RULE_CONTENT = /^Categorize finance transactions from "/i
const MAX_MEMORY_CHARS = 240
const MAX_ANALYST_MEMORIES = 6

/**
 * Approved, user-scoped finance preferences/rules to fold into the finance
 * analyst prompt as *context* (never instructions). Category-rule memories
 * (the extraction hints) are excluded — they aren't analyst context. Awaited
 * by the caller with a short budget; `[]` on any failure or when HARP is off.
 */
export async function getUserFinanceMemoriesForPrompt(
  query: string,
): Promise<Array<string>> {
  if (!getConfig()) return []
  const raw = (await call(
    'GET',
    `/api/search?${new URLSearchParams({
      query: query.trim().slice(0, 200) || 'personal finance preferences and rules',
      intent: 'preference',
      scope: 'user',
      limit: '10',
    }).toString()}`,
  )) as AnalystSearchResult | null
  if (!raw || !Array.isArray(raw.results)) return []
  const out: Array<string> = []
  for (const entry of raw.results) {
    if (entry.memory_type === CATEGORY_RULE_TYPE) continue
    const content = typeof entry.content === 'string' ? entry.content.trim() : ''
    if (!content || CATEGORY_RULE_CONTENT.test(content)) continue
    out.push(
      content.length > MAX_MEMORY_CHARS
        ? `${content.slice(0, MAX_MEMORY_CHARS)}…`
        : content,
    )
    if (out.length >= MAX_ANALYST_MEMORIES) break
  }
  return out
}

// ---------------------------------------------------------------------------
// "What the assistant knows" — dashboard panel (Phase 4C)
// ---------------------------------------------------------------------------

const FINANCIAL_RULE_TYPE = 'financial_rule'

export type AssistantMemoryKind =
  | 'category_rule'
  | 'financial_rule'
  | 'other'

export type AssistantMemory = {
  id: string
  content: string
  kind: AssistantMemoryKind
}

/** Whether the HARP memory service is configured for this process. */
export function isHarpMemoryEnabled(): boolean {
  return getConfig() !== null
}

function classifyMemory(
  memoryType: unknown,
  content: string,
): AssistantMemoryKind {
  if (memoryType === CATEGORY_RULE_TYPE || CATEGORY_RULE_CONTENT.test(content)) {
    return 'category_rule'
  }
  if (memoryType === FINANCIAL_RULE_TYPE) return 'financial_rule'
  return 'other'
}

/** Active (approved) user-scoped finance memories, for the dashboard panel. */
export async function listActiveFinanceMemories(): Promise<Array<AssistantMemory>> {
  if (!getConfig()) return []
  const raw = (await call(
    'GET',
    `/api/search?${new URLSearchParams({
      query: 'personal finance rules preferences vendor category',
      intent: 'preference',
      scope: 'user',
      limit: '50',
    }).toString()}`,
  )) as AnalystSearchResult | null
  if (!raw || !Array.isArray(raw.results)) return []
  const out: Array<AssistantMemory> = []
  for (const entry of raw.results) {
    const id = typeof entry.id === 'string' ? entry.id : ''
    const content = typeof entry.content === 'string' ? entry.content.trim() : ''
    if (!id || !content) continue
    out.push({ id, content, kind: classifyMemory(entry.memory_type, content) })
  }
  return out
}

/**
 * Propose a free-text financial rule ("I keep 6 months of expenses in cash")
 * as a governed `preference` candidate. Returns whether it was submitted;
 * it becomes visible in `listActiveFinanceMemories()` only after approval.
 */
export async function proposeFinancialRule(
  rule: string,
): Promise<{ submitted: boolean }> {
  const text = rule.trim()
  if (!text) return { submitted: false }
  const res = (await call('POST', '/api/propose', {
    content: text,
    memory_type: FINANCIAL_RULE_TYPE,
    scope: 'user',
    intent: 'preference',
    data_class: 'confidential',
    source_ref: SOURCE_REF,
    tags: ['finance', 'financial-rule'],
  })) as { accepted?: boolean } | null
  return { submitted: res?.accepted === true }
}

/** Record that a shown memory is wrong / no longer wanted (a review signal). */
export async function flagFinanceMemory(memoryId: string): Promise<void> {
  if (!memoryId) return
  await call('POST', '/api/feedback', {
    memory_id: memoryId,
    useful: false,
    user_corrected: true,
    notes: 'flagged from the personal-finance dashboard',
  })
}

// ---------------------------------------------------------------------------
// Pending-candidate review (Phase 4C follow-up)
// ---------------------------------------------------------------------------

export type PendingFinanceMemory = {
  id: string
  content: string
  kind: AssistantMemoryKind
  createdAt: string | null
}

type CandidatesResult = {
  candidates?: Array<{
    memory_id?: unknown
    content?: unknown
    memory_type?: unknown
    created_at?: unknown
  }>
}

/**
 * Pending finance candidates awaiting review (category_rule / financial_rule
 * only — other repos' candidates are not shown in the finance dashboard).
 */
export async function listPendingFinanceCandidates(): Promise<
  Array<PendingFinanceMemory>
> {
  if (!getConfig()) return []
  const raw = (await call(
    'GET',
    '/api/candidates?limit=100',
  )) as CandidatesResult | null
  if (!raw || !Array.isArray(raw.candidates)) return []
  const out: Array<PendingFinanceMemory> = []
  for (const c of raw.candidates) {
    const id = typeof c.memory_id === 'string' ? c.memory_id : ''
    const content = typeof c.content === 'string' ? c.content.trim() : ''
    if (!id || !content) continue
    const kind = classifyMemory(c.memory_type, content)
    if (kind === 'other') continue // not a finance rule the user authored
    out.push({
      id,
      content,
      kind,
      createdAt: typeof c.created_at === 'string' ? c.created_at : null,
    })
  }
  return out
}

/**
 * Promote a pending candidate to an active memory. `call()` returns null on
 * any non-2xx / failure, so a non-null response means the review landed.
 */
export async function approveMemory(memoryId: string): Promise<{ ok: boolean }> {
  if (!memoryId) return { ok: false }
  const res = await call('POST', '/api/approve', {
    memory_id: memoryId,
    reviewer: 'naveen',
  })
  return { ok: res !== null }
}

/** Mark a pending candidate rejected. */
export async function rejectMemory(memoryId: string): Promise<{ ok: boolean }> {
  if (!memoryId) return { ok: false }
  const res = await call('POST', '/api/reject', {
    memory_id: memoryId,
    reviewer: 'naveen',
  })
  return { ok: res !== null }
}

/** Test-only: drop config + cache. */
export function __resetHarpMemoryClient(): void {
  configResolved = false
  config = null
  searchCache = null
  searchInFlight = null
}
