#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

export function checkPwa(root = process.cwd()) {
  const manifestPath = join(root, 'public', 'manifest.json')
  const serviceWorkerPath = join(root, 'public', 'sw.js')
  const rootRoutePath = join(root, 'src', 'routes', '__root.tsx')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const serviceWorker = readFileSync(serviceWorkerPath, 'utf8')
  const rootRoute = readFileSync(rootRoutePath, 'utf8')
  const failures = []

  for (const field of ['name', 'short_name', 'start_url', 'scope', 'display']) {
    if (typeof manifest[field] !== 'string' || !manifest[field]) failures.push(`manifest.${field} is required`)
  }
  if (manifest.scope !== '/') failures.push('manifest.scope must be /')
  if (!['standalone', 'fullscreen', 'minimal-ui', 'browser'].includes(manifest.display)) failures.push('manifest.display must be an installable display mode')
  if (!Array.isArray(manifest.icons) || manifest.icons.length < 2) failures.push('manifest.icons must contain at least two icons')
  for (const icon of manifest.icons || []) {
    if (!icon.src || !icon.sizes || !icon.type) failures.push('each manifest icon needs src, sizes, and type')
    const iconPath = join(root, 'public', String(icon.src).replace(/^\//, ''))
    if (!existsSync(iconPath) || statSync(iconPath).size === 0) failures.push(`manifest icon is missing or empty: ${icon.src}`)
  }
  if (!serviceWorker.includes("const OFFLINE_URL = '/offline.html'")) failures.push('service worker must define an offline shell URL')
  if (!/cache\.put\(\s*OFFLINE_URL/.test(serviceWorker)) failures.push('service worker must cache the offline shell during install')
  if (!serviceWorker.includes("url.pathname.startsWith('/api/')")) failures.push('service worker must exclude API responses from cache')
  if (!serviceWorker.includes('request.mode === \'navigate\'')) failures.push('service worker must provide navigation fallback')
  if (!rootRoute.includes("rel: 'manifest'") || !rootRoute.includes("register('/sw.js'")) failures.push('root route must expose the manifest and register the service worker')
  return { ok: failures.length === 0, manifest: { name: manifest.name, display: manifest.display, iconCount: manifest.icons?.length || 0 }, failures }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkPwa(resolve(process.argv[2] || process.cwd()))
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exitCode = 1
}
