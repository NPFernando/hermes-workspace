#!/usr/bin/env node
/**
 * Produce one read-only production-readiness report. This composes local
 * evidence and optional GitHub alert counts; it never deploys, migrates,
 * restarts, changes files, or treats unavailable evidence as passing.
 */
import { execFile as nodeExecFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { runAssetIntegrity } from './asset-integrity.mjs'
import { runReleaseSmoke } from './release-smoke.mjs'

const execFile = promisify(nodeExecFile)
const rootDir = process.cwd()
const baseUrl = process.env.READINESS_BASE_URL || 'http://127.0.0.1:3000'
const timeoutMs = Number(process.env.READINESS_TIMEOUT_MS || 180_000)

export async function command(command, args = [], options = {}) {
  try {
    const result = await execFile(command, args, {
      cwd: options.cwd || rootDir,
      timeout: options.timeout || timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      env: options.env || process.env,
    })
    return { ok: true, code: 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() }
  } catch (error) {
    return {
      ok: false,
      code: typeof error?.code === 'number' ? error.code : 1,
      stdout: String(error?.stdout || '').trim(),
      stderr: String(error?.stderr || error?.message || '').trim().slice(0, 1000),
    }
  }
}

function result(status, detail, extra = {}) {
  return { status, detail, ...extra }
}

function artifactBuildId() {
  try {
    return createHash('sha256').update(readFileSync(join(rootDir, 'dist/server/server.js'))).digest('hex').slice(0, 16)
  } catch {
    return null
  }
}

function repositorySlug(remote) {
  if (!remote) return null
  const match = remote.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/i)
  return match?.[1] || null
}

async function deploymentIdentity() {
  const [head, branch, dirty, remote, marker, servicePid] = await Promise.all([
    command('git', ['rev-parse', 'HEAD']),
    command('git', ['branch', '--show-current']),
    command('git', ['status', '--porcelain']),
    command('git', ['remote', 'get-url', 'origin']),
    command('cat', ['.runtime/build-commit']),
    command('systemctl', ['show', '-p', 'MainPID', '--value', 'hermes-workspace.service']),
  ])
  const served = await fetch(`${baseUrl}/`, { cache: 'no-store' }).then((response) => response.headers.get('x-workspace-build')).catch(() => null)
  const artifact = artifactBuildId()
  const expected = marker.ok && head.ok ? artifact : null
  const matches = Boolean(served && artifact && served === artifact)
  return {
    status: matches && !dirty.stdout ? 'pass' : 'degraded',
    head: head.stdout || null,
    branch: branch.stdout || null,
    dirty: Boolean(dirty.stdout),
    remote: repositorySlug(remote.stdout),
    buildMarker: marker.stdout || null,
    artifactBuild: artifact,
    servedBuild: served,
    markerMatchesHead: Boolean(expected && marker.stdout === head.stdout),
    artifactMatchesServed: matches,
    servicePid: servicePid.stdout || null,
    detail: matches ? 'The live build header matches the local compiled artifact.' : 'Live build identity could not be fully verified.',
  }
}

async function serviceCheck() {
  const active = await command('systemctl', ['is-active', 'hermes-workspace.service'])
  const pid = await command('systemctl', ['show', '-p', 'MainPID', '--value', 'hermes-workspace.service'])
  return result(active.ok && active.stdout === 'active' ? 'pass' : 'fail', active.stdout || active.stderr || 'Service status unavailable', { service: 'hermes-workspace.service', pid: pid.stdout || null })
}

async function testCheck(skipTests) {
  if (skipTests) return result('not-run', 'Tests skipped by --skip-tests.')
  const started = Date.now()
  const test = await command('pnpm', ['test', '--', '--reporter=dot'])
  return result(test.ok ? 'pass' : 'fail', test.ok ? 'Repository test suite passed.' : test.stderr || 'Repository test suite failed.', { command: 'pnpm test -- --reporter=dot', durationMs: Date.now() - started })
}

async function securityCheck() {
  const gh = await command('gh', ['--version'], { timeout: 5000 })
  if (!gh.ok) return result('unavailable', 'GitHub CLI is not installed or unavailable.')
  const remote = await command('git', ['remote', 'get-url', 'origin'])
  const slug = repositorySlug(remote.stdout)
  if (!slug) return result('unavailable', 'A GitHub repository could not be derived from origin.')
  const head = await command('git', ['rev-parse', 'HEAD'])
  const [codeql, dependabot, codeqlRuns] = await Promise.all([
    command('gh', ['api', `repos/${slug}/code-scanning/alerts?state=open&per_page=100`, '--jq', 'length'], { timeout: 15_000 }),
    command('gh', ['api', `repos/${slug}/dependabot/alerts?state=open&per_page=100`, '--jq', 'length'], { timeout: 15_000 }),
    command('gh', ['run', 'list', '--workflow', 'codeql.yml', '--commit', head.stdout, '--limit', '10', '--json', 'status,conclusion,headSha,databaseId'], { timeout: 15_000 }),
  ])
  const parseCount = (value) => /^\d+$/.test(value) ? Number(value) : null
  const codeqlOpen = parseCount(codeql.stdout)
  const dependabotOpen = parseCount(dependabot.stdout)
  const dependabotDisabled = /Dependabot alerts are disabled/i.test(dependabot.stderr)
  let codeqlRun = null
  try {
    const runs = JSON.parse(codeqlRuns.stdout)
    codeqlRun = runs.find((run) => run.headSha === head.stdout && run.status === 'completed' && run.conclusion === 'success') ?? null
  } catch {
    codeqlRun = null
  }
  const codeqlRunEvidence = codeqlRun
    ? { status: 'pass', databaseId: codeqlRun.databaseId ?? null, headSha: head.stdout || null }
    : { status: 'fail', databaseId: null, headSha: head.stdout || null }
  if (codeqlOpen == null) {
    return result('unavailable', 'GitHub CodeQL alert API was not available.', {
      codeqlOpen,
      dependabotOpen,
      dependabotStatus: dependabotDisabled ? 'disabled' : 'unavailable',
      codeqlRun: codeqlRunEvidence,
    })
  }
  if (dependabotDisabled) {
    const pass = codeqlOpen === 0 && codeqlRunEvidence.status === 'pass'
    return result(pass ? 'pass' : 'fail', pass
      ? 'CodeQL alerts are clear and the exact HEAD has a successful CodeQL run; Dependabot alerts are disabled for this repository.'
      : `${codeqlOpen} CodeQL alerts open or the exact HEAD has no successful CodeQL run; Dependabot alerts are disabled for this repository.`,
    { codeqlOpen, dependabotOpen: null, dependabotStatus: 'disabled', codeqlRun: codeqlRunEvidence })
  }
  if (dependabotOpen == null) {
    return result('unavailable', 'GitHub Dependabot alert API was not available.', {
      codeqlOpen,
      dependabotOpen,
      dependabotStatus: 'unavailable',
      codeqlRun: codeqlRunEvidence,
    })
  }
  const pass = codeqlOpen === 0 && dependabotOpen === 0 && codeqlRunEvidence.status === 'pass'
  return result(pass ? 'pass' : 'fail', pass
    ? 'CodeQL and Dependabot alerts are clear and the exact HEAD has a successful CodeQL run.'
    : `${codeqlOpen} CodeQL and ${dependabotOpen} Dependabot alerts open, or the exact HEAD has no successful CodeQL run.`,
  { codeqlOpen, dependabotOpen, dependabotStatus: 'enabled', codeqlRun: codeqlRunEvidence })
}

async function migrationCheck() {
  const schema = existsSync(join(rootDir, 'src/server/finance-schema.sql'))
  const store = existsSync(join(rootDir, 'src/server/finance-store.ts'))
  const postgres = existsSync(join(rootDir, 'src/server/finance-postgres-store.ts'))
  const migrationDocs = existsSync(join(rootDir, 'docs/finance-cutover-open-questions.md'))
  const complete = schema && store && postgres
  return result(complete ? 'degraded' : 'fail', complete ? 'Migration artifacts exist; live migration state requires operator/database evidence.' : 'Required finance persistence artifacts are missing.', { schema, store, postgres, migrationDocs, evidence: 'filesystem-only' })
}

function configuredKey(key) {
  if (process.env[key]) return true
  const files = [join(rootDir, '.env'), join(process.env.HERMES_HOME || '/home/ubuntu/.hermes', '.env')]
  return files.some((file) => {
    try {
      return new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*=`, 'm').test(readFileSync(file, 'utf8'))
    } catch {
      return false
    }
  })
}

async function backupCheck() {
  const script = existsSync(join(rootDir, 'scripts/finance-offsite-backup.ts'))
  const unit = existsSync(join(rootDir, 'deploy/systemd/hermes-finance-offsite-backup.service'))
  const timer = existsSync(join(rootDir, 'deploy/systemd/hermes-finance-offsite-backup.timer'))
  const passphrase = configuredKey('HERMES_FINANCE_BACKUP_PASSPHRASE')
  const remote = configuredKey('HERMES_FINANCE_BACKUP_RCLONE_REMOTE')
  const rclone = await command('rclone', ['version'], { timeout: 5_000 })
  const enabled = await command('systemctl', ['is-enabled', 'hermes-finance-offsite-backup.timer'], { timeout: 5_000 })
  const active = await command('systemctl', ['is-active', 'hermes-finance-offsite-backup.timer'], { timeout: 5_000 })
  const evidence = await command('journalctl', ['-u', 'hermes-finance-offsite-backup.service', '--since', '30 days ago', '--no-pager', '-g', 'roundTripVerified|"ok": true'], { timeout: 10_000 })
  const complete = script && unit && timer && passphrase && remote && rclone.ok && enabled.stdout === 'enabled' && active.stdout === 'active' && Boolean(evidence.stdout)
  const missing = [
    !script && 'backup script', !unit && 'backup service unit', !timer && 'backup timer unit',
    !passphrase && 'backup passphrase', !remote && 'rclone remote', !rclone.ok && 'rclone binary',
    enabled.stdout !== 'enabled' && 'enabled timer', active.stdout !== 'active' && 'active timer',
    !evidence.stdout && 'recent round-trip evidence',
  ].filter(Boolean)
  return result(complete ? 'pass' : 'fail', complete ? 'Encrypted off-site backup is configured, scheduled, and has recent round-trip evidence.' : `Encrypted off-site backup is not ready: missing ${missing.join(', ')}.`, {
    encrypted: passphrase,
    remoteConfigured: remote,
    rcloneAvailable: rclone.ok,
    timerEnabled: enabled.stdout === 'enabled',
    timerActive: active.stdout === 'active',
    roundTripEvidence: Boolean(evidence.stdout),
    evidence: 'configuration, systemd, binary, and journal checks; secret values excluded',
  })
}

async function credentialRotationCheck() {
  const audit = await command(process.execPath, ['scripts/secrets-rotation.mjs', 'status'], { timeout: 10_000 })
  if (!audit.ok) return result('unavailable', 'Credential rotation metadata could not be read.')
  let statuses
  try { statuses = JSON.parse(audit.stdout).status } catch { return result('unavailable', 'Credential rotation metadata returned invalid JSON.') }
  if (!Array.isArray(statuses)) return result('unavailable', 'Credential rotation metadata has no status list.')
  const expired = statuses.filter((entry) => entry.state === 'expired')
  const expiring = statuses.filter((entry) => entry.state === 'expiring')
  const unconfigured = statuses.filter((entry) => entry.configured === false)
  const status = statuses.length === 0 || expired.length > 0 || expiring.length > 0 || unconfigured.length > 0 ? 'degraded' : 'pass'
  return result(status, status === 'pass' ? 'Tracked credentials have valid rotation metadata.' : statuses.length === 0 ? 'No credential rotation metadata has been recorded.' : `Credential rotation needs attention: ${expired.length} expired, ${expiring.length} expiring, ${unconfigured.length} not configured.`, {
    tracked: statuses.length,
    expired: expired.map((entry) => entry.key),
    expiring: expiring.map((entry) => ({ key: entry.key, daysRemaining: entry.daysRemaining })),
    unconfigured: unconfigured.map((entry) => entry.key),
    statuses,
    evidence: 'value-blind rotation metadata; secret values excluded',
  })
}

async function forkSyncCheck() {
  const remote = await command('git', ['remote', 'get-url', 'origin'])
  const slug = repositorySlug(remote.stdout)
  if (!slug) return result('unavailable', 'A GitHub repository could not be derived for fork-sync readiness.')
  const metadata = await command('gh', ['repo', 'view', slug, '--json', 'isFork,parent'], { timeout: 10_000 })
  if (!metadata.ok) return result('unavailable', 'GitHub fork metadata was not available.')
  let parsed
  try { parsed = JSON.parse(metadata.stdout) } catch { return result('unavailable', 'GitHub returned invalid fork metadata.') }
  if (!parsed.isFork) return result('pass', 'Fork synchronization is not applicable because this repository is not a fork.', { isFork: false, applicable: false })

  const configPath = process.env.HERMES_FORK_SYNC_CONFIG || '/home/ubuntu/.hermes/fork-sync-preview.env'
  const config = existsSync(configPath)
  const timerEnabled = await command('systemctl', ['is-enabled', 'hermes-fork-sync-preview.timer'], { timeout: 5_000 })
  const timerActive = await command('systemctl', ['is-active', 'hermes-fork-sync-preview.timer'], { timeout: 5_000 })
  const applicable = config && timerEnabled.stdout === 'enabled' && timerActive.stdout === 'active'
  return result(applicable ? 'pass' : 'fail', applicable
    ? 'Fork synchronization preview is configured and its timer is active.'
    : 'Fork synchronization is applicable but its preview config/timer is not ready.',
  { isFork: true, applicable: true, config, timerEnabled: timerEnabled.stdout === 'enabled', timerActive: timerActive.stdout === 'active', parent: parsed.parent?.fullName ?? null })
}

export async function buildReadinessReport({ skipTests = false, fetchImpl = fetch } = {}) {
  const originalFetch = globalThis.fetch
  if (fetchImpl !== originalFetch) globalThis.fetch = fetchImpl
  try {
    const [tests, security, migrations, backups, credentialRotation, forkSync, service, identity] = await Promise.all([
      testCheck(skipTests),
      securityCheck(),
      migrationCheck(),
      backupCheck(),
      credentialRotationCheck(),
      forkSyncCheck(),
      serviceCheck(),
      deploymentIdentity(),
    ])
    let assets = result('fail', 'Asset check did not run.')
    let release = result('fail', 'Release smoke did not run.')
    try {
      const assetReport = await runAssetIntegrity(baseUrl, fetchImpl)
      assets = result('pass', 'All local HTML asset references are available.', assetReport)
    } catch (error) { assets = result('fail', error instanceof Error ? error.message : String(error)) }
    try {
      const smokeReport = await runReleaseSmoke(baseUrl, fetchImpl)
      release = result('pass', 'Release smoke passed.', smokeReport)
    } catch (error) { release = result('fail', error instanceof Error ? error.message : String(error)) }
    const checks = { tests, security, migrations, backups, credentialRotation, forkSync, service, assets, release, deploymentIdentity: identity }
    const blockers = Object.entries(checks).filter(([, check]) => check.status === 'fail').map(([name, check]) => `${name}: ${check.detail}`)
    const warnings = Object.entries(checks).filter(([, check]) => ['degraded', 'unavailable', 'not-run'].includes(check.status)).map(([name, check]) => `${name}: ${check.detail}`)
    return { generatedAt: new Date().toISOString(), overall: blockers.length ? 'blocked' : warnings.length ? 'degraded' : 'ready', blockers, warnings, checks }
  } finally {
    if (fetchImpl !== originalFetch) globalThis.fetch = originalFetch
  }
}

const invokedScript = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedScript === fileURLToPath(import.meta.url)) {
  const skipTests = process.argv.includes('--skip-tests')
  const report = await buildReadinessReport({ skipTests })
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(`production readiness: ${report.overall}`)
    for (const [name, check] of Object.entries(report.checks)) console.log(`${check.status === 'pass' ? '✓' : check.status === 'fail' ? '✗' : '⚠'} ${name}: ${check.detail}`)
    if (report.blockers.length) process.exitCode = 1
  }
}
