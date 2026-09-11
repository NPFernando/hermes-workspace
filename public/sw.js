// Hermes Workspace Service Worker
// Privacy-first PWA cache policy:
// - Cache hashed static assets and app branding images for fast repeat launches.
// - Never cache /api/* responses, SSE streams, or user/session data.
// - Return a small offline shell for navigations when the network is unavailable.

const CACHE_VERSION = 'hw-static-v3'
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
    html,body{height:100%;margin:0;background:#041c1c;color:#ffe6cb;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
    main{min-height:100%;display:grid;place-items:center;padding:24px;text-align:center;box-sizing:border-box}
    .card{max-width:420px;border:1px solid rgba(255,172,2,.32);border-radius:20px;background:rgba(8,45,45,.94);padding:28px;box-shadow:0 16px 48px rgba(0,0,0,.32)}
    img{width:72px;height:72px;border:1px solid rgba(255,172,2,.38);border-radius:16px;margin-bottom:16px}
    .status{display:inline-flex;align-items:center;gap:7px;margin-bottom:14px;color:#8df59a;font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase}
    .status::before{content:"";width:7px;height:7px;border-radius:50%;background:#8df59a}
    h1{font-size:22px;line-height:1.2;margin:0 0 10px;color:#ffe6cb}
    p{font-size:14px;line-height:1.6;margin:0;color:rgba(255,230,203,.72)}
    button{margin-top:20px;border:1px solid rgba(255,172,2,.6);background:#ffac02;color:#062020;border-radius:9px;padding:11px 17px;font:600 13px/1 ui-monospace,SFMono-Regular,Menlo,monospace;cursor:pointer}
    button:focus-visible{outline:2px solid #8df59a;outline-offset:3px}
  </style>
</head>
<body>
  <main>
    <section class="card">
      <img src="/claude-avatar.webp" alt="Hermes Workspace logo" />
      <div class="status" role="status">Offline</div>
      <h1>Hermes Workspace is offline</h1>
      <p>The workspace shell is installed, but live agent sessions, tools, and gateway status need a network connection.</p>
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
