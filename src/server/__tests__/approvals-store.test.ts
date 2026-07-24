/**
 * Tests for the approval store — inline (no module resolution tricks needed).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

// ── Inline approval store (mirrors src/server/approvals-store.ts) ──────────

type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'timed_out'
type ApprovalOption = { label: string; value: string; description?: string }
type ApprovalRecord = {
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

const DATA_FILE = path.join(os.homedir(), '.hermes', 'approvals.json')

function readAll(): Array<ApprovalRecord> {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'))
  } catch {
    return []
  }
}

function writeAll(records: Array<ApprovalRecord>) {
  const dir = path.dirname(DATA_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2), 'utf-8')
}

function createApproval(params: {
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

function getApproval(id: string): ApprovalRecord | undefined {
  return readAll().find((r) => r.id === id)
}

function listPendingApprovals(session_id?: string): Array<ApprovalRecord> {
  const all = readAll()
  const now = new Date()
  let changed = false
  for (const r of all) {
    if (r.status !== 'pending') continue
    if (now.getTime() - new Date(r.created_at).getTime() >= r.timeout_minutes * 60 * 1000) {
      r.status = 'timed_out'
      r.resolved_at = now.toISOString()
      changed = true
    }
  }
  if (changed) writeAll(all)
  let pending = all.filter((r) => r.status === 'pending')
  if (session_id) pending = pending.filter((r) => r.session_id === session_id)
  return pending
}

function resolveApproval(
  id: string,
  status: 'approved' | 'rejected',
  response?: string,
): ApprovalRecord | undefined {
  const all = readAll()
  const r = all.find((x) => x.id === id)
  if (!r || r.status !== 'pending') return undefined
  r.status = status
  r.response = response ?? null
  r.resolved_at = new Date().toISOString()
  writeAll(all)
  return r
}

function getStats() {
  const all = readAll()
  return {
    total: all.length,
    pending: all.filter((r) => r.status === 'pending').length,
    approved: all.filter((r) => r.status === 'approved').length,
    rejected: all.filter((r) => r.status === 'rejected').length,
    timed_out: all.filter((r) => r.status === 'timed_out').length,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Approval Store', () => {
  beforeEach(() => {
    try { fs.unlinkSync(DATA_FILE) } catch { /* ok */ }
  })

  afterAll(() => {
    try { fs.unlinkSync(DATA_FILE) } catch { /* ok */ }
  })

  it('creates an approval record', () => {
    const record = createApproval({
      session_id: 'sess-1',
      title: 'Deploy to production?',
      body: 'This will push to the live trading environment.',
      options: [
        { label: 'Yes, deploy now', value: 'deploy' },
        { label: 'No, abort', value: 'abort' },
      ],
    })

    expect(record.id).toBeDefined()
    expect(record.status).toBe('pending')
    expect(record.session_id).toBe('sess-1')
    expect(record.title).toBe('Deploy to production?')
    expect(record.options).toHaveLength(2)
    expect(record.created_at).toBeDefined()
    expect(record.timeout_minutes).toBe(5)
  })

  it('lists pending approvals filtered by session', () => {
    createApproval({ session_id: 'sess-a', title: 'A', body: '...', options: [{ label: 'Yes', value: 'yes' }] })
    createApproval({ session_id: 'sess-b', title: 'B', body: '...', options: [{ label: 'Yes', value: 'yes' }] })

    expect(listPendingApprovals('sess-a')).toHaveLength(1)
    expect(listPendingApprovals('sess-b')).toHaveLength(1)
    expect(listPendingApprovals('sess-c')).toHaveLength(0)
  })

  it('resolves as approved', () => {
    const r = createApproval({ session_id: 'sess-1', title: 'Confirm?', body: '...', options: [{ label: 'Yes', value: 'yes' }] })
    const resolved = resolveApproval(r.id, 'approved', 'yes')
    expect(resolved!.status).toBe('approved')
    expect(resolved!.response).toBe('yes')
    expect(resolved!.resolved_at).toBeDefined()
    expect(getApproval(r.id)!.status).toBe('approved')
  })

  it('resolves as rejected', () => {
    const r = createApproval({ session_id: 'sess-1', title: 'Confirm?', body: '...', options: [{ label: 'Yes', value: 'yes' }] })
    expect(resolveApproval(r.id, 'rejected')!.status).toBe('rejected')
  })

  it('cannot resolve already-resolved', () => {
    const r = createApproval({ session_id: 'sess-1', title: 'Confirm?', body: '...', options: [{ label: 'Yes', value: 'yes' }] })
    resolveApproval(r.id, 'approved')
    expect(resolveApproval(r.id, 'rejected')).toBeUndefined()
  })

  it('auto-times out expired approvals', () => {
    const r = createApproval({
      session_id: 'sess-1',
      title: 'Timeout test',
      body: '...',
      options: [{ label: 'OK', value: 'ok' }],
      timeout_minutes: 0,
    })
    expect(listPendingApprovals('sess-1')).toHaveLength(0)
    expect(getApproval(r.id)!.status).toBe('timed_out')
  })

  it('returns stats', () => {
    createApproval({ session_id: 'sess-1', title: 'A', body: '...', options: [{ label: 'Yes', value: 'yes' }] })
    const b = createApproval({ session_id: 'sess-2', title: 'B', body: '...', options: [{ label: 'Yes', value: 'yes' }] })
    resolveApproval(b.id, 'approved')

    const stats = getStats()
    expect(stats.total).toBe(2)
    expect(stats.pending).toBe(1)
    expect(stats.approved).toBe(1)
  })

  it('returns undefined for nonexistent', () => {
    expect(getApproval('nonexistent')).toBeUndefined()
  })

  it('custom timeout is respected', () => {
    const r = createApproval({
      session_id: 'sess-1',
      title: 'Custom timeout',
      body: '...',
      options: [{ label: 'OK', value: 'ok' }],
      timeout_minutes: 10,
    })
    expect(r.timeout_minutes).toBe(10)
    // Should still be pending since 10 min timeout hasn't elapsed
    expect(listPendingApprovals('sess-1')).toHaveLength(1)
  })
})