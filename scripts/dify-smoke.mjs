#!/usr/bin/env node
/**
 * Optional Dify service smoke test.
 * Skips cleanly when DIFY_BASE_URL or a registered app is not configured.
 * Set DIFY_SMOKE_RUN=1 to execute a blocking app request as well.
 */

const baseUrl = (process.env.DIFY_BASE_URL || '').replace(/\/+$/, '')
if (!baseUrl) {
  console.log('⏭️ Dify smoke skipped: DIFY_BASE_URL is not configured')
  process.exit(0)
}

let apps = []
try {
  apps = JSON.parse(process.env.DIFY_APPS_JSON || '[]')
} catch {
  console.error('❌ Dify smoke: DIFY_APPS_JSON is invalid JSON')
  process.exit(1)
}

const app = apps.find((entry) => entry && entry.enabled !== false)
if (!app?.keyEnv || !process.env[app.keyEnv]) {
  console.log('⏭️ Dify smoke skipped: no enabled app key is configured')
  process.exit(0)
}

const key = process.env[app.keyEnv]
const headers = { Authorization: `Bearer ${key}`, Accept: 'application/json' }
let failures = 0

async function check(name, path) {
  try {
    const response = await fetch(`${baseUrl}${path}`, { headers })
    if (!response.ok) {
      console.error(`❌ ${name}: HTTP ${response.status}`)
      failures++
      return null
    }
    console.log(`✅ ${name}`)
    return response.json().catch(() => null)
  } catch (error) {
    console.error(
      `❌ ${name}: ${error instanceof Error ? error.message : String(error)}`,
    )
    failures++
    return null
  }
}

await check('Dify public service', '/console/api/setup')
const info = await check('Dify app info', '/v1/info')
await check('Dify app parameters', '/v1/parameters')

if (process.env.DIFY_SMOKE_RUN === '1' && info?.mode === 'workflow') {
  try {
    const response = await fetch(`${baseUrl}/v1/workflows/run`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputs: {},
        response_mode: 'blocking',
        user: 'hermes-workspace-smoke',
      }),
    })
    if (!response.ok) {
      console.error(`❌ Dify workflow run: HTTP ${response.status}`)
      failures++
    } else {
      console.log('✅ Dify workflow run')
    }
  } catch (error) {
    console.error(
      `❌ Dify workflow run: ${error instanceof Error ? error.message : String(error)}`,
    )
    failures++
  }
}

if (process.env.DIFY_SMOKE_RUN === '1' && info?.mode === 'completion') {
  try {
    const response = await fetch(`${baseUrl}/v1/completion-messages`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputs: { query: 'Reply with exactly: HERMES_DIFY_SMOKE_OK' },
        query: 'Reply with exactly: HERMES_DIFY_SMOKE_OK',
        response_mode: 'blocking',
        user: 'hermes-workspace-smoke',
      }),
    })
    if (!response.ok) {
      console.error(`❌ Dify completion run: HTTP ${response.status}`)
      failures++
    } else {
      const result = await response.json()
      if (result?.answer !== 'HERMES_DIFY_SMOKE_OK') {
        console.error('❌ Dify completion run: unexpected answer')
        failures++
      } else {
        console.log('✅ Dify completion run')
      }
    }
  } catch (error) {
    console.error(
      `❌ Dify completion run: ${error instanceof Error ? error.message : String(error)}`,
    )
    failures++
  }
}

if (failures > 0) process.exit(1)
