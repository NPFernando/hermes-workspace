#!/usr/bin/env node
/**
 * Verify that the HTML shell and its local hashed assets are served as one
 * coherent release. This is intentionally independent of authentication so it
 * can run immediately after a deployment restart.
 */
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'

function assetReferencesFromHtml(html) {
  return [...html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .filter((reference) =>
      reference.startsWith('/') &&
      (reference.startsWith('/assets/') || reference.startsWith('/_next/static/')) &&
      !reference.includes('#'),
    )
}

export async function runLocalAssetIntegrity(html, clientRoot) {
  const references = [...new Set(assetReferencesFromHtml(html))]
  if (references.length === 0) {
    throw new Error('asset integrity: HTML shell contains no local JS/CSS assets')
  }

  const failures = []
  const root = resolve(clientRoot)
  for (const reference of references) {
    const pathname = decodeURIComponent(new URL(reference, 'http://localhost').pathname)
    const filePath = resolve(root, `.${pathname}`)
    if (!filePath.startsWith(`${root}/`)) {
      failures.push(`${reference} (unsafe path)`)
      continue
    }
    try {
      const file = await stat(filePath)
      if (!file.isFile()) failures.push(`${reference} (not a file)`)
    } catch {
      failures.push(`${reference} (missing)`)
    }
  }

  if (failures.length > 0) {
    throw new Error(`asset integrity: missing local assets: ${failures.join(', ')}`)
  }
  return { assetCount: references.length }
}

export async function runAssetIntegrity(baseUrl, fetchImpl = fetch, initialRoot = null) {
  const rootUrl = new URL('/', `${baseUrl.replace(/\/$/, '')}/`)
  async function fetchWithRetry(url, options) {
    let lastError
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3_000)
      try {
        return await fetchImpl(url, { ...options, signal: controller.signal })
      } catch (error) {
        lastError = error
        if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
      } finally {
        clearTimeout(timeout)
      }
    }
    throw lastError
  }

  const root = initialRoot || await fetchWithRetry(rootUrl, { cache: 'no-store' })
  if (!root.ok) throw new Error(`asset integrity: HTML shell returned HTTP ${root.status}`)

  const html = await root.text()
  const references = assetReferencesFromHtml(html)

  const uniqueReferences = [...new Set(references)]
  if (uniqueReferences.length === 0) {
    throw new Error('asset integrity: HTML shell contains no local JS/CSS assets')
  }

  const failures = []
  // Keep the check representative of browser loading instead of opening one
  // connection per asset. The unbounded burst is fragile on small CI runners
  // and can make an otherwise healthy local server drop every request.
  const pending = [...uniqueReferences]
  const workerCount = 1
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (pending.length > 0) {
      const reference = pending.shift()
      const response = await fetchWithRetry(new URL(reference, rootUrl), {
        method: 'HEAD',
        cache: 'no-store',
      }).catch(() => ({ ok: false, status: 0 }))
      if (!response.ok) {
        failures.push(`${reference} (HTTP ${response.status})`)
      } else {
      }
    }
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
