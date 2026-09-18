import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildRoadmapAudit } from './roadmap-completion-audit.mjs'

describe('roadmap completion audit', () => {
  it('never treats implementation files or an active service as completion proof', () => {
    const report = buildRoadmapAudit({
      root: process.cwd(),
      run: (file, args) => file === 'systemctl' ? 'active' : file === 'git' ? 'test-head' : '',
    })
    expect(report.serviceActive).toBe(true)
    expect(report.items).toHaveLength(20)
    expect(report.ok).toBe(false)
    expect(report.items.some((item) => item.status === 'implemented-awaiting-live-evidence')).toBe(true)
    expect(report.items[19].liveEvidence).toBe(false)
    expect(report.items[19].liveEvidenceDetail).toMatch(/preceding roadmap item/)
  })

  it('verifies credential rotation only when configured credentials are tracked and current', () => {
    const run = (file, args) => {
      if (file === 'systemctl') return 'active'
      if (file === 'git') return 'test-head'
      if (args?.[0] === 'scripts/secrets-rotation.mjs') {
        return JSON.stringify({
          status: [
            { key: 'HERMES_PASSWORD', configured: true, state: 'valid' },
            { key: 'OPENROUTER_API_KEY', configured: true, state: 'expiring' },
          ],
        })
      }
      return ''
    }
    const report = buildRoadmapAudit({ root: process.cwd(), run })
    expect(report.items[3]).toMatchObject({
      status: 'verified',
      liveEvidence: true,
    })
  })

  it('does not accept missing authenticated evidence for protected roadmap items', () => {
    const report = buildRoadmapAudit({
      root: process.cwd(),
      run: (file) => file === 'systemctl' ? 'active' : file === 'git' ? 'test-head' : '',
    })
    expect(report.items[4].liveEvidence).toBe(false)
    expect(report.items[2].liveEvidence).toBe(false)
    expect(report.items[13].liveEvidence).toBe(false)
    expect(report.items[17].liveEvidence).toBe(false)
    expect(report.items[18].liveEvidence).toBe(false)
  })

  it('requires a fresh successful Astrology authenticated-smoke workflow', () => {
    const run = (file, args) => {
      if (file === 'systemctl') return 'active'
      if (file === 'git') return 'test-head'
      if (file === 'gh' && args[0] === 'run') {
        return JSON.stringify([{
          status: 'completed',
          conclusion: 'success',
          createdAt: new Date().toISOString(),
          headSha: 'astrology-test-head',
        }])
      }
      return ''
    }
    const report = buildRoadmapAudit({ root: process.cwd(), run })
    expect(report.items[0]).toMatchObject({ status: 'verified', liveEvidence: true })
  })

  it('requires explicit passed off-site round-trip evidence for Finance item 2', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hermes-roadmap-dr-'))
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'exercise-20260918120000.json'), JSON.stringify({
      ok: true,
      results: [{
        name: 'finance-offsite-round-trip',
        status: 'passed',
        output: { roundTripVerified: true },
      }],
    }))
    const previous = process.env.HERMES_DR_EVIDENCE_DIR
    process.env.HERMES_DR_EVIDENCE_DIR = directory
    try {
      const report = buildRoadmapAudit({
        root: process.cwd(),
        run: (file) => file === 'systemctl' ? 'active' : file === 'git' ? 'test-head' : '',
      })
      expect(report.items[1]).toMatchObject({ status: 'verified', liveEvidence: true })
    } finally {
      if (previous === undefined) delete process.env.HERMES_DR_EVIDENCE_DIR
      else process.env.HERMES_DR_EVIDENCE_DIR = previous
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
