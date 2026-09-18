import { useCallback, useEffect, useState } from 'react'
import { Settings02Icon } from '@hugeicons/core-free-icons'
import { SettingsRow, SettingsSection } from './settings-primitives'

type AuthCheck = {
  authenticated: boolean
  authRequired: boolean
  expiresAt: number | null
}

type UserProfile = {
  email?: string
  name?: string
  picture?: string
}

function expiryLabel(expiresAt: number | null): string {
  if (!expiresAt) return 'Session expiry is managed by the deployment.'
  const remaining = expiresAt - Date.now()
  if (remaining <= 0) return 'Session expired; sign in again to continue.'
  const hours = Math.floor(remaining / (60 * 60 * 1000))
  if (hours < 48)
    return `Session expires in ${hours} hour${hours === 1 ? '' : 's'}.`
  return `Session expires ${new Date(expiresAt).toLocaleString()}.`
}

export function AccountSessionSection() {
  const [auth, setAuth] = useState<AuthCheck | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const authResponse = await fetch('/api/auth-check', { cache: 'no-store' })
      if (!authResponse.ok)
        throw new Error(`Auth status unavailable (${authResponse.status})`)
      const nextAuth = (await authResponse.json()) as AuthCheck
      setAuth(nextAuth)
      if (nextAuth.authenticated) {
        const profileResponse = await fetch('/api/user-profile', {
          cache: 'no-store',
        })
        if (profileResponse.ok)
          setProfile((await profileResponse.json()) as UserProfile)
      } else {
        setProfile(null)
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Auth status unavailable.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const disconnect = async () => {
    setDisconnecting(true)
    setError(null)
    try {
      const response = await fetch('/api/auth', { method: 'DELETE' })
      if (!response.ok)
        throw new Error(`Disconnect failed (${response.status})`)
      window.location.assign('/login')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Disconnect failed.')
      setDisconnecting(false)
    }
  }

  return (
    <SettingsSection
      title="Account and session"
      description="Review the current sign-in state and disconnect this browser session."
      icon={Settings02Icon}
    >
      {loading ? (
        <p className="text-sm text-[var(--theme-muted)]">
          Checking sign-in status…
        </p>
      ) : error ? (
        <p className="text-sm text-[var(--theme-danger)]" role="alert">
          {error}
        </p>
      ) : (
        <>
          <SettingsRow
            label="Sign-in status"
            description={
              auth?.authenticated
                ? 'This browser has an active workspace session.'
                : 'No active workspace session.'
            }
          >
            <span
              className={`rounded-full px-2 py-1 text-xs font-semibold ${auth?.authenticated ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}
            >
              {auth?.authenticated ? 'Signed in' : 'Signed out'}
            </span>
          </SettingsRow>
          {profile?.email && (
            <SettingsRow
              label="Account"
              description={profile.name || 'Google account'}
            >
              <span className="max-w-[18rem] truncate text-sm text-[var(--theme-text)]">
                {profile.email}
              </span>
            </SettingsRow>
          )}
          {auth?.authenticated && (
            <SettingsRow
              label="Session expiry"
              description={expiryLabel(auth.expiresAt)}
            >
              <button
                type="button"
                onClick={() => void disconnect()}
                disabled={disconnecting}
                className="rounded-lg border border-[var(--theme-danger)]/50 px-3 py-2 text-xs font-semibold text-[var(--theme-danger)] hover:bg-[var(--theme-danger)]/10 disabled:opacity-50"
              >
                {disconnecting ? 'Disconnecting…' : 'Sign out'}
              </button>
            </SettingsRow>
          )}
        </>
      )}
    </SettingsSection>
  )
}
