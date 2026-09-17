# PWA and offline support

The workspace is installable through `public/manifest.json` and registers
`public/sw.js` from the root layout. The service worker caches only hashed
static assets, branding, the manifest, and a small offline navigation shell.
API responses, WebSocket paths, SSE streams, and user/session data are never
cached.

Run the release integrity check with:

```sh
pnpm run check:pwa
```

Run the browser-level check against a running workspace with:

```sh
PWA_BASE_URL=http://127.0.0.1:3000 pnpm run check:pwa:browser
```

The check validates required installability metadata, icon files, service
worker offline fallback, API cache exclusion, and root registration. The
browser check verifies service-worker readiness, installability metadata,
offline navigation fallback, and that API responses are not present in the
service-worker cache. The live authenticated smoke suite should be used for
final deployed verification when its dedicated low-privilege credential is
available.
