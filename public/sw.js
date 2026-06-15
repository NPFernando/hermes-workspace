// Hermes Workspace Service Worker
// Cache-first for hashed static assets (/assets/*), network-first for everything else.
// Hashed assets are safe to cache indefinitely — their URLs change on each build.

const CACHE = 'hw-static-v1'

// Only cache JS/CSS/WASM/font assets with content-hash filenames
const ASSET_RE = /\/assets\/[^/?#]+\.(js|css|wasm|woff2?)(\?|$)/

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(caches.open(CACHE))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE).map((n) => caches.delete(n)),
      ),
    ).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Cache-first for hashed static assets
  if (url.origin === self.location.origin && ASSET_RE.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request)
        if (cached) return cached
        const response = await fetch(request)
        if (response.ok) cache.put(request, response.clone())
        return response
      }),
    )
    return
  }

  // Everything else (HTML, API, WS) goes straight to network
})
