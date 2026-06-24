import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const GOOGLE_ALLOWED_EMAIL = 'fernandonaveen2000@gmail.com'

const GOOGLE_REDIRECT_URI = 'https://agent.fernandofamily.com/api/auth/google/callback'

const HERMES_HOME =
  process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? join(homedir(), '.hermes')
const PROFILE_FILE = join(HERMES_HOME, 'workspace-user-profile.json')

export type GoogleUserProfile = {
  email: string
  name: string
  picture: string
}

export function storeUserProfile(profile: GoogleUserProfile): void {
  try {
    writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2), { encoding: 'utf8', mode: 0o600 })
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
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
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
// ---------------------------------------------------------------------------
const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes
const _oauthStates = new Map<string, number>() // state -> expiry unix-ms

setInterval(() => {
  const now = Date.now()
  for (const [s, exp] of _oauthStates) {
    if (exp < now) _oauthStates.delete(s)
  }
}, 5 * 60 * 1000)

export function storeOAuthState(state: string): void {
  _oauthStates.set(state, Date.now() + STATE_TTL_MS)
}

export function consumeOAuthState(state: string): boolean {
  const expiry = _oauthStates.get(state)
  if (!expiry || expiry < Date.now()) return false
  _oauthStates.delete(state)
  return true
}
