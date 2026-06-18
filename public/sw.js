// Hermes Workspace Service Worker
// Privacy-first PWA cache policy:
// - Cache hashed static assets and app branding images for fast repeat launches.
// - Never cache /api/* responses, SSE streams, or user/session data.
// - Return a small offline shell for navigations when the network is unavailable.

const CACHE_VERSION = 'hw-static-v2'
const OFFLINE_URL = '/offline.html'

const ASSET_RE = /\/assets\/[^/?#]+\.(js|css|wasm|woff2?)(\?|$)/
const BRANDING_RE =
  /^\/(claude-(avatar|banner|banner-light|icon-192|icon-512)\.(png|webp)|apple-touch-icon\.png|favicon\.svg|manifest\.json)(\?|$)/

const OFFLINE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Hermes Workspace Offline</title>
  <style>
    html,body{height:100%;margin:0;background:#282c34;color:#9cdef2;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
    main{min-height:100%;display:grid;place-items:center;padding:24px;text-align:center;box-sizing:border-box}
    .card{max-width:420px;border:1px solid rgba(156,222,242,.28);border-radius:24px;background:rgba(30,34,40,.88);padding:28px;box-shadow:0 12px 40px rgba(0,0,0,.35)}
    img{width:72px;height:72px;border-radius:16px;margin-bottom:16px}
    h1{font-size:20px;margin:0 0 10px;color:#fff}
    p{font-size:14px;line-height:1.6;margin:0;color:rgba(156,222,242,.78)}
    button{margin-top:20px;border:1px solid rgba(240,128,144,.5);background:rgba(240,128,144,.12);color:#f08090;border-radius:999px;padding:10px 16px;font:inherit;cursor:pointer}
  </style>
</head>
<body>
  <main>
    <section class="card">
      <img src="/claude-avatar.webp" alt="Hermes" />
      <h1>Hermes is offline</h1>
      <p>The app shell is installed, but the workspace needs network access to reach live agent sessions, tools, and gateway status.</p>
      <button onclick="location.reload()">Retry connection</button>
    </section>
  </main>
</body>
</html>`

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.put(
        OFFLINE_URL,
        new Response(OFFLINE_HTML, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      ),
    ),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name !== CACHE_VERSION)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws-')) {
    return
  }

  if (ASSET_RE.test(url.pathname) || BRANDING_RE.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(request)
        if (cached) return cached
        const response = await fetch(request)
        if (response.ok) await cache.put(request, response.clone())
        return response
      }),
    )
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_VERSION)
        return cache.match(OFFLINE_URL)
      }),
    )
  }
})
