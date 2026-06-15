import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const METADATA_PATH = path.join(os.homedir(), '.hindsight', 'profiles', 'metadata.json')
const HERMES_PROFILE = 'hermes'
const BANK = 'hermes'
const CONFIG_PATH = path.join(os.homedir(), '.hermes', 'hindsight', 'config.json')
const DLQ_PATH = path.join(os.homedir(), '.hindsight', 'retain_dlq.jsonl')

function getHindsightPort(): number {
  try {
    const metadata = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf-8')) as {
      profiles?: Record<string, { port?: number }>
    }
    return metadata?.profiles?.[HERMES_PROFILE]?.port ?? 9177
  } catch {
    return 9177
  }
}

export function getHindsightBaseUrl(): string {
  return `http://localhost:${getHindsightPort()}`
}

export type HindsightMemory = {
  id: string
  text: string
  context: string
  date: string
  fact_type: string
  mentioned_at: string
  occurred_start: string | null
  occurred_end: string | null
  entities: string
  chunk_id: string | null
  proof_count: number
  tags: string[]
  consolidated_at: string | null
  consolidation_failed_at: string | null
}

export type HindsightRecallResult = {
  id: string
  text: string
  type: string
  entities: string[]
  context: string | null
  occurred_start: string | null
  occurred_end: string | null
  mentioned_at: string
  document_id: string | null
  metadata: Record<string, unknown>
  chunk_id: string | null
  tags: string[]
}

export type HindsightOperation = {
  id: string
  task_type: string
  items_count: number
  document_id: string | null
  created_at: string
  status: string
  error_message: string | null
  retry_count: number
  next_retry_at: string | null
}

async function hFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${getHindsightBaseUrl()}${endpoint}`, {
    ...options,
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Hindsight ${endpoint} → ${res.status}`)
  return res.json() as Promise<T>
}

export function getHindsightConfig(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function getDlqCount(): number {
  try {
    const content = fs.readFileSync(DLQ_PATH, 'utf-8')
    return content.split('\n').filter((l) => l.trim()).length
  } catch {
    return 0
  }
}

export async function getHindsightHealth(): Promise<{ status: string; database: string }> {
  return hFetch('/health')
}

export async function getHindsightStats(): Promise<Record<string, unknown>> {
  return hFetch(`/v1/default/banks/${BANK}/stats`)
}

export async function listHindsightMemories(opts: {
  q?: string
  limit?: number
  offset?: number
}): Promise<{ items: HindsightMemory[]; total: number; limit: number; offset: number }> {
  const params = new URLSearchParams()
  if (opts.q) params.set('q', opts.q)
  params.set('limit', String(opts.limit ?? 50))
  params.set('offset', String(opts.offset ?? 0))
  return hFetch(`/v1/default/banks/${BANK}/memories/list?${params.toString()}`)
}

export async function recallHindsight(
  query: string,
  budget = 'mid',
): Promise<{ results: HindsightRecallResult[] }> {
  return hFetch(`/v1/default/banks/${BANK}/memories/recall`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, budget }),
  })
}

export async function listHindsightOperations(
  limit = 20,
): Promise<{ operations: HindsightOperation[]; total: number }> {
  return hFetch(`/v1/default/banks/${BANK}/operations?limit=${limit}`)
}

export async function retainHindsight(
  content: string,
  context?: string,
): Promise<{ operation_id: string }> {
  return hFetch(`/v1/default/banks/${BANK}/files/retain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ content, ...(context ? { context } : {}), metadata: { source: 'manual_ui' } }],
      async: true,
    }),
  })
}

export async function deleteHindsightMemory(memoryId: string): Promise<void> {
  await hFetch(`/v1/default/banks/${BANK}/memories/${encodeURIComponent(memoryId)}/observations`, {
    method: 'DELETE',
  })
}
