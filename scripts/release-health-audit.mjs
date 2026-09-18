#!/usr/bin/env node
/**
 * Read-only cross-repository release evidence for the roadmap audit.
 *
 * This intentionally uses GitHub CLI JSON responses and emits no titles,
 * credentials, or repository contents beyond the configured public metadata.
 * Every repository must have accessible metadata and a completed successful
 * workflow before the report can pass.
 */
import { execFileSync } from 'node:child_process'

const MAX_EVIDENCE_AGE_MS = 48 * 60 * 60 * 1000

const repositories = (process.env.HERMES_RELEASE_REPOSITORIES || [
  'NPFernando/fernandofamily-astrology',
  'NPFernando/hermes-workspace',
  'NPFernando/harp-control-plane',
  'NPFernando/workspace-session-manager',
].join(','))
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

function gh(args) {
  return JSON.parse(execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
  }))
}

function inspect(slug, run = gh) {
  try {
    const metadata = run(['repo', 'view', slug, '--json', 'defaultBranchRef,pushedAt'])
    const runs = run(['run', 'list', '--repo', slug, '--limit', '1', '--json', 'status,conclusion,headSha,workflowName,createdAt'])
    const pulls = run(['pr', 'list', '--repo', slug, '--state', 'open', '--limit', '20', '--json', 'number,isDraft,reviewDecision,statusCheckRollup,updatedAt'])
    const latest = Array.isArray(runs) ? runs[0] : null
    const openPullRequests = Array.isArray(pulls)
      ? pulls.map((pull) => ({
          number: pull.number,
          isDraft: pull.isDraft === true,
          reviewDecision: pull.reviewDecision ?? null,
          failingChecks: (pull.statusCheckRollup ?? []).filter((check) =>
            check.conclusion === 'FAILURE' ||
            check.conclusion === 'CANCELLED' ||
            check.state === 'FAILURE',
          ).length,
          updatedAt: pull.updatedAt ?? null,
        }))
      : []
    const workflowPassed = Boolean(
      latest &&
        latest.status === 'completed' &&
        latest.conclusion === 'success' &&
        latest.createdAt &&
        Date.now() - Date.parse(latest.createdAt) <= MAX_EVIDENCE_AGE_MS,
    )
    const stale = Boolean(
      latest &&
        (!latest.createdAt || Date.now() - Date.parse(latest.createdAt) > MAX_EVIDENCE_AGE_MS),
    )
    const failingPrs = openPullRequests.filter((pull) => pull.failingChecks > 0).length
    return {
      slug,
      status: workflowPassed && failingPrs === 0 ? 'pass' : 'fail',
      defaultBranch: metadata.defaultBranchRef?.name ?? null,
      pushedAt: metadata.pushedAt ?? null,
      latestRun: latest
        ? {
            workflow: latest.workflowName ?? null,
            status: latest.status ?? null,
            conclusion: latest.conclusion ?? null,
            headSha: latest.headSha ?? null,
            createdAt: latest.createdAt ?? null,
            stale,
          }
        : null,
      openPullRequests,
      blockers: [
        !latest && 'no workflow run found',
        stale && 'latest workflow evidence is stale',
        latest && !workflowPassed && 'latest workflow is not a completed success',
        failingPrs > 0 && `${failingPrs} open pull request(s) have failing checks`,
      ].filter(Boolean),
    }
  } catch (error) {
    return {
      slug,
      status: 'unavailable',
      defaultBranch: null,
      pushedAt: null,
      latestRun: null,
      openPullRequests: [],
      blockers: [error instanceof Error ? error.message.replace(/\s+/g, ' ').slice(0, 240) : 'GitHub evidence unavailable'],
    }
  }
}

export function buildReleaseHealthReport({ repos = repositories, run = gh } = {}) {
  const report = {
    generatedAt: new Date().toISOString(),
    repositories: repos.map((slug) => inspect(slug, run)),
  }
  report.ok = report.repositories.length > 0 && report.repositories.every((repo) => repo.status === 'pass')
  return report
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = buildReleaseHealthReport()
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
}
