import { randomBytes, timingSafeEqual } from 'node:crypto'
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
import { dirname, join } from 'node:path'

/**
 * Persistent session token store.
 *
 * Tokens are held in memory for fast lookup and persisted to a JSON file
 * so they survive server restarts.  This is safe for single-instance
 * deployments.  For multi-worker setups the file becomes a race-condition
 * window — in that case replace with Redis or a database.
 *
 * File location: ~/.hermes/workspace-sessions.json
 */
interface SessionStore {
  tokens: Record<string, number> // token -> expiry unix-ms
  /** Last authenticated request for each token; optional for legacy stores. */
  lastSeen?: Record<string, number>
}

const STORE_FILE = join(
  process.env.HERMES_HOME ??
    process.env.CLAUDE_HOME ??
    join(homedir(), '.hermes'),
  'workspace-sessions.json',
)
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days (legacy default)
const TOKEN_TTL_LONG = 365 * 24 * 60 * 60 * 1000 // 1 year (remember me)
const TOKEN_TTL_SHORT = 24 * 60 * 60 * 1000 // 24 hours (session-only)
const DEFAULT_IDLE_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours
const IDLE_PERSIST_INTERVAL_MS = 5 * 60 * 1000
/** Bound the persisted session set so repeated logins cannot grow it forever. */
export const MAX_SESSION_TOKENS = 1000

function configuredIdleTtl(): number {
  const configured = Number(process.env.HERMES_SESSION_IDLE_TIMEOUT_MS)
  if (Number.isFinite(configured) && configured >= 0) return configured
  return DEFAULT_IDLE_TTL_MS
}

function limitSessionTokens(
  tokens: Record<string, number>,
): Record<string, number> {
  const limited = { ...tokens }
  // Object insertion order is the token's insertion order because session
  // stores are written atomically after each login/revocation. Evict the
  // oldest active token first when the bounded set is exceeded.
  while (Object.keys(limited).length > MAX_SESSION_TOKENS) {
    const oldest = Object.keys(limited)[0]
    if (!oldest) break
    delete limited[oldest]
  }
  return limited
}

function loadStore(): SessionStore {
  try {
    if (existsSync(STORE_FILE)) {
      const raw = readFileSync(STORE_FILE, 'utf8')
      const parsed = JSON.parse(raw) as SessionStore
      // Expire any stale tokens on load
      const now = Date.now()
      const valid: Record<string, number> = {}
      const lastSeen: Record<string, number> = {}
      for (const [token, expiry] of Object.entries(parsed.tokens)) {
        if (expiry <= now) continue
        const seen = parsed.lastSeen?.[token]
        // Legacy stores have no activity timestamp. Treat the first request
        // after upgrade as the baseline rather than logging every user out.
        valid[token] = expiry
        lastSeen[token] =
          typeof seen === 'number' && Number.isFinite(seen) ? seen : now
      }
      const limited = limitSessionTokens(valid)
      return {
        tokens: limited,
        lastSeen: Object.fromEntries(
          Object.keys(limited).map((token) => [token, lastSeen[token] ?? now]),
        ),
      }
    }
  } catch {
    // Corrupt store — start fresh
  }
  return { tokens: {} }
}

function saveStore(store: SessionStore): void {
  const serialized = JSON.stringify(store)
  const tempFile = `${STORE_FILE}.${process.pid}.tmp`
  try {
    const dir = dirname(STORE_FILE)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
    }
    // Write with restrictive permissions — tokens are sensitive. Replace the
    // live file atomically so an interrupted write cannot leave malformed JSON
    // and invalidate every persisted session.
    writeFileSync(tempFile, serialized, {
      encoding: 'utf8',
      mode: 0o600,
    })
    chmodSync(tempFile, 0o600)
    renameSync(tempFile, STORE_FILE)
    // Enforce 0600 even if the platform preserves the destination mode.
    try {
      chmodSync(STORE_FILE, 0o600)
    } catch {
      // chmod is best-effort (e.g. Windows) — ignore failures.
    }
  } catch {
    // Some Windows filesystems refuse to replace an existing file with
    // renameSync. Preserve persistence as a fallback, while cleaning up the
    // temporary file whenever possible.
    try {
      writeFileSync(STORE_FILE, serialized, { encoding: 'utf8', mode: 0o600 })
      chmodSync(STORE_FILE, 0o600)
    } catch {
      // Non-fatal — tokens are still in memory.
      console.warn(`[auth] Failed to persist session store to ${STORE_FILE}`)
    }
    try {
      unlinkSync(tempFile)
    } catch {
      // The temporary file may already have been renamed or never created.
    }
  }
}

// In-memory working copy
const _tokens: Map<string, number> = new Map()
const _lastSeen: Map<string, number> = new Map()
const _lastSeenPersisted: Map<string, number> = new Map()

// Hydrate from disk on module load
const initial = loadStore()
for (const [token, expiry] of Object.entries(initial.tokens)) {
  _tokens.set(token, expiry)
  const seen = initial.lastSeen?.[token] ?? Date.now()
  _lastSeen.set(token, seen)
  _lastSeenPersisted.set(token, seen)
}

/**
 * Prune expired tokens from the store (called on every write + a periodic sweep).
 */
function _prune(): void {
  const now = Date.now()
  let changed = false
  for (const [token, expiry] of _tokens) {
    if (expiry <= now) {
      _tokens.delete(token)
      _lastSeen.delete(token)
      _lastSeenPersisted.delete(token)
      changed = true
      continue
    }
    const seen = _lastSeen.get(token) ?? now
    if (configuredIdleTtl() > 0 && seen + configuredIdleTtl() <= now) {
      _tokens.delete(token)
      _lastSeen.delete(token)
      _lastSeenPersisted.delete(token)
      changed = true
    }
  }
  if (changed) _persist()
}

function _persist(): void {
  const store: SessionStore = {
    tokens: Object.fromEntries(_tokens),
    lastSeen: Object.fromEntries(_lastSeen),
  }
  saveStore(store)
  for (const [token, seen] of _lastSeen) _lastSeenPersisted.set(token, seen)
}

// Sweep expired tokens every 10 minutes
setInterval(_prune, 10 * 60 * 1000)

/**
 * Generate a cryptographically secure session token.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Store a session token.
 * rememberMe=true → 1-year TTL; rememberMe=false → 24-hour TTL; undefined → 30-day legacy default.
 */
export function storeSessionToken(token: string, rememberMe?: boolean): void {
  const ttl =
    rememberMe === true
      ? TOKEN_TTL_LONG
      : rememberMe === false
        ? TOKEN_TTL_SHORT
        : TOKEN_TTL_MS
  const now = Date.now()
  _tokens.set(token, now + ttl)
  _lastSeen.set(token, now)
  _lastSeenPersisted.set(token, now)
  while (_tokens.size > MAX_SESSION_TOKENS) {
    const oldest = _tokens.keys().next().value
    if (!oldest) break
    _tokens.delete(oldest)
    _lastSeen.delete(oldest)
    _lastSeenPersisted.delete(oldest)
  }
  _persist()
}

/**
 * Check if a session token is valid and not expired.
 */
export function isValidSessionToken(token: string): boolean {
  const expiry = _tokens.get(token)
  if (expiry === undefined) return false
  const now = Date.now()
  const lastSeen = _lastSeen.get(token) ?? now
  const idleTtl = configuredIdleTtl()
  if (expiry <= now || (idleTtl > 0 && lastSeen + idleTtl <= now)) {
    _tokens.delete(token)
    _lastSeen.delete(token)
    _lastSeenPersisted.delete(token)
    _persist()
    return false
  }
  _lastSeen.set(token, now)
  const persistedAt = _lastSeenPersisted.get(token) ?? 0
  if (now - persistedAt >= IDLE_PERSIST_INTERVAL_MS) _persist()
  return true
}

/**
 * Remove a session token (logout).
 */
export function revokeSessionToken(token: string): void {
  _tokens.delete(token)
  _lastSeen.delete(token)
  _lastSeenPersisted.delete(token)
  _persist()
}

/**
 * Resolve the configured workspace password.
 *
 * Honors HERMES_PASSWORD first (current name, post-rename) and falls back to
 * CLAUDE_PASSWORD for back-compat with deployments configured pre-rename.
 */
function getConfiguredPassword(): string {
  const fromHermes = process.env.HERMES_PASSWORD
  if (fromHermes && fromHermes.length > 0) return fromHermes
  const fromClaude = process.env.CLAUDE_PASSWORD
  if (fromClaude && fromClaude.length > 0) return fromClaude
  return ''
}

/**
 * Check if password protection is enabled.
 */
export function isPasswordProtectionEnabled(): boolean {
  return getConfiguredPassword().length > 0
}

/**
 * Verify password using timing-safe comparison.
 */
export function verifyPassword(password: string): boolean {
  const configured = getConfiguredPassword()
  if (!configured || configured.length === 0) {
    return false
  }

  // Timing-safe comparison
  const passwordBuf = Buffer.from(password, 'utf8')
  const configuredBuf = Buffer.from(configured, 'utf8')

  // If lengths differ, still do a comparison to avoid timing leak
  if (passwordBuf.length !== configuredBuf.length) {
    return false
  }

  try {
    return timingSafeEqual(passwordBuf, configuredBuf)
  } catch {
    return false
  }
}

/**
 * Extract session token from cookie header.
 */
export function getSessionTokenFromCookie(
  cookieHeader: string | null,
): string | null {
  if (!cookieHeader) return null

  const cookies = cookieHeader.split(';').map((c) => c.trim())
  for (const cookie of cookies) {
    if (cookie.startsWith('claude-auth=')) {
      return cookie.substring('claude-auth='.length)
    }
  }
  return null
}

/**
 * Whether the workspace is configured to trust proxy-forwarded headers
 * (`x-forwarded-for`, `x-real-ip`). Off by default — enabled explicitly when
 * deployed behind a trusted reverse proxy (Traefik, Nginx, Cloudflare).
 * See #125.
 */
function isTrustedProxyEnabled(): boolean {
  const v = (process.env.TRUST_PROXY || '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/**
 * Best-effort extraction of the peer IP, preferring the actual socket
 * address when available. Forwarded headers are only honored when
 * TRUST_PROXY is set — otherwise a client-controlled `x-forwarded-for`
 * could spoof local classification (#125).
 */
export function getRequestIp(request: Request): string {
  if (isTrustedProxyEnabled()) {
    const forwarded = request.headers.get('x-forwarded-for')
    const first = forwarded?.split(',')[0]?.trim()
    if (first) return first
    const real = request.headers.get('x-real-ip')?.trim()
    if (real) return real
  }
  // Node's Request does not expose the socket by default; server-entry attaches
  // the peer address before dispatch. An unknown peer must remain non-local —
  // falling back to loopback would turn missing metadata into an auth bypass.
  const maybeAddress = (request as unknown as { remoteAddress?: string })
    .remoteAddress
  return (maybeAddress && maybeAddress.trim()) || 'unknown'
}

function isLocalRequest(request: Request): boolean {
  const ip = getRequestIp(request)
  const localIPs = ['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']
  if (localIPs.includes(ip)) return true
  // Allow Tailscale (100.x.x.x) and private LAN ranges
  if (/^100\.\d+\.\d+\.\d+$/.test(ip)) return true
  if (/^192\.168\./.test(ip)) return true
  if (/^10\./.test(ip)) return true
  return false
}

/**
 * Check if the request is authenticated.
 * Returns true if:
 * - Password protection is disabled, OR
 * - Request has a valid session token
 */
export function isAuthenticated(request: Request): boolean {
  // No password configured? No auth needed
  if (!isPasswordProtectionEnabled()) {
    return true
  }

  // Check for valid session token
  const cookieHeader = request.headers.get('cookie')
  const token = getSessionTokenFromCookie(cookieHeader)

  if (!token) {
    return false
  }

  return isValidSessionToken(token)
}

/**
 * Authorize trusted automation and interactive users.
 *
 * Loopback/private-network callers are used by the host's scheduled Hermes
 * jobs, which do not have a browser session cookie. Password protection must
 * still apply to public callers, so a non-local request needs a valid session.
 */
export function requireLocalOrAuth(request: Request): boolean {
  if (!isPasswordProtectionEnabled()) {
    return isLocalRequest(request)
  }
  return isLocalRequest(request) || isAuthenticated(request)
}

/**
 * Whether session cookies should set the `Secure` attribute.
 *
 * Defaults ON in production, OFF in development (so localhost-over-HTTP
 * login flows still work). Operators can override with
 * `COOKIE_SECURE=0` (force off) or `COOKIE_SECURE=1` (force on). See #123.
 */
function shouldSetSecureCookie(): boolean {
  const override = (process.env.COOKIE_SECURE || '').trim().toLowerCase()
  if (override === '1' || override === 'true' || override === 'yes') return true
  if (override === '0' || override === 'false' || override === 'no')
    return false
  return process.env.NODE_ENV === 'production'
}

/**
 * Create a Set-Cookie header for the session token.
 *
 * rememberMe=true  → Max-Age 1 year (persistent)
 * rememberMe=false → no Max-Age (session cookie, cleared on browser close)
 * rememberMe=undefined → 30-day legacy default
 */
export function createSessionCookie(
  token: string,
  rememberMe?: boolean,
): string {
  const attrs = ['HttpOnly']
  if (shouldSetSecureCookie()) attrs.push('Secure')
  attrs.push('SameSite=Strict', 'Path=/')
  if (rememberMe === true) {
    attrs.push(`Max-Age=${365 * 24 * 60 * 60}`)
  } else if (rememberMe !== false) {
    // legacy default: 30 days
    attrs.push(`Max-Age=${30 * 24 * 60 * 60}`)
  }
  // rememberMe=false → session cookie, no Max-Age
  return `claude-auth=${token}; ${attrs.join('; ')}`
}

/** Clear the workspace session cookie after an explicit logout. */
export function clearSessionCookie(): string {
  const attrs = ['HttpOnly']
  if (shouldSetSecureCookie()) attrs.push('Secure')
  attrs.push('SameSite=Strict', 'Path=/', 'Max-Age=0')
  return `claude-auth=; ${attrs.join('; ')}`
}
