#!/usr/bin/env node
/**
 * Fail-closed security evidence for production deployment.
 *
 * This does not run CodeQL locally. GitHub Actions is the authoritative
 * analyzer; this gate verifies that its completed result exists for the exact
 * commit being deployed and that the repository has no open CodeQL alerts.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    const detail = String(error?.stderr || error?.message || '')
      .trim()
      .replace(/\s+/g, ' ')
    throw new Error(
      `${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`,
    )
  }
}

const argumentsList = process.argv.slice(2)
const jsonOutput = argumentsList.includes('--json')
const positional = argumentsList.filter((argument) => argument !== '--json' && argument !== '--')

if (positional.length > 1) {
  const error = new Error('expected at most one deployment SHA')
  if (jsonOutput) {
    console.log(JSON.stringify({ ok: false, error: error.message }, null, 2))
    process.exitCode = 1
  } else {
    throw error
  }
} else {
  try {
    const sha = positional[0] || run('git', ['rev-parse', 'HEAD'])
    if (!/^[0-9a-f]{40}$/i.test(sha))
      throw new Error(`unsafe deployment SHA: ${sha}`)
    if (!existsSync('.github/workflows/codeql.yml'))
      throw new Error('CodeQL workflow is missing')

    const remote = run('git', ['remote', 'get-url', 'origin'])
    const slug = remote.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/i)?.[1]
    if (!slug)
      throw new Error(`cannot derive GitHub repository from origin: ${remote}`)

    const alerts = Number(
      run('gh', [
        'api',
        `repos/${slug}/code-scanning/alerts?state=open&per_page=100`,
        '--jq',
        'length',
      ]),
    )
    if (!Number.isInteger(alerts))
      throw new Error('GitHub returned an invalid CodeQL alert count')
    if (alerts > 0)
      throw new Error(`${alerts} open CodeQL alert(s) block deployment`)

    const runs = JSON.parse(
      run('gh', [
        'run',
        'list',
        '--workflow',
        'codeql.yml',
        '--commit',
        sha,
        '--limit',
        '10',
        '--json',
        'status,conclusion,headSha,databaseId',
      ]),
    )
    const successful = runs.find(
      (item) =>
        item.headSha === sha &&
        item.status === 'completed' &&
        item.conclusion === 'success',
    )
    if (!successful)
      throw new Error(`no successful completed CodeQL run found for ${sha}`)

    const report = {
      ok: true,
      repository: slug,
      sha,
      openCodeqlAlerts: alerts,
      codeqlRunId: successful.databaseId,
    }
    console.log(JSON.stringify(report, null, 2))
  } catch (error) {
    if (!jsonOutput) throw error
    console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2))
    process.exitCode = 1
  }
}
