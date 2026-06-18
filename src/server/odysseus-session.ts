/**
 * Server-side Odysseus session manager.
 * Maintains a single authenticated session cookie for all proxied requests.
 * Automatically re-authenticates on 401 responses.
 */

const ODYSSEUS_BASE = process.env['ODYSSEUS_BASE_URL'] ?? 'http://127.0.0.1:7100'
const USERNAME = process.env['ODYSSEUS_USERNAME'] ?? ''
const PASSWORD = process.env['ODYSSEUS_PASSWORD'] ?? ''

let cachedCookie: string | null = null

async function login(): Promise<string | null> {
  if (!USERNAME || !PASSWORD) return null
  try {
    const res = await fetch(`${ODYSSEUS_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    })
    if (!res.ok) return null
    const setCookie = res.headers.get('set-cookie')
    if (!setCookie) return null
    // Extract session cookie value (e.g. "session=abc123; Path=/; ...")
    const match = setCookie.match(/^([^;]+)/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

export async function getOdysseusCookie(): Promise<string | null> {
  if (!cachedCookie) {
    cachedCookie = await login()
  }
  return cachedCookie
}

export async function invalidateOdysseusCookie(): Promise<void> {
  cachedCookie = null
}

export { ODYSSEUS_BASE }
