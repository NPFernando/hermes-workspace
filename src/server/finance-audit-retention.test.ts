import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  auditRetentionReport,
  pruneAuditRecoveryBuffer,
} from './finance-audit-retention'

const temporaryPaths: string[] = []
afterEach(() => {
  for (const file of temporaryPaths.splice(0))
    fs.rmSync(file, { force: true, recursive: true })
})

function fixture(contents: string): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'finance-audit-')), 'audit.jsonl')
  temporaryPaths.push(path.dirname(file))
  fs.writeFileSync(file, contents, { mode: 0o600 })
  return file
}

describe('finance audit retention', () => {
  const now = new Date('2026-09-16T00:00:00.000Z')

  it('reports removable and retained entries without modifying the buffer', () => {
    const file = fixture(
      `${JSON.stringify({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' })}\n${JSON.stringify({ id: 'new', createdAt: '2026-09-15T00:00:00.000Z' })}\n`,
    )
    const report = auditRetentionReport(file, 30, now)
    expect(report).toMatchObject({
      totalLines: 2,
      validEntries: 2,
      retainedEntries: 1,
      removableEntries: 1,
      malformedLines: 0,
    })
    expect(fs.readFileSync(file, 'utf8')).toContain('old')
  })

  it('refuses to prune malformed recovery data', () => {
    const file = fixture('not-json\n')
    expect(() => pruneAuditRecoveryBuffer(file, 30, now)).toThrow('malformed')
  })

  it('atomically keeps only recent entries when explicitly applied', () => {
    const file = fixture(
      `${JSON.stringify({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' })}\n${JSON.stringify({ id: 'new', createdAt: '2026-09-15T00:00:00.000Z' })}\n`,
    )
    const report = pruneAuditRecoveryBuffer(file, 30, now)
    expect(report.removableEntries).toBe(0)
    expect(fs.readFileSync(file, 'utf8')).not.toContain('old')
    expect(fs.readFileSync(file, 'utf8')).toContain('new')
  })
})
