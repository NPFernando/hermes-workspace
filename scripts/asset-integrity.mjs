#!/usr/bin/env node
/**
 * Verify that the HTML shell and its local hashed assets are served as one
 * coherent release. This is intentionally independent of authentication so it
 * can run immediately after a deployment restart.
 */
export async function runAssetIntegrity(baseUrl, fetchImpl = fetch) {
  const rootUrl = new URL('/', `${baseUrl.replace(/\/$/, '')}/`)
  const root = await fetchImpl(rootUrl, { cache: 'no-store' })
  if (!root.ok) throw new Error(`asset integrity: HTML shell returned HTTP ${root.status}`)

  const html = await root.text()
  const references = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .filter((reference) =>
      reference.startsWith('/') &&
      (reference.startsWith('/assets/') || reference.startsWith('/_next/static/')) &&
      !reference.includes('#'),
    )

  const uniqueReferences = [...new Set(references)]
  if (uniqueReferences.length === 0) {
    throw new Error('asset integrity: HTML shell contains no local JS/CSS assets')
  }

  const failures = []
  await Promise.all(uniqueReferences.map(async (reference) => {
    const response = await fetchImpl(new URL(reference, rootUrl), {
      method: 'GET',
      cache: 'no-store',
    }).catch((error) => ({ ok: false, status: 0, error }))
    if (!response.ok) failures.push(`${reference} (HTTP ${response.status})`)
  }))

  if (failures.length > 0) {
    throw new Error(`asset integrity: missing or unavailable assets: ${failures.join(', ')}`)
  }
  return { assetCount: uniqueReferences.length }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const baseUrl = process.argv[2] || 'http://127.0.0.1:3000'
  try {
    const result = await runAssetIntegrity(baseUrl)
    console.log(`asset integrity passed: ${result.assetCount} local assets`)
  } catch (error) {
    console.error(`asset integrity failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
