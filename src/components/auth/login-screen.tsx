import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'

const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 5 * 60 * 1000

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  unauthorized_email: 'Access denied. This Google account is not authorised.',
  oauth_failed: 'Google authentication failed. Please try again.',
  oauth_state: 'Authentication session expired. Please try again.',
  oauth_invalid: 'Invalid OAuth response. Please try again.',
  oauth_disabled: 'Google login is not configured on this server.',
}

const CSS = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  .lp-root{
    --bg:#020c18;--card:#091929;--input:#050f1a;
    --border:#162d42;--border-f:#0ea5e9;
    --text:#e2e8f0;--sub:#94a3b8;--muted:#4d7a9e;
    --accent:#0ea5e9;
    --grad:linear-gradient(135deg,#0284c7 0%,#0ea5e9 50%,#38bdf8 100%);
    --err:#ef4444;--ok:#22c55e;
    --shadow:0 25px 50px -12px rgba(0,0,0,0.7);
    --glow:0 0 40px rgba(14,165,233,0.12);
    min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    background:var(--bg);color:var(--text);
    position:relative;overflow:hidden;padding:24px;
  }

  /* Animated grid */
  .lp-grid{
    position:fixed;inset:0;pointer-events:none;
    background-image:
      linear-gradient(rgba(14,165,233,0.04) 1px,transparent 1px),
      linear-gradient(90deg,rgba(14,165,233,0.04) 1px,transparent 1px);
    background-size:60px 60px;
    animation:lpGrid 20s linear infinite;
  }
  @keyframes lpGrid{0%{transform:translate(0,0)}100%{transform:translate(60px,60px)}}

  /* Orbs */
  .lp-orb{position:fixed;border-radius:50%;filter:blur(80px);opacity:0.45;animation:lpOrb 8s ease-in-out infinite;pointer-events:none}
  .lp-orb-1{width:400px;height:400px;background:radial-gradient(circle,rgba(2,132,199,0.28),transparent 70%);top:-100px;left:-100px}
  .lp-orb-2{width:300px;height:300px;background:radial-gradient(circle,rgba(14,165,233,0.18),transparent 70%);bottom:-50px;right:-50px;animation-delay:-4s}
  .lp-orb-3{width:200px;height:200px;background:radial-gradient(circle,rgba(56,189,248,0.12),transparent 70%);top:45%;left:55%;animation-delay:-2s}
  @keyframes lpOrb{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(28px,-18px) scale(1.05)}66%{transform:translate(-18px,14px) scale(0.95)}}

  /* Card */
  .lp-card{
    position:relative;z-index:10;width:100%;max-width:440px;
    background:var(--card);border:1px solid var(--border);border-radius:20px;
    padding:48px 40px;
    box-shadow:var(--shadow),var(--glow);
    backdrop-filter:blur(20px);
    animation:lpCardIn 0.6s ease-out;
  }
  @keyframes lpCardIn{from{opacity:0;transform:translateY(20px) scale(0.98)}to{opacity:1;transform:translateY(0) scale(1)}}

  /* Logo */
  .lp-logo{text-align:center;margin-bottom:36px}
  .lp-logo-icon{
    width:64px;height:64px;margin:0 auto 16px;background:var(--grad);
    border-radius:18px;display:flex;align-items:center;justify-content:center;
    box-shadow:0 8px 24px rgba(2,132,199,0.35);
    animation:lpLogoPulse 3s ease-in-out infinite;
  }
  .lp-logo-icon svg{width:32px;height:32px;fill:none;stroke:white;stroke-width:1.8}
  @keyframes lpLogoPulse{0%,100%{box-shadow:0 8px 24px rgba(2,132,199,0.35)}50%{box-shadow:0 8px 36px rgba(14,165,233,0.55)}}
  .lp-logo-title{
    font-size:24px;font-weight:700;letter-spacing:-0.5px;
    background:var(--grad);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
  }
  .lp-logo-sub{font-size:13px;color:var(--muted);margin-top:4px;font-weight:400;letter-spacing:0.5px;text-transform:uppercase}

  /* Messages */
  .lp-msg{
    padding:12px 16px;border-radius:10px;font-size:13px;margin-bottom:20px;
    display:flex;align-items:center;gap:10px;
    animation:lpMsgIn 0.3s ease-out;
  }
  @keyframes lpMsgIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
  .lp-msg svg{width:18px;height:18px;flex-shrink:0}
  .lp-msg-err{background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);color:var(--err)}
  .lp-msg-ok{background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2);color:var(--ok)}

  /* Shake on error */
  .lp-shake{animation:lpShake 0.5s ease-in-out}
  @keyframes lpShake{0%,100%{transform:translateX(0)}10%,30%,50%,70%,90%{transform:translateX(-5px)}20%,40%,60%,80%{transform:translateX(5px)}}

  /* Google button */
  .lp-google{
    width:100%;padding:13px 16px;
    background:#fff;border:1.5px solid #d1dae6;border-radius:12px;
    color:#1a1f36;font-size:15px;font-weight:500;font-family:inherit;
    cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;
    transition:all 0.2s ease;margin-bottom:4px;
  }
  .lp-google:hover{background:#f4f8fd;border-color:#b8c8d8;box-shadow:0 2px 10px rgba(0,0,0,0.15);transform:translateY(-1px)}
  .lp-google:active{transform:translateY(0)}
  .lp-google:disabled{opacity:0.55;cursor:not-allowed;transform:none}

  /* Dividers */
  .lp-divider{display:flex;align-items:center;gap:16px;margin:20px 0;color:var(--muted);font-size:12px}
  .lp-divider::before,.lp-divider::after{content:'';flex:1;height:1px;background:var(--border)}

  /* Form */
  .lp-label{display:block;font-size:13px;font-weight:500;color:var(--sub);margin-bottom:8px;letter-spacing:0.3px}
  .lp-input-wrap{position:relative;margin-bottom:4px}
  .lp-input-icon{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--muted);width:18px;height:18px;pointer-events:none}
  .lp-input{
    width:100%;padding:12px 44px 12px 44px;
    background:var(--input);border:1.5px solid var(--border);border-radius:12px;
    color:var(--text);font-size:15px;font-family:inherit;outline:none;
    transition:all 0.25s ease;
  }
  .lp-input::placeholder{color:var(--muted)}
  .lp-input:focus{border-color:var(--border-f);box-shadow:0 0 0 3px rgba(14,165,233,0.15)}
  .lp-input:disabled{opacity:0.5}
  .lp-pw-toggle{
    position:absolute;right:14px;top:50%;transform:translateY(-50%);
    background:none;border:none;color:var(--muted);cursor:pointer;
    padding:4px;display:flex;transition:color 0.2s;
  }
  .lp-pw-toggle:hover{color:var(--sub)}
  .lp-pw-toggle svg{width:18px;height:18px}
  .lp-attempts{font-size:12px;color:var(--muted);text-align:right;min-height:18px;margin-top:4px}

  /* Remember + submit */
  .lp-remember{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--sub);margin:16px 0 24px}
  .lp-remember input{width:16px;height:16px;accent-color:var(--accent);cursor:pointer}
  .lp-btn{
    width:100%;padding:14px;background:var(--grad);
    border:none;border-radius:12px;color:#fff;
    font-size:15px;font-weight:600;font-family:inherit;
    cursor:pointer;transition:all 0.25s;position:relative;overflow:hidden;letter-spacing:0.3px;
  }
  .lp-btn::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,0.1),transparent);opacity:0;transition:opacity 0.25s}
  .lp-btn:hover:not(:disabled)::before{opacity:1}
  .lp-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 8px 24px rgba(2,132,199,0.45)}
  .lp-btn:active:not(:disabled){transform:translateY(0)}
  .lp-btn:disabled{opacity:0.55;cursor:not-allowed}
  .lp-spinner{display:inline-block;width:20px;height:20px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:lpSpin 0.6s linear infinite;vertical-align:middle}
  @keyframes lpSpin{to{transform:rotate(360deg)}}

  /* Status bar */
  .lp-status-bar{display:flex;align-items:center;justify-content:center;gap:20px;padding-top:20px;margin-top:20px;border-top:1px solid var(--border)}
  .lp-status-item{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted)}
  .lp-dot{width:6px;height:6px;border-radius:50%}
  .lp-dot-online{background:var(--ok);animation:lpPulse 2s ease-in-out infinite}
  .lp-dot-offline{background:var(--err)}
  .lp-dot-checking{background:var(--muted);animation:lpPulse 1s ease-in-out infinite}
  @keyframes lpPulse{0%,100%{opacity:1}50%{opacity:0.4}}

  .lp-footer{text-align:center;margin-top:28px;font-size:12px;color:var(--muted)}

  @media(max-width:480px){.lp-card{padding:36px 24px}.lp-logo-title{font-size:20px}}
`

export function LoginScreen() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [attempts, setAttempts] = useState(0)
  const [lockedUntil, setLockedUntil] = useState(0)
  const [lockCountdown, setLockCountdown] = useState(0)
  const [shakeKey, setShakeKey] = useState(0)
  const [gatewayStatus, setGatewayStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [googleEnabled, setGoogleEnabled] = useState(false)

  // Read OAuth error from URL
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const oauthError = params.get('error')
    if (oauthError && OAUTH_ERROR_MESSAGES[oauthError]) {
      setError(OAUTH_ERROR_MESSAGES[oauthError])
      setShakeKey(1)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  // Lockout countdown
  useEffect(() => {
    if (lockedUntil <= 0) return
    const iv = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000))
      setLockCountdown(remaining)
      if (remaining <= 0) {
        clearInterval(iv)
        setAttempts(0)
        setError('')
        setLockedUntil(0)
      }
    }, 1000)
    return () => clearInterval(iv)
  }, [lockedUntil])

  // Gateway status + Google OAuth check
  useEffect(() => {
    fetch('/api/auth-check')
      .then((r) => setGatewayStatus(r.ok || r.status === 401 ? 'online' : 'offline'))
      .catch(() => setGatewayStatus('offline'))

    fetch('/api/auth/google?check=1')
      .then((r) => r.json())
      .then((data: unknown) => {
        setGoogleEnabled(
          typeof data === 'object' && data !== null && (data as { enabled?: boolean }).enabled === true
        )
      })
      .catch(() => setGoogleEnabled(false))
  }, [])

  const isLocked = lockedUntil > 0 && Date.now() < lockedUntil

  const triggerShake = () => setShakeKey((k) => k + 1)

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      if (isLocked || !password || loading) return

      setError('')
      setLoading(true)

      try {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password, rememberMe }),
        })

        const data = await res.json()

        if (data.ok) {
          setSuccess(true)
          setTimeout(() => window.location.reload(), 800)
        } else {
          const newAttempts = attempts + 1
          setAttempts(newAttempts)
          triggerShake()

          if (newAttempts >= MAX_ATTEMPTS) {
            const until = Date.now() + LOCKOUT_MS
            setLockedUntil(until)
            setLockCountdown(Math.ceil(LOCKOUT_MS / 1000))
            setError('Too many attempts. Locked for 5 minutes.')
          } else {
            const left = MAX_ATTEMPTS - newAttempts
            setError(
              left <= 2
                ? `Invalid password. ${left} attempt${left === 1 ? '' : 's'} left.`
                : 'Invalid password. Try again.',
            )
          }
          setLoading(false)
        }
      } catch {
        setError('Connection error. Please try again.')
        triggerShake()
        setLoading(false)
      }
    },
    [password, rememberMe, loading, isLocked, attempts],
  )

  const attemptsLeft = MAX_ATTEMPTS - attempts

  return (
    <div className="lp-root">
      <style>{CSS}</style>

      <div className="lp-grid" />
      <div className="lp-orb lp-orb-1" />
      <div className="lp-orb lp-orb-2" />
      <div className="lp-orb lp-orb-3" />

      <div key={shakeKey} className={`lp-card${shakeKey > 0 && error ? ' lp-shake' : ''}`}>

        {/* Logo */}
        <div className="lp-logo">
          <div className="lp-logo-icon">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div className="lp-logo-title">Hermes Workspace</div>
          <div className="lp-logo-sub">Agent Control Panel</div>
        </div>

        {/* Error message */}
        {error && !success && (
          <div className="lp-msg lp-msg-err">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Success message */}
        {success && (
          <div className="lp-msg lp-msg-ok">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            <span>Authentication successful. Redirecting...</span>
          </div>
        )}

        {/* Google button */}
        {googleEnabled && (
          <button
            type="button"
            className="lp-google"
            disabled={loading}
            onClick={() => { window.location.href = '/api/auth/google' }}
          >
            <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.7 2.4 30.2 0 24 0 14.7 0 6.7 5.4 2.9 13.3l7.8 6C12.5 13 17.8 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17z"/>
              <path fill="#FBBC05" d="M10.7 28.7A14.4 14.4 0 0 1 9.5 24c0-1.6.3-3.2.7-4.7l-7.8-6A23.9 23.9 0 0 0 0 24c0 3.9.9 7.5 2.9 10.7l7.8-6z"/>
              <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2 1.4-4.6 2.2-7.7 2.2-6.2 0-11.5-4.2-13.3-9.9l-7.8 6C6.7 42.6 14.7 48 24 48z"/>
            </svg>
            Sign in with Google
          </button>
        )}

        {googleEnabled && (
          <div className="lp-divider">or sign in with password</div>
        )}

        {/* Password form */}
        <form onSubmit={handleSubmit} autoComplete="off">
          <div style={{ marginBottom: 20 }}>
            <label className="lp-label" htmlFor="lp-pw">Access Password</label>
            <div className="lp-input-wrap">
              <svg className="lp-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <input
                id="lp-pw"
                type={showPassword ? 'text' : 'password'}
                className="lp-input"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading || isLocked}
                autoFocus
              />
              <button
                type="button"
                className="lp-pw-toggle"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                aria-label="Toggle password visibility"
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
            <div className="lp-attempts">
              {attemptsLeft < MAX_ATTEMPTS && !isLocked && (
                <span>{attemptsLeft} attempt{attemptsLeft === 1 ? '' : 's'} left</span>
              )}
            </div>
          </div>

          <label className="lp-remember">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            Keep me signed in
          </label>

          <button
            type="submit"
            className="lp-btn"
            disabled={loading || isLocked || !password}
          >
            {loading ? (
              <span className="lp-spinner" />
            ) : isLocked ? (
              `Locked (${Math.floor(lockCountdown / 60)}:${String(lockCountdown % 60).padStart(2, '0')})`
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        {/* Status bar */}
        <div className="lp-divider" style={{ marginTop: 24, marginBottom: 0 }}>System Status</div>
        <div className="lp-status-bar">
          <div className="lp-status-item">
            <span className="lp-dot lp-dot-online" />
            <span>Workspace</span>
          </div>
          <div className="lp-status-item">
            <span className={`lp-dot lp-dot-${gatewayStatus}`} />
            <span>Gateway</span>
          </div>
          <div className="lp-status-item">
            <span className="lp-dot lp-dot-online" />
            <span>Memory</span>
          </div>
        </div>

        <div className="lp-footer">
          Secured by Hermes Agent &middot; v2.3.0
        </div>
      </div>
    </div>
  )
}
