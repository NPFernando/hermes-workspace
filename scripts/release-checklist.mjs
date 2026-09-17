#!/usr/bin/env node
/**
 * Fail-closed release checklist. It validates the built artifact, PWA
 * integrity, systemd service health, and the live release boundary. It never
 * restarts, deploys, or changes state.
 */
import { execFileSync } from 'node:child_process'
import { runReleaseSmoke } from './release-smoke.mjs'
import { checkPwa } from './check-pwa.mjs'
import { runPwaBrowserSmoke } from './pwa-browser-smoke.mjs'

function run(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

export async function runReleaseChecklist({
  baseUrl = 'http://127.0.0.1:3000',
  service = process.env.HERMES_SERVICE_NAME || 'hermes-workspace',
  expectedBuild = process.env.RELEASE_SMOKE_EXPECTED_BUILD,
} = {}) {
  const checks = []
  const pwa = checkPwa(process.cwd())
  if (!pwa.ok)
    throw new Error(`PWA integrity failed: ${pwa.failures.join('; ')}`)
  checks.push({ name: 'pwa-integrity', ok: true })

  const pwaBrowser = await runPwaBrowserSmoke({ baseUrl })
  if (!pwaBrowser.ok)
    throw new Error(
      `PWA browser smoke failed: ${pwaBrowser.failures.join('; ')}`,
    )
  checks.push({
    name: 'pwa-browser-smoke',
    ok: true,
    registration: pwaBrowser.registration,
  })

  run('pnpm', ['run', 'check:build-integrity'])
  checks.push({ name: 'build-integrity', ok: true })

  run('pnpm', ['run', 'check:bundle'])
  checks.push({ name: 'bundle-budget', ok: true })

  const active = run('systemctl', ['is-active', service])
  if (active !== 'active')
    throw new Error(`${service} is ${active || 'unknown'}`)
  checks.push({ name: 'service-active', ok: true, service })

  const smoke = await runReleaseSmoke(baseUrl, fetch, expectedBuild)
  checks.push({ name: 'release-smoke', ok: true, ...smoke })
  return { ok: true, checks }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log(
      JSON.stringify(
        await runReleaseChecklist({
          baseUrl: process.argv[2] || 'http://127.0.0.1:3000',
        }),
        null,
        2,
      ),
    )
  } catch (error) {
    console.error(
      `release checklist failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exitCode = 1
  }
}
