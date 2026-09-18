#!/usr/bin/env node
/**
 * Fail-closed, value-blind privacy/security regression guard.
 *
 * This checks source boundaries and sanitized metadata only. It never reads
 * secret values and never treats the presence of a credential as evidence that
 * the credential is safe.
 */
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []

function read(relative) {
  const path = join(root, relative)
  if (!existsSync(path)) {
    failures.push(`required file is missing: ${relative}`)
    return ''
  }
  return readFileSync(path, 'utf8')
}

function checkAuthFailureSource() {
  const source = read('src/server/auth-middleware.ts')
  const start = source.indexOf('export function recordAuthFailure')
  const end = source.indexOf('\nfunction loadStore', start)
  if (start < 0 || end < 0) {
    failures.push('auth failure recorder boundary is missing')
    return
  }
  const recorder = source.slice(start, end)
  if (!recorder.includes('auth-failures.jsonl')) failures.push('auth failure log path is missing')
  if (!recorder.includes('mode: 0o600')) failures.push('auth failure log is not created with restrictive permissions')
  if (!recorder.includes('slice(-199)')) failures.push('auth failure log is not bounded')
  if (/JSON\.stringify\(\{[\s\S]*?(?:cookie|authorization|password|passphrase|secret|token|ip)/i.test(recorder)) {
    failures.push('auth failure metadata may contain a credential, cookie, or IP address')
  }
  const record = recorder.match(/JSON\.stringify\(\{([\s\S]*?)\}\)/)?.[1] ?? ''
  const allowed = ['at', 'correlationId', 'method', 'path', 'reason']
  for (const key of record.matchAll(/\b([A-Za-z][A-Za-z0-9]*)\s*:/g)) {
    if (!allowed.includes(key[1])) failures.push(`auth failure log contains unapproved field: ${key[1]}`)
  }
}

function checkSensitiveConsoleLogs() {
  const auth = read('src/server/auth-middleware.ts')
  const provider = read('src/server/provider-usage.ts')
  const source = `${auth}\n${provider}`
  if (/console\.(?:log|info|warn|error|debug)\s*\([^\n]*(?:password|passphrase|secret|cookie|authorization|refresh_token|access_token)/i.test(source)) {
    failures.push('auth/provider source contains a sensitive console log')
  }
}

function checkRuntimeAuthLog() {
  const path = process.env.HERMES_AUTH_FAILURE_LOG || join(root, '.runtime', 'auth-failures.jsonl')
  if (!existsSync(path)) return
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).slice(-200)
  for (const [index, line] of lines.entries()) {
    let record
    try {
      record = JSON.parse(line)
    } catch {
      failures.push(`auth failure log line ${index + 1} is not valid JSON`)
      continue
    }
    const keys = Object.keys(record).sort().join(',')
    if (keys !== 'at,correlationId,method,path,reason') {
      failures.push(`auth failure log line ${index + 1} has an unsafe schema`)
    }
    if (/[?&](?:password|token|secret|birth|latitude|longitude)=/i.test(record.path || '')) {
      failures.push(`auth failure log line ${index + 1} contains sensitive query data`)
    }
    if (/(?:password|passphrase|secret|cookie|authorization|refresh_token|access_token|birth_date|birth_time|latitude|longitude)/i.test(line)) {
      failures.push(`auth failure log line ${index + 1} contains a sensitive field or value`)
    }
  }
}

function checkTrackedEnvironmentFiles() {
  let tracked = ''
  try {
    tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  } catch {
    failures.push('could not inspect tracked files for environment secrets')
    return
  }
  const unsafe = tracked.split(/\r?\n/).filter((file) => /(^|\/)\.env(?:\.|$)/i.test(file) && !/\.example$/i.test(file))
  if (unsafe.length) failures.push(`tracked environment file(s) detected: ${unsafe.join(', ')}`)
}

function checkAstrologyGuard() {
  const astrology = process.env.ASTROLOGY_REPO_PATH || '/home/ubuntu/workspace/projects/fernandofamily-astrology'
  const guard = join(astrology, 'apps/web/scripts/check-privacy-security-regressions.mjs')
  if (!existsSync(guard)) {
    failures.push('Astrology privacy/security guard is missing')
    return
  }
  const result = execFileSync(process.execPath, [guard], {
    cwd: join(astrology, 'apps/web'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (!result.includes('Privacy/security regression check passed')) failures.push('Astrology privacy/security guard did not report a pass')
}

export function runPrivacySecurityGuard({ includeAstrology = true } = {}) {
  checkAuthFailureSource()
  checkSensitiveConsoleLogs()
  checkRuntimeAuthLog()
  checkTrackedEnvironmentFiles()
  if (includeAstrology) {
    try {
      checkAstrologyGuard()
    } catch (error) {
      failures.push(`Astrology privacy/security guard failed: ${String(error?.stderr || error?.message || error).trim()}`)
    }
  }
  return { ok: failures.length === 0, failures: [...failures] }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = runPrivacySecurityGuard()
  if (!report.ok) {
    console.error(`Privacy/security regression check FAILED:\n${report.failures.join('\n')}`)
    process.exitCode = 1
  } else {
    console.log('Privacy/security regression check passed: auth metadata, logs, tracked files, and Astrology privacy guard are safe.')
  }
}
