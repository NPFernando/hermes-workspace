import { execFile as nodeExecFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(nodeExecFile)

export type ReleaseRepository = {
  id: string
  label: string
  slug: string
}

export type RepositoryReleaseStatus = ReleaseRepository & {
  status: 'pass' | 'fail' | 'running' | 'degraded' | 'unavailable'
  detail: string
  defaultBranch: string | null
  pushedAt: string | null
  latestRun: {
    workflow: string | null
    status: string | null
    conclusion: string | null
    headSha: string | null
    createdAt: string | null
  } | null
  openPullRequests: Array<{
    number: number
    title: string
    isDraft: boolean
    reviewDecision: string | null
    failingChecks: number
    updatedAt: string | null
  }>
}

export const DEFAULT_RELEASE_REPOSITORIES: Array<ReleaseRepository> = [
  {
    id: 'astrology',
    label: 'Astrology',
    slug: 'NPFernando/fernandofamily-astrology',
  },
  {
    id: 'hermes',
    label: 'Hermes Workspace',
    slug: 'NPFernando/hermes-workspace',
  },
  {
    id: 'harp',
    label: 'Universal HARP',
    slug: 'NPFernando/harp-control-plane',
  },
  {
    id: 'workspace-manager',
    label: 'Workspace Manager',
    slug: 'NPFernando/workspace-session-manager',
  },
]

type CommandRunner = (
  args: Array<string>,
) => Promise<{ stdout: string; stderr: string }>

async function runGh(
  args: Array<string>,
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFile('gh', args, {
    timeout: 12_000,
    maxBuffer: 512 * 1024,
  })
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() }
}

function configuredRepositories(
  env: NodeJS.ProcessEnv = process.env,
): Array<ReleaseRepository> {
  const configured = env.HERMES_RELEASE_REPOSITORIES?.split(',')
    .map((slug) => slug.trim())
    .filter(Boolean)
  if (!configured?.length) return DEFAULT_RELEASE_REPOSITORIES
  return configured.map((slug) => {
    const name = slug.split('/')[1] || slug
    return {
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      label: name,
      slug,
    }
  })
}

function unavailable(
  repository: ReleaseRepository,
  detail: string,
): RepositoryReleaseStatus {
  return {
    ...repository,
    status: 'unavailable',
    detail,
    defaultBranch: null,
    pushedAt: null,
    latestRun: null,
    openPullRequests: [],
  }
}

export async function getCrossRepositoryReleaseStatus({
  repositories = configuredRepositories(),
  run = runGh,
}: {
  repositories?: Array<ReleaseRepository>
  run?: CommandRunner
} = {}): Promise<{
  generatedAt: string
  repositories: Array<RepositoryReleaseStatus>
}> {
  const results = await Promise.all(
    repositories.map(async (repository) => {
      try {
        const [metadataResult, runsResult] = await Promise.all([
          run([
            'repo',
            'view',
            repository.slug,
            '--json',
            'defaultBranchRef,pushedAt',
          ]),
          run([
            'run',
            'list',
            '--repo',
            repository.slug,
            '--limit',
            '1',
            '--json',
            'status,conclusion,headSha,workflowName,createdAt',
          ]),
        ])
        const pullRequestsResult = await run([
          'pr',
          'list',
          '--repo',
          repository.slug,
          '--state',
          'open',
          '--limit',
          '20',
          '--json',
          'number,title,isDraft,reviewDecision,statusCheckRollup,updatedAt',
        ])
        const metadata = JSON.parse(metadataResult.stdout) as {
          defaultBranchRef?: { name?: string }
          pushedAt?: string
        }
        const runs = JSON.parse(runsResult.stdout || '[]') as Array<{
          status?: string
          conclusion?: string | null
          headSha?: string
          workflowName?: string
          createdAt?: string
        }>
        const latest = runs.at(0)
        const latestRun = latest
          ? {
              workflow: latest.workflowName ?? null,
              status: latest.status ?? null,
              conclusion: latest.conclusion ?? null,
              headSha: latest.headSha ?? null,
              createdAt: latest.createdAt ?? null,
            }
          : null
        const pullRequests = JSON.parse(
          pullRequestsResult.stdout || '[]',
        ) as Array<{
          number?: number
          title?: string
          isDraft?: boolean
          reviewDecision?: string | null
          statusCheckRollup?: Array<{
            conclusion?: string | null
            state?: string | null
          }>
          updatedAt?: string
        }>
        const openPullRequests = pullRequests
          .filter((pullRequest) => typeof pullRequest.number === 'number')
          .map((pullRequest) => ({
            number: pullRequest.number as number,
            title: pullRequest.title ?? 'Untitled pull request',
            isDraft: pullRequest.isDraft === true,
            reviewDecision: pullRequest.reviewDecision ?? null,
            failingChecks: (pullRequest.statusCheckRollup ?? []).filter(
              (check) =>
                check.conclusion === 'FAILURE' ||
                check.conclusion === 'CANCELLED' ||
                check.state === 'FAILURE',
            ).length,
            updatedAt: pullRequest.updatedAt ?? null,
          }))
        const status = !latestRun
          ? 'degraded'
          : latestRun.status !== 'completed'
            ? 'running'
            : latestRun.conclusion === 'success'
              ? 'pass'
              : 'fail'
        const detail = !latestRun
          ? 'Repository metadata is available, but no recent workflow run was found.'
          : latestRun.status !== 'completed'
            ? `Latest ${latestRun.workflow || 'workflow'} run is ${latestRun.status || 'in progress'}.`
            : latestRun.conclusion === 'success'
              ? `Latest ${latestRun.workflow || 'workflow'} run passed.`
              : `Latest ${latestRun.workflow || 'workflow'} run concluded ${latestRun.conclusion || 'without a conclusion'}.`
        return {
          ...repository,
          status,
          detail,
          defaultBranch: metadata.defaultBranchRef?.name ?? null,
          pushedAt: metadata.pushedAt ?? null,
          latestRun,
          openPullRequests,
        } satisfies RepositoryReleaseStatus
      } catch (error) {
        return unavailable(
          repository,
          error instanceof Error
            ? error.message
            : 'GitHub evidence unavailable.',
        )
      }
    }),
  )
  return { generatedAt: new Date().toISOString(), repositories: results }
}
