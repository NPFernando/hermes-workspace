#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const DEFAULT_SERVICE = process.env.HERMES_SERVICE_NAME || 'hermes-workspace'

// Files in these paths are consumed by the running Node/Vite application.
// Operational/docs/test-only changes should not be mistaken for a stale
// production artifact when the deployment marker is otherwise current.
function isRuntimeFile(file) {
  return /^(src\/|public\/|server-entry\.js$|index\.html$|vite\.config\.|package\.json$|pnpm-lock\.yaml$|electron\/)/.test(file)
}

const MEMORY_GROWTH_WARN_PERCENT = Number(process.env.HERMES_OPS_MEMORY_GROWTH_WARN_PERCENT || 25)
const MEMORY_GROWTH_MIN_KB = Number(process.env.HERMES_OPS_MEMORY_GROWTH_MIN_KB || 64 * 1024)
const ALERTABLE_ISSUE_CODES = new Set(['stale_build', 'oom_event', 'failed_deploy', 'memory_growth'])

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
  let deployedCommit = ''
  try { deployedCommit = (await readFile(join(repo, '.runtime', 'build-commit'), 'utf8')).trim() } catch { /* first run */ }
  const pendingFiles = deployedCommit && head && deployedCommit !== head
    ? exec('git', ['diff', '--name-only', `${deployedCommit}..${head}`], repo).split(/\r?\n/).filter(Boolean)
    : []
  const pendingRuntimeFiles = pendingFiles.filter(isRuntimeFile)
  const buildPath = join(repo, 'dist', 'server', 'server.js')
  let buildMtimeMs = 0
  try { buildMtimeMs = (await stat(buildPath)).mtimeMs } catch { /* reported below */ }
  let previous = {}
  try { previous = JSON.parse(await readFile(statePath, 'utf8')) } catch { /* first run */ }
  const serviceShow = parseServiceShow(exec('systemctl', ['show', service, '--property=ActiveState,MainPID,ExecMainStatus,Result,ActiveEnterTimestamp,MemoryCurrent,OOMKilled'], repo))
  const memoryStatus = serviceShow.pid !== '0' ? exec('bash', ['-lc', `awk '/^VmRSS:/ { print $2 " " $3 }' /proc/${Number(serviceShow.pid)}/status`], repo) : ''
  const memoryMatch = memoryStatus.match(/^(\d+)\s*(\S+)?$/)
  const residentMemoryKb = memoryMatch ? Number(memoryMatch[1]) : null
  const previousMemoryKb = Number(previous.residentMemoryKb)
  const memoryGrowthKb = Number.isFinite(previousMemoryKb) && residentMemoryKb != null
    ? residentMemoryKb - previousMemoryKb
    : null
  const memoryGrowthPercent = Number.isFinite(previousMemoryKb) && previousMemoryKb > 0 && memoryGrowthKb != null
    ? (memoryGrowthKb / previousMemoryKb) * 100
    : null
  const oomLog = journalText(exec('journalctl', ['-k', '--since', '24 hours ago', '--no-pager', '-g', 'oom|out of memory|killed process'], repo))
  const errorLog = journalText(exec('journalctl', ['-u', service, '--since', '24 hours ago', '-p', 'err..alert', '--no-pager'], repo))
  const deploymentLog = journalText(exec('journalctl', ['-u', 'hermes-workspace-deploy.service', '--since', '7 days ago', '--no-pager'], repo))
  const issues = []
  if (serviceShow.activeState === 'failed' || serviceShow.result === 'failed' || (serviceShow.execStatus && serviceShow.execStatus !== '0')) issues.push({ level: 'critical', code: 'failed_deploy', detail: `${service} is ${serviceShow.activeState} (result=${serviceShow.result || 'unknown'}, exit=${serviceShow.execStatus || 'unknown'}).` })
  if (!buildMtimeMs) issues.push({ level: 'critical', code: 'missing_build', detail: 'dist/server/server.js is missing.' })
  // Commit timestamps can be ahead of the VM clock (for example, a CI commit
  // created in another timezone). Never call a build stale solely because a
  // future-dated commit compares newer than the artifact.
  else if (commitSeconds && commitSeconds <= now / 1000 && buildMtimeMs < commitSeconds * 1000) {
    if (pendingRuntimeFiles.length) {
      issues.push({ level: 'critical', code: 'stale_build', detail: `Build artifact predates current HEAD; ${pendingRuntimeFiles.length} runtime file(s) are pending deployment.` })
    } else {
      issues.push({ level: 'warning', code: 'stale_build_metadata', detail: 'Build artifact predates HEAD, but no pending runtime files were detected.' })
    }
  }
  if (oomLog.trim()) {
    const serviceOom = oomLog.toLowerCase().includes(service.toLowerCase()) || oomLog.includes(serviceShow.pid)
    issues.push({ level: serviceOom ? 'critical' : 'warning', code: 'oom_event', detail: serviceOom ? 'Kernel journal contains a recent OOM event affecting this service.' : 'Kernel journal contains a recent OOM event affecting another workload.' })
  }
  if (errorLog.trim()) issues.push({ level: 'warning', code: 'service_errors', detail: `${errorLog.trim().split(/\r?\n/).length} recent service error log line(s) found.` })
  if (memoryGrowthKb != null && memoryGrowthKb >= MEMORY_GROWTH_MIN_KB && memoryGrowthPercent >= MEMORY_GROWTH_WARN_PERCENT) {
    issues.push({ level: 'warning', code: 'memory_growth', detail: `Resident memory grew by ${Math.round(memoryGrowthKb / 1024)} MiB (${Math.round(memoryGrowthPercent)}%) since the previous check.` })
  }
  if (previous.pid && serviceShow.pid !== '0' && previous.pid !== serviceShow.pid) issues.push({ level: 'warning', code: 'pid_changed', detail: `Service PID changed from ${previous.pid} to ${serviceShow.pid}.` })
  const parkedStashes = stashLines ? stashLines.split(/\r?\n/).filter(Boolean).length : 0
  if (parkedStashes) issues.push({ level: 'warning', code: 'parked_stashes', detail: `${parkedStashes} parked git stash entr${parkedStashes === 1 ? 'y' : 'ies'} found.` })
  await mkdir(resolve(statePath, '..'), { recursive: true })
  const activeSince = serviceShow.activeEnterTimestamp ? parseSystemdTimestamp(serviceShow.activeEnterTimestamp) : NaN
  const uptimeSeconds = Number.isFinite(activeSince) && activeSince <= now ? Math.floor((now - activeSince) / 1000) : null
  const deploymentHistory = deploymentLog.trim() ? deploymentLog.trim().split(/\r?\n/).slice(-20) : []
  await writeFile(statePath, JSON.stringify({ checkedAt: now, head, pid: serviceShow.pid, residentMemoryKb }, null, 2) + '\n', { mode: 0o600 })
  return {
    checkedAt: now,
    head,
    deployedCommit,
    pendingFiles,
    pendingRuntimeFiles,
    service: { ...serviceShow, uptimeSeconds, residentMemoryKb, memoryGrowthKb, memoryGrowthPercent, oomDetected: Boolean(oomLog.trim()) || serviceShow.oomKilled },
    buildMtimeMs,
    deploymentHistory,
    recentErrorLines: errorLog.trim() ? errorLog.trim().split(/\r?\n/).slice(-20) : [],
    parkedStashes,
    issues,
  }
}

function alertFingerprint(issue) {
  return `${issue.code}:${issue.level}`
}

function alertMessage(status, issue) {
  return `[${issue.level.toUpperCase()}] Hermes Workspace ${issue.code}: ${issue.detail} (head=${status.head || 'unknown'}, deployed=${status.deployedCommit || 'unknown'})`
}

/**
 * Send newly observed operational findings to an explicitly configured
 * webhook. Delivery is deliberately opt-in and best-effort: monitoring must
 * still work when no endpoint is configured or when the endpoint is down.
 */
export async function notifyOperationalAlerts(
  status,
  {
    webhookUrl = process.env.HERMES_OPS_ALERT_WEBHOOK_URL,
    statePath = join(process.cwd(), '.runtime', 'ops-monitor-alerts.json'),
    now = Date.now(),
    fetchImpl = globalThis.fetch,
    cooldownMs = Number(process.env.HERMES_OPS_ALERT_COOLDOWN_SECONDS || 3600) * 1000,
  } = {},
) {
  if (!webhookUrl || typeof fetchImpl !== 'function') return { configured: false, sent: 0, skipped: 0, failed: 0 }
  let parsedUrl
  try {
    parsedUrl = new URL(webhookUrl)
    if (!['https:', 'http:'].includes(parsedUrl.protocol)) throw new Error('unsupported protocol')
  } catch {
    return { configured: true, sent: 0, skipped: 0, failed: 0, error: 'invalid webhook URL' }
  }

  let state = {}
  try { state = JSON.parse(await readFile(statePath, 'utf8')) } catch { /* first notification */ }
  const sentAt = state.sentAt && typeof state.sentAt === 'object' ? state.sentAt : {}
  const issues = status.issues.filter((issue) => ALERTABLE_ISSUE_CODES.has(issue.code))
  let sent = 0
  let skipped = 0
  let failed = 0
  for (const issue of issues) {
    const fingerprint = alertFingerprint(issue)
    if (Number(sentAt[fingerprint]) + cooldownMs > now) {
      skipped += 1
      continue
    }
    try {
      const response = await fetchImpl(parsedUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: alertMessage(status, issue),
          service: status.service?.name || process.env.HERMES_SERVICE_NAME || 'hermes-workspace',
          issue,
          head: status.head,
          deployedCommit: status.deployedCommit,
          observedAt: new Date(now).toISOString(),
        }),
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      sentAt[fingerprint] = now
      sent += 1
    } catch (error) {
      failed += 1
      console.error(`ops alert delivery failed for ${fingerprint}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  await mkdir(resolve(statePath, '..'), { recursive: true })
  await writeFile(statePath, JSON.stringify({ updatedAt: now, sentAt }, null, 2) + '\n', { mode: 0o600 })
  return { configured: true, sent, skipped, failed }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const status = await collectOperationalStatus({ repo: process.argv[2] || process.cwd() })
  status.notifications = await notifyOperationalAlerts(status)
  console.log(JSON.stringify(status, null, 2))
  if (status.issues.some((issue) => issue.level === 'critical')) process.exitCode = 1
}
