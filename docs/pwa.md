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

The check validates required installability metadata, icon files, service
worker offline fallback, API cache exclusion, and root registration. Browser
runtime behavior remains covered by the root registration and offline-banner
tests; the live authenticated smoke suite should be used for final deployed
verification when its dedicated low-privilege credential is available.
