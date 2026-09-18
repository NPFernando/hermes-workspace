#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
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
const MEMORY_RESTART_PERCENT = Number(process.env.HERMES_OPS_MEMORY_RESTART_PERCENT || 50)
const MEMORY_RESTART_MIN_KB = Number(process.env.HERMES_OPS_MEMORY_RESTART_MIN_KB || 256 * 1024)
const MEMORY_RESTART_CONSECUTIVE = Number(process.env.HERMES_OPS_MEMORY_RESTART_CONSECUTIVE || 3)
const MEMORY_RESTART_COOLDOWN_MS = Number(process.env.HERMES_OPS_MEMORY_RESTART_COOLDOWN_SECONDS || 3600) * 1000
const ALERTABLE_ISSUE_CODES = new Set(['stale_build', 'oom_event', 'failed_deploy', 'memory_growth'])
const MONITOR_ENV_KEYS = new Set([
  'HERMES_OPS_ALERT_TELEGRAM',
  'HERMES_OPS_ALERT_TELEGRAM_CHAT_ID',
  'HERMES_OPS_ALERT_WEBHOOK_URL',
  'HERMES_OPS_ALERT_COOLDOWN_SECONDS',
])

async function loadMonitorEnvironment() {
  const path = process.env.HERMES_OPS_ALERT_ENV_FILE || join(homedir(), '.hermes', 'ops-monitor.env')
  try {
    const text = await readFile(path, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)\s*$/)
      if (!match || !MONITOR_ENV_KEYS.has(match[1]) || process.env[match[1]]) continue
      process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '')
    }
  } catch {
    // EnvironmentFile loading is handled by systemd; a missing file is a
    // normal unconfigured state for standalone/read-only invocations.
  }
}

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
  restart = (targetService, targetRepo) => {
    try {
      execFileSync('sudo', ['-n', 'systemctl', 'restart', targetService], { cwd: targetRepo, stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  },
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
  const memoryGrowthDetected = memoryGrowthKb != null && memoryGrowthKb >= MEMORY_GROWTH_MIN_KB && memoryGrowthPercent >= MEMORY_GROWTH_WARN_PERCENT
  const memoryGrowthSamples = memoryGrowthDetected ? Number(previous.memoryGrowthSamples || 0) + 1 : 0
  const memoryRestartThresholdReached = memoryGrowthKb != null
    && memoryGrowthKb >= MEMORY_RESTART_MIN_KB
    && memoryGrowthPercent >= MEMORY_RESTART_PERCENT
    && memoryGrowthSamples >= MEMORY_RESTART_CONSECUTIVE
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
  if (memoryGrowthDetected) {
    issues.push({ level: 'warning', code: 'memory_growth', detail: `Resident memory grew by ${Math.round(memoryGrowthKb / 1024)} MiB (${Math.round(memoryGrowthPercent)}%) since the previous check.` })
  }
  let restartResult = { enabled: process.env.HERMES_OPS_MEMORY_RESTART_ENABLED === '1', attempted: false, restarted: false, cooldown: false }
  if (memoryRestartThresholdReached) {
    const lastRestartAt = Number(previous.lastRestartAt || 0)
    if (lastRestartAt + MEMORY_RESTART_COOLDOWN_MS > now) {
      restartResult.cooldown = true
      issues.push({ level: 'critical', code: 'memory_restart_cooldown', detail: `Memory restart threshold remains exceeded, but the restart cooldown is active until ${new Date(lastRestartAt + MEMORY_RESTART_COOLDOWN_MS).toISOString()}.` })
    } else if (restartResult.enabled) {
      restartResult.attempted = true
      restartResult.restarted = restart(service, repo)
      if (restartResult.restarted) {
        restartResult.cooldown = true
        issues.push({ level: 'critical', code: 'memory_restart_triggered', detail: `Restarted ${service} after ${memoryGrowthSamples} consecutive high-growth samples.` })
      } else {
        issues.push({ level: 'critical', code: 'memory_restart_failed', detail: `Restart threshold reached for ${service}, but the guarded systemd restart failed.` })
      }
    } else {
      issues.push({ level: 'critical', code: 'memory_restart_required', detail: `Memory restart threshold reached after ${memoryGrowthSamples} consecutive high-growth samples; set HERMES_OPS_MEMORY_RESTART_ENABLED=1 to permit a guarded restart.` })
    }
  }
  if (previous.pid && serviceShow.pid !== '0' && previous.pid !== serviceShow.pid) issues.push({ level: 'warning', code: 'pid_changed', detail: `Service PID changed from ${previous.pid} to ${serviceShow.pid}.` })
  const parkedStashes = stashLines ? stashLines.split(/\r?\n/).filter(Boolean).length : 0
  if (parkedStashes) issues.push({ level: 'warning', code: 'parked_stashes', detail: `${parkedStashes} parked git stash entr${parkedStashes === 1 ? 'y' : 'ies'} found.` })
  const healthSample = {
    checkedAt: now,
    activeState: serviceShow.activeState,
    pid: serviceShow.pid,
    result: serviceShow.result || null,
    residentMemoryKb,
    oomDetected: Boolean(oomLog.trim()) || serviceShow.oomKilled,
    issueCodes: issues.map((issue) => issue.code),
  }
  const serviceHealthHistory = [...(Array.isArray(previous.serviceHealthHistory) ? previous.serviceHealthHistory : []), healthSample].slice(-48)
  await mkdir(resolve(statePath, '..'), { recursive: true })
  const activeSince = serviceShow.activeEnterTimestamp ? parseSystemdTimestamp(serviceShow.activeEnterTimestamp) : NaN
  const uptimeSeconds = Number.isFinite(activeSince) && activeSince <= now ? Math.floor((now - activeSince) / 1000) : null
  const deploymentHistory = deploymentLog.trim() ? deploymentLog.trim().split(/\r?\n/).slice(-20) : []
  await writeFile(statePath, JSON.stringify({
    checkedAt: now,
    head,
    pid: serviceShow.pid,
    residentMemoryKb,
    memoryGrowthSamples,
    serviceHealthHistory,
    lastRestartAt: restartResult.restarted ? now : Number(previous.lastRestartAt || 0),
  }, null, 2) + '\n', { mode: 0o600 })
  return {
    checkedAt: now,
    head,
    deployedCommit,
    pendingFiles,
    pendingRuntimeFiles,
    service: { ...serviceShow, uptimeSeconds, residentMemoryKb, memoryGrowthKb, memoryGrowthPercent, oomDetected: Boolean(oomLog.trim()) || serviceShow.oomKilled },
    buildMtimeMs,
    deploymentHistory,
    serviceHealthHistory,
    recentErrorLines: errorLog.trim() ? errorLog.trim().split(/\r?\n/).slice(-20) : [],
    parkedStashes,
    restart: restartResult,
    issues,
  }
}

function alertFingerprint(issue) {
  return `${issue.code}:${issue.level}`
}

function alertMessage(status, issue) {
  return `[${issue.level.toUpperCase()}] Hermes Workspace ${issue.code}: ${issue.detail} (head=${status.head || 'unknown'}, deployed=${status.deployedCommit || 'unknown'})`
}

async function loadTelegramAlertConfig() {
  if (process.env.HERMES_OPS_ALERT_TELEGRAM !== '1') return null
  let token = process.env.TELEGRAM_BOT_TOKEN || ''
  let relayBase = process.env.TELEGRAM_RELAY_BASE || ''
  if (!token || !relayBase) {
    try {
      const env = await readFile(join(homedir(), '.hermes', '.env'), 'utf8')
      const value = (name) => env.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim().replace(/^"|"$/g, '') || ''
      token ||= value('TELEGRAM_BOT_TOKEN')
      relayBase ||= value('TELEGRAM_RELAY_BASE')
    } catch { /* report incomplete configuration below */ }
  }
  const chatId = Number(process.env.HERMES_OPS_ALERT_TELEGRAM_CHAT_ID)
  if (!token || !relayBase || !Number.isSafeInteger(chatId)) return { error: 'incomplete Telegram alert configuration' }
  return { token, relayBase, chatId }
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
    telegramConfig,
    statePath = join(process.cwd(), '.runtime', 'ops-monitor-alerts.json'),
    now = Date.now(),
    fetchImpl = globalThis.fetch,
    cooldownMs = Number(process.env.HERMES_OPS_ALERT_COOLDOWN_SECONDS || 3600) * 1000,
    dryRun = false,
  } = {},
) {
  if (typeof fetchImpl !== 'function') return { configured: false, sent: 0, skipped: 0, failed: 0 }
  let transport
  if (webhookUrl) {
    try {
      const url = new URL(webhookUrl)
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('unsupported protocol')
      transport = { kind: 'webhook', url }
    } catch {
      return { configured: true, sent: 0, skipped: 0, failed: 0, error: 'invalid webhook URL' }
    }
  } else {
    const telegram = telegramConfig === undefined ? await loadTelegramAlertConfig() : telegramConfig
    if (!telegram) return { configured: false, sent: 0, skipped: 0, failed: 0 }
    if (telegram.error) return { configured: true, sent: 0, skipped: 0, failed: 0, error: telegram.error }
    try {
      const relay = new URL(telegram.relayBase)
      if (!['https:', 'http:'].includes(relay.protocol)) throw new Error('unsupported protocol')
      transport = {
        kind: 'telegram',
        url: new URL(`/bot${telegram.token}/sendMessage`, relay),
        chatId: telegram.chatId,
      }
    } catch {
      return { configured: true, sent: 0, skipped: 0, failed: 0, error: 'invalid Telegram relay URL' }
    }
  }

  // Test mode validates transport configuration without making a network
  // request, consuming a notification, or mutating cooldown state.
  if (dryRun) return { configured: true, sent: 0, skipped: 0, failed: 0, dryRun: true }

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
      const text = alertMessage(status, issue)
      const body = transport.kind === 'telegram'
        ? { chat_id: transport.chatId, text }
        : {
            text,
            service: status.service?.name || process.env.HERMES_SERVICE_NAME || 'hermes-workspace',
            issue,
            head: status.head,
            deployedCommit: status.deployedCommit,
            observedAt: new Date(now).toISOString(),
          }
      const response = await fetchImpl(transport.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      if (transport.kind === 'telegram' && typeof response.json === 'function') {
        const result = await response.json().catch(() => null)
        if (result?.ok === false) throw new Error('Telegram rejected alert')
      }
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
  await loadMonitorEnvironment()
  const status = await collectOperationalStatus({ repo: process.argv[2] || process.cwd() })
  const cliArgs = process.argv.slice(3)
  if (cliArgs.includes('--test-alert')) {
    const send = cliArgs.includes('--send')
    if (send && process.env.HERMES_OPS_ALERT_TEST_CONFIRM !== '1') {
      console.error('Refusing to send a test alert: set HERMES_OPS_ALERT_TEST_CONFIRM=1 explicitly.')
      process.exitCode = 2
    } else {
      const testStatus = {
        ...status,
        issues: [{
          level: 'warning',
          code: 'memory_growth',
          detail: 'synthetic alert-test finding; no production condition was observed',
        }],
      }
      status.notifications = await notifyOperationalAlerts(testStatus, { dryRun: !send, cooldownMs: 0 })
      status.alertTest = { mode: send ? 'send' : 'dry-run' }
    }
  } else {
    status.notifications = await notifyOperationalAlerts(status)
  }
  console.log(JSON.stringify(status, null, 2))
  if (status.issues.some((issue) => issue.level === 'critical')) process.exitCode = 1
}
