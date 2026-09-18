import { describe, expect, it } from 'vitest'
import {
  getCrossRepositoryReleaseStatus,
} from './cross-repository-release-status'
import type { ReleaseRepository } from './cross-repository-release-status'

const repositories: Array<ReleaseRepository> = [
  { id: 'hermes', label: 'Hermes', slug: 'NPFernando/hermes-workspace' },
  { id: 'harp', label: 'HARP', slug: 'NPFernando/harp-control-plane' },
]

describe('cross-repository release status', () => {
  it('normalizes metadata and the latest workflow into operator-safe statuses', async () => {
    const report = await getCrossRepositoryReleaseStatus({
      repositories,
      run: (args) => args[0] === 'repo'
        ? { stdout: JSON.stringify({ defaultBranchRef: { name: 'main' }, pushedAt: '2026-09-18T00:00:00Z' }), stderr: '' }
        : { stdout: JSON.stringify([{ workflowName: 'CI', status: 'completed', conclusion: 'success', headSha: 'abc123', createdAt: '2026-09-18T01:00:00Z' }]), stderr: '' },
    })
    expect(report.repositories).toEqual([
      expect.objectContaining({ id: 'hermes', status: 'pass', defaultBranch: 'main', latestRun: expect.objectContaining({ conclusion: 'success' }) }),
      expect.objectContaining({ id: 'harp', status: 'pass' }),
    ])
  })

  it('keeps one repository failure isolated and value-blind', async () => {
    const report = await getCrossRepositoryReleaseStatus({
      repositories,
      run: (args) => {
        if (args.includes('NPFernando/harp-control-plane')) throw new Error('GitHub CLI unavailable')
        return args[0] === 'repo'
          ? { stdout: JSON.stringify({ defaultBranchRef: { name: 'main' } }), stderr: '' }
          : { stdout: '[]', stderr: '' }
      },
    })
    expect(report.repositories[0].status).toBe('degraded')
    expect(report.repositories[1]).toMatchObject({ status: 'unavailable', detail: 'GitHub CLI unavailable' })
  })
})
