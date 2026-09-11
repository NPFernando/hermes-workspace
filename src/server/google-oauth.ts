import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const GOOGLE_ALLOWED_EMAIL = 'fernandonaveen2000@gmail.com'

const GOOGLE_REDIRECT_URI =
  'https://agent.fernandofamily.com/api/auth/google/callback'

const HERMES_HOME =
  process.env.HERMES_HOME ??
  process.env.CLAUDE_HOME ??
  join(homedir(), '.hermes')
const PROFILE_FILE = join(HERMES_HOME, 'workspace-user-profile.json')
const GMAIL_TOKEN_FILE = join(HERMES_HOME, 'finance', 'gmail-oauth.json')
const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const OAUTH_STATE_COOKIE = 'hermes-oauth-state'
const OAUTH_STATE_TTL_SECONDS = 10 * 60

function writePrivateJsonAtomically(filePath: string, value: unknown): void {
  const serialized = JSON.stringify(value, null, 2)
  const tempFile = `${filePath}.${process.pid}.tmp`
  try {
    writeFileSync(tempFile, serialized, { encoding: 'utf8', mode: 0o600 })
    chmodSync(tempFile, 0o600)
    renameSync(tempFile, filePath)
    try {
      chmodSync(filePath, 0o600)
    } catch {
      // chmod is best-effort on platforms without POSIX permissions.
    }
  } catch (error) {
    // Preserve compatibility with filesystems that cannot replace an existing
    // file atomically (notably some Windows configurations).
    try {
      writeFileSync(filePath, serialized, { encoding: 'utf8', mode: 0o600 })
      chmodSync(filePath, 0o600)
    } catch {
      throw error
    } finally {
      try {
        unlinkSync(tempFile)
      } catch {
        // The temporary file may already have been renamed or never created.
      }
    }
  }
}

export type GoogleUserProfile = {
  email: string
  name: string
  picture: string
}

export function storeUserProfile(profile: GoogleUserProfile): void {
  try {
    writePrivateJsonAtomically(PROFILE_FILE, profile)
  } catch {
    console.warn('[google-oauth] Failed to persist user profile')
  }
}

export function getUserProfile(): GoogleUserProfile | null {
  try {
    if (!existsSync(PROFILE_FILE)) return null
    const raw = readFileSync(PROFILE_FILE, 'utf8')
    return JSON.parse(raw) as GoogleUserProfile
  } catch {
    return null
  }
}

export function isGoogleOAuthEnabled(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  )
}

export function buildGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: GOOGLE_REDIRECT_URI,
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function exchangeCodeForEmail(
  code: string,
): Promise<{ email: string; name: string; picture: string }> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString(),
  })

  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => '')
    throw new Error(`Google token exchange failed ${tokenRes.status}: ${body}`)
  }

  const tokens = (await tokenRes.json()) as { access_token: string }

  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })

  if (!userRes.ok) {
    throw new Error(`Google userinfo failed: ${userRes.status}`)
  }

  const info = (await userRes.json()) as {
    email?: string
    name?: string
    picture?: string
  }
  if (!info.email) throw new Error('No email in Google userinfo response')
  return {
    email: info.email,
    name: info.name ?? '',
    picture: info.picture ?? '',
  }
}

// ---------------------------------------------------------------------------
// Server-side OAuth state store (replaces the cookie-based CSRF approach).
// Single-instance deployment so in-memory is fine.
//
// Carries a `purpose` so the single shared callback route
// (/api/auth/google/callback, the only redirect_uri registered with Google)
// can tell a plain login exchange apart from the Gmail-connect exchange
// (which additionally needs a refresh token and the gmail.readonly scope)
// without registering a second redirect_uri in Google Cloud Console.
// ---------------------------------------------------------------------------
export type OAuthStatePurpose = 'login' | 'gmail_connect'

const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes
const MAX_OAUTH_STATES = 1_000
const _oauthStates = new Map<
  string,
  { expiry: number; purpose: OAuthStatePurpose }
>()

function pruneOAuthStates(now = Date.now()): void {
  for (const [s, entry] of _oauthStates) {
    if (entry.expiry < now) _oauthStates.delete(s)
  }
}

setInterval(() => pruneOAuthStates(), 5 * 60 * 1000)

export function storeOAuthState(
  state: string,
  purpose: OAuthStatePurpose = 'login',
): void {
  pruneOAuthStates()
  while (_oauthStates.size >= MAX_OAUTH_STATES) {
    const oldest = _oauthStates.keys().next().value
    if (!oldest) break
    _oauthStates.delete(oldest)
  }
  _oauthStates.set(state, { expiry: Date.now() + STATE_TTL_MS, purpose })
}

export function consumeOAuthState(state: string): OAuthStatePurpose | null {
  const entry = _oauthStates.get(state)
  if (!entry || entry.expiry < Date.now()) return null
  _oauthStates.delete(state)
  return entry.purpose
}

function oauthStateCookieSecure(): boolean {
  const override = (process.env.COOKIE_SECURE || '').trim().toLowerCase()
  if (override === '1' || override === 'true' || override === 'yes') return true
  if (override === '0' || override === 'false' || override === 'no')
    return false
  return process.env.NODE_ENV === 'production'
}

/** Bind an OAuth state to the browser that initiated the flow. */
export function createOAuthStateCookie(state: string): string {
  const attrs = [
    'HttpOnly',
    'SameSite=Lax',
    'Path=/api/auth',
    `Max-Age=${OAUTH_STATE_TTL_SECONDS}`,
  ]
  if (oauthStateCookieSecure()) attrs.push('Secure')
  return `${OAUTH_STATE_COOKIE}=${encodeURIComponent(state)}; ${attrs.join('; ')}`
}

export function clearOAuthStateCookie(): string {
  const attrs = ['HttpOnly', 'SameSite=Lax', 'Path=/api/auth', 'Max-Age=0']
  if (oauthStateCookieSecure()) attrs.push('Secure')
  return `${OAUTH_STATE_COOKIE}=; ${attrs.join('; ')}`
}

export function getOAuthStateCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  for (const cookie of cookieHeader.split(';')) {
    const trimmed = cookie.trim()
    if (!trimmed.startsWith(`${OAUTH_STATE_COOKIE}=`)) continue
    try {
      return decodeURIComponent(trimmed.slice(OAUTH_STATE_COOKIE.length + 1))
    } catch {
      return null
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Gmail read-only connect — a separate, explicit consent step from login.
// Requests offline access (refresh token) + gmail.readonly on top of the
// login scopes, using the SAME already-registered redirect_uri (Google
// requires exact match; adding a second one would need a Cloud Console
// change). The refresh token is stored in its own file under
// ~/.hermes/finance/ (0600, outside the repo and outside finance.json —
// never touch the shared ~/.hermes/.env, which many other cron/services
// parse and a malformed edit there would be much higher blast radius).
// ---------------------------------------------------------------------------
export function buildGmailConnectAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: GOOGLE_REDIRECT_URI,
    scope: `openid email ${GMAIL_READONLY_SCOPE}`,
    state,
    access_type: 'offline',
    prompt: 'consent',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function exchangeCodeForGmailTokens(
  code: string,
): Promise<{ refreshToken: string; email: string }> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString(),
  })
  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => '')
    throw new Error(`Google token exchange failed ${tokenRes.status}: ${body}`)
  }
  const tokens = (await tokenRes.json()) as {
    access_token: string
    refresh_token?: string
  }
  if (!tokens.refresh_token) {
    throw new Error(
      'Google did not return a refresh token (it only issues one on first consent). Revoke this app at https://myaccount.google.com/permissions and try connecting again.',
    )
  }

  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  if (!userRes.ok) throw new Error(`Google userinfo failed: ${userRes.status}`)
  const info = (await userRes.json()) as { email?: string }
  if (
    !info.email ||
    info.email.toLowerCase() !== GOOGLE_ALLOWED_EMAIL.toLowerCase()
  ) {
    throw new Error('Gmail must be connected with the same authorized account.')
  }

  return { refreshToken: tokens.refresh_token, email: info.email }
}

type GmailOAuthRecord = {
  refreshToken: string
  email: string
  connectedAt: string
}

export function storeGmailRefreshToken(
  refreshToken: string,
  email: string,
): void {
  const record: GmailOAuthRecord = {
    refreshToken,
    email,
    connectedAt: new Date().toISOString(),
  }
  mkdirSync(join(HERMES_HOME, 'finance'), { recursive: true, mode: 0o700 })
  writePrivateJsonAtomically(GMAIL_TOKEN_FILE, record)
}

export function readGmailRefreshToken(): string | null {
  try {
    const record = JSON.parse(
      readFileSync(GMAIL_TOKEN_FILE, 'utf8'),
    ) as GmailOAuthRecord
    return record.refreshToken || null
  } catch {
    return null
  }
}

export function isGmailConnected(): boolean {
  return Boolean(readGmailRefreshToken())
}

export async function getGmailAccessToken(): Promise<string> {
  const refreshToken = readGmailRefreshToken()
  if (!refreshToken) throw new Error('Gmail is not connected.')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Gmail token refresh failed ${res.status}: ${body}`)
  }
  const data = (await res.json()) as { access_token: string }
  return data.access_token
}
