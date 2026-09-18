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
})
