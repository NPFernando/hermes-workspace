import { useCallback, useEffect, useRef, useState } from 'react'
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
    --theme-bg:#282c34;--theme-card:#1e2228;--theme-panel:#111111;--theme-card2:#23272f;
    --theme-text:#9cdef2;--theme-muted:rgba(156,222,242,0.65);--theme-border:rgba(53,90,102,0.5);
    --theme-accent:#f08090;--theme-accent-secondary:#f59aaa;
    --bg:var(--theme-bg,#282c34);--card:color-mix(in srgb,var(--theme-card,#1e2228) 88%,transparent);
    --card-strong:var(--theme-card,#1e2228);--panel:color-mix(in srgb,var(--theme-panel,#111) 88%,transparent);
    --input:color-mix(in srgb,var(--theme-input,var(--theme-card,#1e2228)) 90%,#000 10%);
    --border:var(--theme-border,rgba(156,222,242,.14));--border-f:var(--theme-accent,#e06c75);
    --text:var(--theme-text,#9cdef2);--sub:var(--theme-muted,rgba(156,222,242,.68));--muted:var(--theme-muted,rgba(156,222,242,.56));
    --accent:var(--theme-accent,#e06c75);--accent2:var(--theme-accent-secondary,#f0989e);
    --cyan:var(--theme-text,#9cdef2);--deep:var(--theme-panel,#111111);--slate:var(--theme-bg,#282c34);
    --grad:linear-gradient(135deg,var(--accent) 0%,var(--accent2) 46%,var(--cyan) 120%);
    --err:var(--theme-danger,#ef4444);--ok:var(--theme-success,#22c55e);
    min-height:100dvh;display:flex;align-items:center;justify-content:center;
    font-family:'Inter Variable',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    background:var(--bg);color:var(--text);position:relative;overflow:hidden;padding:24px;
  }
  .lp-root::before{content:'';position:fixed;inset:0;pointer-events:none;background:radial-gradient(1100px 520px at 82% -10%,color-mix(in srgb,var(--accent) 18%,transparent),transparent 60%),radial-gradient(900px 520px at 0% 0%,color-mix(in srgb,var(--theme-border,rgba(53,90,102,.5)) 60%,transparent),transparent 55%),linear-gradient(180deg,color-mix(in srgb,var(--theme-panel,#111) 8%,transparent),color-mix(in srgb,var(--theme-panel,#111) 28%,transparent));z-index:0}
  .lp-grid{position:fixed;inset:-80px;pointer-events:none;z-index:1;background-image:radial-gradient(circle,color-mix(in srgb,var(--theme-text,#9cdef2) 8%,transparent) 1px,transparent 1.4px);background-size:24px 24px;mask-image:radial-gradient(circle at 50% 45%,#000 0 58%,transparent 82%);animation:lpGridDrift 42s linear infinite}
  .lp-flow{position:fixed;inset:0;pointer-events:none;z-index:2;overflow:hidden;opacity:.7}
  .lp-flow span{position:absolute;height:1px;width:38vw;min-width:260px;background:linear-gradient(90deg,transparent,var(--accent),color-mix(in srgb,var(--theme-text,#9cdef2) 55%,transparent),transparent);filter:drop-shadow(0 0 12px color-mix(in srgb,var(--accent) 50%,transparent));animation:lpFlow 9s linear infinite}
  .lp-flow span:nth-child(1){top:18%;left:-42%;animation-delay:-1s}.lp-flow span:nth-child(2){top:35%;right:-42%;animation-delay:-4s;animation-direction:reverse}.lp-flow span:nth-child(3){bottom:22%;left:-42%;animation-delay:-7s}.lp-flow span:nth-child(4){bottom:38%;right:-42%;animation-delay:-2.5s;animation-direction:reverse}
  .lp-orb{position:fixed;border-radius:50%;filter:blur(64px);opacity:.48;animation:lpOrb 14s ease-in-out infinite alternate;pointer-events:none;z-index:1;will-change:transform}
  .lp-orb-1{width:420px;height:420px;background:radial-gradient(circle,color-mix(in srgb,var(--accent) 30%,transparent),transparent 70%);top:-120px;left:-120px}.lp-orb-2{width:340px;height:340px;background:radial-gradient(circle,color-mix(in srgb,var(--theme-border,rgba(53,90,102,.5)) 80%,transparent),transparent 70%);bottom:-80px;right:-80px;animation-delay:-5s}.lp-orb-3{width:240px;height:240px;background:radial-gradient(circle,color-mix(in srgb,var(--theme-text,#9cdef2) 18%,transparent),transparent 70%);top:42%;left:56%;animation-delay:-9s}
  .lp-card{position:relative;z-index:10;width:100%;max-width:440px;background:linear-gradient(180deg,color-mix(in srgb,var(--card-strong) 92%,transparent),color-mix(in srgb,var(--panel) 96%,transparent));border:1px solid color-mix(in srgb,var(--border) 80%,var(--accent) 20%);border-radius:22px;padding:44px 38px;box-shadow:0 28px 70px rgba(0,0,0,.52),0 0 0 1px rgba(255,255,255,.025),0 0 46px color-mix(in srgb,var(--accent) 12%,transparent);backdrop-filter:blur(22px) saturate(130%);-webkit-backdrop-filter:blur(22px) saturate(130%);animation:lpCardIn .62s cubic-bezier(.2,.8,.2,1) both;overflow:hidden}
  .lp-card::before{content:'';position:absolute;inset:0;border-radius:inherit;padding:1px;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 50%,transparent),rgba(156,222,242,.22),transparent 58%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}.lp-card::after{content:'';position:absolute;inset:-1px;background:linear-gradient(110deg,transparent 0 34%,rgba(255,255,255,.08) 45%,transparent 56%);transform:translateX(-120%);animation:lpCardSheen 7s ease-in-out infinite;pointer-events:none}
  .lp-logo{text-align:center;margin-bottom:32px;position:relative}.lp-logo-icon{width:68px;height:68px;margin:0 auto 16px;background:linear-gradient(135deg,#111,var(--slate));border:1px solid color-mix(in srgb,var(--accent) 44%,var(--border));border-radius:18px;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 32px color-mix(in srgb,var(--accent) 26%,transparent),inset 0 0 24px rgba(156,222,242,.06);animation:lpLogoPulse 3.4s ease-in-out infinite}.lp-logo-icon svg{width:33px;height:33px;fill:none;stroke:var(--cyan);stroke-width:1.8;filter:drop-shadow(0 0 8px rgba(156,222,242,.5))}.lp-logo-title{font-size:25px;font-weight:760;letter-spacing:-.03em;background:var(--grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}.lp-logo-sub{font-family:'JetBrains Mono Variable',ui-monospace,monospace;font-size:11px;color:var(--muted);margin-top:6px;font-weight:500;letter-spacing:.16em;text-transform:uppercase}
  .lp-msg{padding:12px 14px;border-radius:12px;font-size:13px;margin-bottom:18px;display:flex;align-items:center;gap:10px;animation:lpMsgIn .25s ease-out;border:1px solid}.lp-msg svg{width:18px;height:18px;flex-shrink:0}.lp-msg-err{color:var(--err);background:color-mix(in srgb,var(--err) 10%,transparent);border-color:color-mix(in srgb,var(--err) 28%,transparent)}.lp-msg-ok{color:var(--ok);background:color-mix(in srgb,var(--ok) 10%,transparent);border-color:color-mix(in srgb,var(--ok) 28%,transparent)}
  .lp-google,.lp-btn,.lp-input{border-radius:12px}.lp-google{width:100%;padding:13px 16px;background:color-mix(in srgb,var(--theme-card) 94%,transparent);border:1px solid var(--border);color:var(--text);font-size:15px;font-weight:600;font-family:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease,background .18s ease;margin-bottom:4px}.lp-google:hover{background:var(--theme-card2);border-color:color-mix(in srgb,var(--accent) 70%,var(--border));box-shadow:0 8px 28px color-mix(in srgb,var(--accent) 16%,transparent);transform:translateY(-1px)}.lp-google:active{transform:translateY(0)}.lp-google:disabled{opacity:.55;cursor:not-allowed;transform:none}
  .lp-divider{display:flex;align-items:center;gap:12px;margin:18px 0;color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.lp-divider::before,.lp-divider::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,transparent,var(--border),transparent)}
  .lp-label{display:block;font-family:'JetBrains Mono Variable',ui-monospace,monospace;font-size:11px;font-weight:650;color:var(--sub);margin-bottom:8px;letter-spacing:.12em;text-transform:uppercase}.lp-input-wrap{position:relative;margin-bottom:4px}.lp-input-icon{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--muted);width:18px;height:18px;pointer-events:none}.lp-input{width:100%;padding:13px 44px;background:var(--input);border:1px solid var(--border);color:var(--text);font-size:15px;font-family:inherit;outline:none;transition:border-color .2s ease,box-shadow .2s ease,background .2s ease}.lp-input::placeholder{color:color-mix(in srgb,var(--muted) 80%,transparent)}.lp-input:focus{border-color:color-mix(in srgb,var(--accent) 70%,var(--border));box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 16%,transparent),0 0 26px color-mix(in srgb,var(--accent) 10%,transparent)}.lp-input:disabled{opacity:.5}.lp-pw-toggle{position:absolute;right:14px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--muted);cursor:pointer;padding:4px;display:flex;transition:color .2s}.lp-pw-toggle:hover{color:var(--text)}.lp-pw-toggle svg{width:18px;height:18px}.lp-attempts{font-size:12px;color:var(--muted);text-align:right;min-height:18px;margin-top:4px}
  .lp-remember{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--sub);margin:16px 0 24px}.lp-remember input{width:16px;height:16px;accent-color:var(--accent);cursor:pointer}.lp-btn{width:100%;padding:14px;background:var(--grad);border:none;color:#fff;font-size:15px;font-weight:700;font-family:inherit;cursor:pointer;transition:transform .2s ease,box-shadow .2s ease,filter .2s ease;position:relative;overflow:hidden;letter-spacing:.04em}.lp-btn::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,.18),transparent);opacity:0;transition:opacity .25s}.lp-btn:hover:not(:disabled)::before{opacity:1}.lp-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 12px 30px color-mix(in srgb,var(--accent) 38%,transparent);filter:saturate(1.08)}.lp-btn:active:not(:disabled){transform:translateY(0)}.lp-btn:disabled{opacity:.55;cursor:not-allowed}.lp-spinner{display:inline-block;width:20px;height:20px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:lpSpin .6s linear infinite;vertical-align:middle}
  .lp-status-bar{display:flex;align-items:center;justify-content:center;gap:18px;padding-top:18px;margin-top:18px;border-top:1px solid var(--border);flex-wrap:wrap}.lp-status-item{display:flex;align-items:center;gap:6px;font-family:'JetBrains Mono Variable',ui-monospace,monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.lp-dot{width:6px;height:6px;border-radius:50%}.lp-dot-online{background:var(--ok);box-shadow:0 0 10px var(--ok);animation:lpPulse 2s ease-in-out infinite}.lp-dot-offline{background:var(--err);box-shadow:0 0 10px var(--err)}.lp-dot-checking{background:var(--muted);animation:lpPulse 1s ease-in-out infinite}.lp-footer{text-align:center;margin-top:24px;font-family:'JetBrains Mono Variable',ui-monospace,monospace;font-size:11px;letter-spacing:.04em;color:var(--muted)}
  .lp-shake{animation:lpShake .36s ease-in-out both}
  @keyframes lpGridDrift{to{transform:translate3d(24px,24px,0)}}@keyframes lpFlow{0%{transform:translateX(0);opacity:0}12%,72%{opacity:1}100%{transform:translateX(150vw);opacity:0}}@keyframes lpOrb{0%,100%{transform:translate3d(0,0,0) scale(1)}50%{transform:translate3d(34px,-22px,0) scale(1.06)}}@keyframes lpCardIn{from{opacity:0;transform:translateY(20px) scale(.975)}to{opacity:1;transform:none}}@keyframes lpCardSheen{0%,58%{transform:translateX(-120%)}72%,100%{transform:translateX(120%)}}@keyframes lpLogoPulse{0%,100%{transform:translateY(0);box-shadow:0 10px 32px color-mix(in srgb,var(--accent) 24%,transparent)}50%{transform:translateY(-2px);box-shadow:0 14px 44px color-mix(in srgb,var(--accent) 42%,transparent)}}@keyframes lpMsgIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}@keyframes lpSpin{to{transform:rotate(360deg)}}@keyframes lpPulse{0%,100%{opacity:1}50%{opacity:.45}}@keyframes lpShake{10%,90%{transform:translateX(-1px)}20%,80%{transform:translateX(2px)}30%,50%,70%{transform:translateX(-4px)}40%,60%{transform:translateX(4px)}}
  @media(max-width:560px){.lp-root{padding:16px;align-items:stretch}.lp-card{max-width:none;margin:auto;padding:34px 22px;border-radius:18px}.lp-logo-title{font-size:21px}.lp-flow span{width:72vw}.lp-status-bar{gap:12px}.lp-orb{filter:blur(54px);opacity:.36}}
  @media(prefers-reduced-motion:reduce){.lp-grid,.lp-flow span,.lp-orb,.lp-card,.lp-card::after,.lp-logo-icon,.lp-dot-online,.lp-dot-checking{animation:none!important}.lp-card{transform:none!important}}
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

  // Where to return the user after a successful login. Captured before the
  // effect below overwrites the address bar with the cosmetic '/login' URL,
  // since that path has no real route and would 404 on reload.
  const returnPathRef = useRef<string>('/')

  // Set clean /login URL in the address bar
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location.pathname !== '/login') {
      returnPathRef.current = window.location.pathname + window.location.search
      window.history.replaceState({}, '', '/login')
    }
  }, [])

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
          setTimeout(() => {
            window.location.href = returnPathRef.current || '/'
          }, 800)
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
      <div className="lp-flow" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
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
