import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { ODYSSEUS_BASE, getOdysseusCookie, invalidateOdysseusCookie } from '../../server/odysseus-session'

export const Route = createFileRoute('/api/odysseus/$')({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
      PUT: handler,
      PATCH: handler,
      DELETE: handler,
    },
  },
})

async function handler({ request }: { request: Request }): Promise<Response> {
  if (!isAuthenticated(request)) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  const url = new URL(request.url)
  // Strip /api/odysseus prefix; forward the rest as /api/<rest>
  const rest = url.pathname.replace(/^\/api\/odysseus/, '')
  const target = `${ODYSSEUS_BASE}/api${rest}${url.search}`

  const upstreamHeaders = new Headers(request.headers)
  // Don't forward host or hop-by-hop headers
  for (const h of ['host', 'connection', 'keep-alive', 'upgrade', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer']) {
    upstreamHeaders.delete(h)
  }
  // Prevent nginx/CDN buffering on SSE stream endpoints
  if (url.pathname.includes('/stream/')) {
    upstreamHeaders.set('X-Accel-Buffering', 'no')
  }

  // Inject server-side Odysseus session cookie
  const sessionCookie = await getOdysseusCookie()
  if (sessionCookie) {
    upstreamHeaders.set('cookie', sessionCookie)
  }

  let body: BodyInit | null = null
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.arrayBuffer()
  }

  const doRequest = async () => {
    const upstream = await fetch(target, {
      method: request.method,
      headers: upstreamHeaders,
      body: body ?? undefined,
      // @ts-expect-error -- Node 18+ fetch supports this
      duplex: 'half',
    })
    return upstream
  }

  try {
    let upstream = await doRequest()

    // On 401/403 invalidate cached cookie and retry once with a fresh session
    if ((upstream.status === 401 || upstream.status === 403) && sessionCookie) {
      await invalidateOdysseusCookie()
      const freshCookie = await getOdysseusCookie()
      if (freshCookie) {
        upstreamHeaders.set('cookie', freshCookie)
        upstream = await doRequest()
      }
    }

    const responseHeaders = new Headers(upstream.headers)
    // Remove hop-by-hop headers that must not be forwarded
    responseHeaders.delete('transfer-encoding')
    responseHeaders.delete('connection')
    // Don't forward Odysseus's own set-cookie to browser (we manage the session server-side)
    responseHeaders.delete('set-cookie')

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Odysseus unreachable'
    return new Response(
      JSON.stringify({ ok: false, error: `Odysseus unreachable (${target}): ${message}` }),
      {
        status: 502,
        headers: { 'content-type': 'application/json' },
      },
    )
  }
}
