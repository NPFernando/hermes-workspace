import { describe, expect, it } from 'vitest'
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
})
