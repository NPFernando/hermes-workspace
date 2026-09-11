#!/usr/bin/env node
/**
 * Minimal post-deploy smoke test, including HTTP security headers.
 * Usage: node scripts/release-smoke.mjs [baseUrl]
 * Optional: RELEASE_SMOKE_FINANCE=1 also checks the personal-finance payload.
 */

import { inspectDashboardStartup } from './release-smoke-checks.mjs'

const baseUrl = (
  process.argv[2] ||
  process.env.BASE_URL ||
  'http://localhost:3000'
).replace(/\/$/, '')
const expectedBuild = (process.env.RELEASE_SMOKE_EXPECTED_BUILD || '').trim()
const checks = [
  ['health', `${baseUrl}/api/health`, (body) => body?.status === 'ok'],
]

if (process.env.RELEASE_SMOKE_FINANCE === '1') {
  checks.push([
    'personal finance payload',
    `${baseUrl}/api/finance?scope=personal_finance`,
    (body) => body?.ok === true && body?.storage?.health,
  ])
}

let failures = 0
for (const [name, url, validate] of checks) {
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
    })
    const body = await response.json().catch(() => null)
    if (name === 'health') {
      const requiredHeaders = {
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'sameorigin',
        'x-workspace-build': null,
        'referrer-policy': 'strict-origin-when-cross-origin',
        'permissions-policy': null,
        'content-security-policy': "frame-ancestors 'self'",
        'cache-control': 'no-store, no-cache, must-revalidate, private',
      }
      const actualBuild = response.headers.get('x-workspace-build')
      const missingHeaders = Object.entries(requiredHeaders)
        .filter(([header, expected]) => {
          const value = response.headers.get(header)
          return (
            !value ||
            (expected !== null &&
              (header === 'content-security-policy'
                ? !value.toLowerCase().includes(expected)
                : value.toLowerCase() !== expected))
          )
        })
        .map(([header]) => header)
      if (missingHeaders.length > 0) {
        console.error(
          `❌ ${name}: missing or invalid security headers (${missingHeaders.join(', ')}; x-workspace-build=${actualBuild || 'missing'})`,
        )
        failures++
        continue
      }
      if (expectedBuild && actualBuild !== expectedBuild) {
        console.error(
          `❌ ${name}: build mismatch (expected ${expectedBuild}, got ${actualBuild || 'missing'})`,
        )
        failures++
        continue
      }
    }
    if (response.status === 401 && name === 'personal finance payload') {
      if (process.env.RELEASE_SMOKE_REQUIRE_AUTH === '1') {
        console.error(
          `❌ ${name}: authentication required but no credentials were supplied`,
        )
        failures++
      } else {
        console.log(`✅ ${name}: authentication gate is active`)
      }
      continue
    }
    if (!response.ok || !validate(body)) {
      console.error(`❌ ${name}: HTTP ${response.status}`)
      failures++
      continue
    }
    const build = response.headers.get('x-workspace-build')
    console.log(`✅ ${name}${build ? ` (build ${build})` : ''}`)
  } catch (error) {
    console.error(
      `❌ ${name}: ${error instanceof Error ? error.message : String(error)}`,
    )
    failures++
  }
}

// The dashboard must have one startup owner. A stale cached artifact that
// still renders the legacy splash alongside WorkspaceShell can otherwise look
// healthy at /api/health while showing two full-screen loading experiences.
try {
  const dashboardResponse = await fetch(`${baseUrl}/dashboard`, {
    headers: { accept: 'text/html' },
  })
  const dashboardHtml = await dashboardResponse.text()
  const startup = inspectDashboardStartup(dashboardHtml)
  if (!dashboardResponse.ok || !startup.healthy) {
    console.error(
      `❌ dashboard startup ownership: HTTP ${dashboardResponse.status}; legacy timers=${startup.legacySplashTimers}, visible splash marker=${startup.visibleSplashMarker}`,
    )
    failures++
  } else {
    console.log('✅ dashboard startup ownership (one owner)')
  }
} catch (error) {
  console.error(
    `❌ dashboard startup ownership: ${error instanceof Error ? error.message : String(error)}`,
  )
  failures++
}

if (failures > 0) process.exit(1)
