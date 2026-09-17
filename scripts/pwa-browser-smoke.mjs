#!/usr/bin/env node
/**
 * Browser-level PWA smoke. Source checks prove that the PWA is wired; this
 * check proves that a real browser can register it and receive the offline
 * navigation shell without putting API responses in the cache.
 */
import { chromium } from 'playwright'

export async function runPwaBrowserSmoke({
  baseUrl = process.env.PWA_BASE_URL ||
    process.argv[2] ||
    'http://127.0.0.1:3000',
} = {}) {
  const targetUrl = baseUrl.replace(/\/$/, '')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  const failures = []
  let registration = null
  let manifest = null

  function fail(message) {
    failures.push(message)
  }

  try {
    const response = await page.goto(`${targetUrl}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    if (!response || response.status() >= 400)
      fail(`root returned HTTP ${response?.status() ?? 'unknown'}`)

    registration = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return null
      try {
        const ready = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((resolve) => setTimeout(() => resolve(null), 10_000)),
        ])
        if (!ready) return null
        return {
          scope: ready.scope,
          scriptURL:
            ready.active?.scriptURL ||
            ready.waiting?.scriptURL ||
            ready.installing?.scriptURL ||
            '',
        }
      } catch {
        return null
      }
    })
    if (!registration)
      fail('service worker did not become ready within 10 seconds')
    else if (!registration.scriptURL.endsWith('/sw.js'))
      fail(`unexpected service worker script: ${registration.scriptURL}`)
    else if (!registration.scope.endsWith('/'))
      fail(`unexpected service worker scope: ${registration.scope}`)

    manifest = await page.evaluate(async () => {
      const response = await fetch('/manifest.json', { cache: 'no-store' })
      if (!response.ok) return null
      return response.json()
    })
    if (
      !manifest ||
      manifest.display !== 'standalone' ||
      manifest.scope !== '/' ||
      !Array.isArray(manifest.icons) ||
      manifest.icons.length < 2
    ) {
      fail('manifest is missing installability metadata')
    }

    const cachedBeforeOffline = await page.evaluate(async () => {
      const names = await caches.keys()
      const entries = []
      for (const name of names) {
        const cache = await caches.open(name)
        for (const request of await cache.keys()) entries.push(request.url)
      }
      return { names, entries }
    })
    if (
      cachedBeforeOffline.entries.some((url) =>
        new URL(url).pathname.startsWith('/api/'),
      )
    ) {
      fail('service-worker cache contains an API response')
    }

    await context.setOffline(true)
    const offlinePage = await context.newPage()
    try {
      await offlinePage.goto(`${targetUrl}/__hermes_pwa_offline_probe__`, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      })
      const offlineResult = await offlinePage.evaluate(() => ({
        title: document.title,
        text: document.body?.innerText || '',
      }))
      if (
        offlineResult.title !== 'Hermes Workspace Offline' ||
        !/Hermes is offline/i.test(offlineResult.text)
      ) {
        fail('offline navigation did not return the Hermes offline shell')
      }
    } catch (error) {
      fail(
        `offline navigation failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      await offlinePage.close()
    }
  } finally {
    await context.setOffline(false).catch(() => {})
    await browser.close()
  }

  return {
    ok: failures.length === 0,
    url: targetUrl,
    registration,
    manifest: manifest
      ? {
          display: manifest.display,
          scope: manifest.scope,
          iconCount: manifest.icons?.length || 0,
        }
      : null,
    failures,
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await runPwaBrowserSmoke()
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exitCode = 1
  } catch (error) {
    console.error(
      `PWA browser smoke failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exitCode = 1
  }
}
