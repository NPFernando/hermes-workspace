/**
 * Approval store — manages pending workflow approvals.
 *
 * Each approval is a request from an agent asking the user to confirm or choose
 * an action. The UI renders these as SelectionCard messages in chat.
 *
 * Stored in ~/.hermes/approvals.json.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'timed_out'

export type ApprovalOption = {
  label: string
  value: string
  description?: string
}

export type ApprovalRecord = {
  id: string
  session_id: string
  task_id?: string | null
  title: string
  body: string
  options: Array<ApprovalOption>
  status: ApprovalStatus
  response?: string | null
  created_at: string
  resolved_at?: string | null
  timeout_minutes: number
}

const DATA_DIR = path.join(os.homedir(), '.hermes')
const DATA_FILE = path.join(DATA_DIR, 'approvals.json')

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function readAll(): Array<ApprovalRecord> {
  ensureDir()
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function writeAll(records: Array<ApprovalRecord>) {
  ensureDir()
  fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2), 'utf-8')
}

// ── Public API ──────────────────────────────────────────────────────────────

export function createApproval(params: {
  session_id: string
  task_id?: string | null
  title: string
  body: string
  options: Array<ApprovalOption>
  timeout_minutes?: number
}): ApprovalRecord {
  const record: ApprovalRecord = {
    id: randomUUID(),
    session_id: params.session_id,
    task_id: params.task_id ?? null,
    title: params.title,
    body: params.body,
    options: params.options,
    status: 'pending',
    response: null,
    created_at: new Date().toISOString(),
    resolved_at: null,
    timeout_minutes: params.timeout_minutes ?? 5,
  }

  const all = readAll()
  all.push(record)
  writeAll(all)
  return record
}

export function getApproval(id: string): ApprovalRecord | undefined {
  return readAll().find((r) => r.id === id)
}

export function listPendingApprovals(session_id?: string): Array<ApprovalRecord> {
  const all = readAll()
  const now = new Date()

  // Auto-timeout expired approvals
  let changed = false
  for (const record of all) {
    if (record.status !== 'pending') continue
    const createdAt = new Date(record.created_at)
    const timeoutMs = record.timeout_minutes * 60 * 1000
    if (now.getTime() - createdAt.getTime() >= timeoutMs) {
      record.status = 'timed_out'
      record.resolved_at = now.toISOString()
      changed = true
    }
  }
  if (changed) writeAll(all)

  let pending = all.filter((r) => r.status === 'pending')
  if (session_id) {
    pending = pending.filter((r) => r.session_id === session_id)
  }
  return pending
}

export function resolveApproval(
  id: string,
  status: 'approved' | 'rejected',
  response?: string,
): ApprovalRecord | undefined {
  const all = readAll()
  const record = all.find((r) => r.id === id)
  if (!record) return undefined
  if (record.status !== 'pending') return undefined

  record.status = status
  record.response = response ?? null
  record.resolved_at = new Date().toISOString()
  writeAll(all)
  return record
}

export function getPendingApprovalForSession(
  session_id: string,
): ApprovalRecord | undefined {
  return listPendingApprovals(session_id)[0] ?? undefined
}

export function getStats(): {
  total: number
  pending: number
  approved: number
  rejected: number
  timed_out: number
} {
  const all = readAll()
  return {
    total: all.length,
    pending: all.filter((r) => r.status === 'pending').length,
    approved: all.filter((r) => r.status === 'approved').length,
    rejected: all.filter((r) => r.status === 'rejected').length,
    timed_out: all.filter((r) => r.status === 'timed_out').length,
  }
}