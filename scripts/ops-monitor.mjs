#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const DEFAULT_SERVICE = process.env.HERMES_SERVICE_NAME || 'hermes-workspace'

function command(file, args, cwd) {
  try { return execFileSync(file, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() } catch { return '' }
}

function parseServiceShow(raw) {
  const fields = Object.fromEntries(
    raw
      .split(/\r?\n/)
      .filter((line) => line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator), line.slice(separator + 1)]
      }),
  )
  // systemd does not guarantee the order of --value output, so parse named
  // fields instead of relying on the requested property order.
  return {
    activeState: fields.ActiveState || 'unknown',
    pid: fields.MainPID || '0',
    execStatus: fields.ExecMainStatus || '',
    result: fields.Result || '',
  }
}

export async function collectOperationalStatus({
  repo = process.cwd(), service = DEFAULT_SERVICE, statePath = join(repo, '.runtime', 'ops-monitor-state.json'), now = Date.now(), exec = command,
} = {}) {
  const head = exec('git', ['rev-parse', 'HEAD'], repo)
  const commitSeconds = Number(exec('git', ['show', '-s', '--format=%ct', 'HEAD'], repo))
  const stashLines = exec('git', ['stash', 'list'], repo)
  const buildPath = join(repo, 'dist', 'server', 'server.js')
  let buildMtimeMs = 0
  try { buildMtimeMs = (await stat(buildPath)).mtimeMs } catch { /* reported below */ }
  let previous = {}
  try { previous = JSON.parse(await readFile(statePath, 'utf8')) } catch { /* first run */ }
  const serviceShow = parseServiceShow(exec('systemctl', ['show', service, '--property=ActiveState,MainPID,ExecMainStatus,Result'], repo))
  const issues = []
  if (serviceShow.activeState === 'failed' || serviceShow.result === 'failed' || (serviceShow.execStatus && serviceShow.execStatus !== '0')) issues.push({ level: 'critical', code: 'failed_deploy', detail: `${service} is ${serviceShow.activeState} (result=${serviceShow.result || 'unknown'}, exit=${serviceShow.execStatus || 'unknown'}).` })
  if (!buildMtimeMs) issues.push({ level: 'critical', code: 'missing_build', detail: 'dist/server/server.js is missing.' })
  else if (commitSeconds && buildMtimeMs < commitSeconds * 1000) issues.push({ level: 'critical', code: 'stale_build', detail: 'Build artifact predates the current git HEAD.' })
  if (previous.pid && serviceShow.pid !== '0' && previous.pid !== serviceShow.pid) issues.push({ level: 'warning', code: 'pid_changed', detail: `Service PID changed from ${previous.pid} to ${serviceShow.pid}.` })
  const parkedStashes = stashLines ? stashLines.split(/\r?\n/).filter(Boolean).length : 0
  if (parkedStashes) issues.push({ level: 'warning', code: 'parked_stashes', detail: `${parkedStashes} parked git stash entr${parkedStashes === 1 ? 'y' : 'ies'} found.` })
  await mkdir(resolve(statePath, '..'), { recursive: true })
  await writeFile(statePath, JSON.stringify({ checkedAt: now, head, pid: serviceShow.pid }, null, 2) + '\n', { mode: 0o600 })
  return { checkedAt: now, head, service: serviceShow, buildMtimeMs, parkedStashes, issues }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const status = await collectOperationalStatus({ repo: process.argv[2] || process.cwd() })
  console.log(JSON.stringify(status, null, 2))
  if (status.issues.some((issue) => issue.level === 'critical')) process.exitCode = 1
}
