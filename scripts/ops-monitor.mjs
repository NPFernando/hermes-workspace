#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const DEFAULT_SERVICE = process.env.HERMES_SERVICE_NAME || 'hermes-workspace'

function command(file, args, cwd) {
  try { return execFileSync(file, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() } catch { return '' }
}

function journalText(value) {
  const text = value.trim()
  return text === '-- No entries --' ? '' : text
}

function parseSystemdTimestamp(value) {
  const match = value.match(/\b(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\b/)
  return match ? Date.parse(`${match[1]}T${match[2]}`) : NaN
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
    activeEnterTimestamp: fields.ActiveEnterTimestamp || '',
    memoryCurrentBytes: fields.MemoryCurrent && fields.MemoryCurrent !== '[not set]' ? Number(fields.MemoryCurrent) : null,
    oomKilled: fields.OOMKilled === 'yes',
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
  const serviceShow = parseServiceShow(exec('systemctl', ['show', service, '--property=ActiveState,MainPID,ExecMainStatus,Result,ActiveEnterTimestamp,MemoryCurrent,OOMKilled'], repo))
  const memoryStatus = serviceShow.pid !== '0' ? exec('bash', ['-lc', `awk '/^VmRSS:/ { print $2 " " $3 }' /proc/${Number(serviceShow.pid)}/status`], repo) : ''
  const memoryMatch = memoryStatus.match(/^(\d+)\s*(\S+)?$/)
  const residentMemoryKb = memoryMatch ? Number(memoryMatch[1]) : null
  const oomLog = journalText(exec('journalctl', ['-k', '--since', '24 hours ago', '--no-pager', '-g', 'oom|out of memory|killed process'], repo))
  const errorLog = journalText(exec('journalctl', ['-u', service, '--since', '24 hours ago', '-p', 'err..alert', '--no-pager'], repo))
  const deploymentLog = journalText(exec('journalctl', ['-u', 'hermes-workspace-deploy.service', '--since', '7 days ago', '--no-pager'], repo))
  const issues = []
  if (serviceShow.activeState === 'failed' || serviceShow.result === 'failed' || (serviceShow.execStatus && serviceShow.execStatus !== '0')) issues.push({ level: 'critical', code: 'failed_deploy', detail: `${service} is ${serviceShow.activeState} (result=${serviceShow.result || 'unknown'}, exit=${serviceShow.execStatus || 'unknown'}).` })
  if (!buildMtimeMs) issues.push({ level: 'critical', code: 'missing_build', detail: 'dist/server/server.js is missing.' })
  // Commit timestamps can be ahead of the VM clock (for example, a CI commit
  // created in another timezone). Never call a build stale solely because a
  // future-dated commit compares newer than the artifact.
  else if (commitSeconds && commitSeconds <= now / 1000 && buildMtimeMs < commitSeconds * 1000) issues.push({ level: 'critical', code: 'stale_build', detail: 'Build artifact predates the current git HEAD.' })
  if (oomLog.trim()) {
    const serviceOom = oomLog.toLowerCase().includes(service.toLowerCase()) || oomLog.includes(serviceShow.pid)
    issues.push({ level: serviceOom ? 'critical' : 'warning', code: 'oom_event', detail: serviceOom ? 'Kernel journal contains a recent OOM event affecting this service.' : 'Kernel journal contains a recent OOM event affecting another workload.' })
  }
  if (errorLog.trim()) issues.push({ level: 'warning', code: 'service_errors', detail: `${errorLog.trim().split(/\r?\n/).length} recent service error log line(s) found.` })
  if (previous.pid && serviceShow.pid !== '0' && previous.pid !== serviceShow.pid) issues.push({ level: 'warning', code: 'pid_changed', detail: `Service PID changed from ${previous.pid} to ${serviceShow.pid}.` })
  const parkedStashes = stashLines ? stashLines.split(/\r?\n/).filter(Boolean).length : 0
  if (parkedStashes) issues.push({ level: 'warning', code: 'parked_stashes', detail: `${parkedStashes} parked git stash entr${parkedStashes === 1 ? 'y' : 'ies'} found.` })
  await mkdir(resolve(statePath, '..'), { recursive: true })
  const activeSince = serviceShow.activeEnterTimestamp ? parseSystemdTimestamp(serviceShow.activeEnterTimestamp) : NaN
  const uptimeSeconds = Number.isFinite(activeSince) && activeSince <= now ? Math.floor((now - activeSince) / 1000) : null
  const deploymentHistory = deploymentLog.trim() ? deploymentLog.trim().split(/\r?\n/).slice(-20) : []
  await writeFile(statePath, JSON.stringify({ checkedAt: now, head, pid: serviceShow.pid }, null, 2) + '\n', { mode: 0o600 })
  return {
    checkedAt: now,
    head,
    service: { ...serviceShow, uptimeSeconds, residentMemoryKb, oomDetected: Boolean(oomLog.trim()) || serviceShow.oomKilled },
    buildMtimeMs,
    deploymentHistory,
    recentErrorLines: errorLog.trim() ? errorLog.trim().split(/\r?\n/).slice(-20) : [],
    parkedStashes,
    issues,
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const status = await collectOperationalStatus({ repo: process.argv[2] || process.cwd() })
  console.log(JSON.stringify(status, null, 2))
  if (status.issues.some((issue) => issue.level === 'critical')) process.exitCode = 1
}
