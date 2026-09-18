#!/usr/bin/env node
/**
 * Read-only post-build/release smoke check. It verifies the process is serving
 * the expected artifact and that the authenticated API boundary responds.
 */
import { runAssetIntegrity } from './asset-integrity.mjs'

export async function runReleaseSmoke(baseUrl, fetchImpl = fetch, expectedBuild = process.env.RELEASE_SMOKE_EXPECTED_BUILD) {
  const root = await fetchImpl(`${baseUrl}/`, { redirect: 'manual', cache: 'no-store' })
  if (root.status < 200 || root.status >= 400) throw new Error(`root returned HTTP ${root.status}`)
  if (expectedBuild && root.headers.get('x-workspace-build') !== expectedBuild) {
    throw new Error(`build mismatch: expected ${expectedBuild}, got ${root.headers.get('x-workspace-build') || 'missing'}`)
  }
  const assets = await runAssetIntegrity(baseUrl, fetchImpl)
  const auth = await fetchImpl(`${baseUrl}/api/auth-check`, { cache: 'no-store' })
  if (![200, 401, 503].includes(auth.status)) throw new Error(`auth-check returned unexpected HTTP ${auth.status}`)
  const contentType = auth.headers.get('content-type') || ''
  const bodyText = await auth.text()
  let body = null
  try {
    body = JSON.parse(bodyText)
  } catch {
    throw new Error(`auth-check returned non-JSON HTTP ${auth.status} (${contentType || 'no content type'})`)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(`auth-check returned invalid JSON HTTP ${auth.status}`)
  return { rootStatus: root.status, authStatus: auth.status, build: root.headers.get('x-workspace-build'), assetCount: assets.assetCount }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const baseUrl = process.argv[2] || 'http://127.0.0.1:3000'
  try {
    const result = await runReleaseSmoke(baseUrl)
    console.log(`release smoke passed: root=${result.rootStatus} auth-check=${result.authStatus} assets=${result.assetCount} build=${result.build || 'unknown'}`)
  } catch (error) {
    console.error(`release smoke failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
