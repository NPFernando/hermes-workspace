import { describe, expect, it } from 'vitest'
import { buildReleaseHealthReport } from './release-health-audit.mjs'

function runner({ failingPull = false, failedRun = false } = {}) {
  return (args) => {
    if (args[0] === 'repo') {
      return { defaultBranchRef: { name: 'main' }, pushedAt: '2026-09-18T00:00:00Z' }
    }
    if (args[0] === 'run') {
      return [{
        status: 'completed',
        conclusion: failedRun ? 'failure' : 'success',
        headSha: 'abc123',
        workflowName: 'CI',
        createdAt: '2026-09-18T00:00:00Z',
      }]
    }
    return failingPull
      ? [{ number: 7, isDraft: false, reviewDecision: 'REVIEW_REQUIRED', statusCheckRollup: [{ conclusion: 'FAILURE' }], updatedAt: '2026-09-18T00:00:00Z' }]
      : []
  }
}

describe('cross-repository release health audit', () => {
  it('passes only when every repository has successful CI and no failing PR checks', () => {
    const report = buildReleaseHealthReport({ repos: ['example/one', 'example/two'], run: runner() })
    expect(report.ok).toBe(true)
    expect(report.repositories.every((repo) => repo.status === 'pass')).toBe(true)
  })

  it('preserves explicit CI and pull-request blockers', () => {
    const report = buildReleaseHealthReport({ repos: ['example/one', 'example/two'], run: runner({ failingPull: true, failedRun: true }) })
    expect(report.ok).toBe(false)
    expect(report.repositories[0].blockers).toContain('latest workflow is not a completed success')
    expect(report.repositories[0].blockers).toContain('1 open pull request(s) have failing checks')
  })
})
