import { useEffect, useState } from 'react'
import { CloudIcon } from '@hugeicons/core-free-icons'
import { SettingsRow, SettingsSection } from './settings-primitives'
import { Switch } from '@/components/ui/switch'

export function MobileAppSection() {
  const [version, setVersion] = useState<{
    versionCode: number
    versionName: string
  } | null>(null)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [reminderEnabled, setReminderEnabled] = useState(true)

  useEffect(() => {
    fetch('/api/app-version')
      .then((r) => r.json() as Promise<{ versionCode: number; versionName: string }>)
      .then((v) => {
        setVersion(v)
        const stored = parseInt(localStorage.getItem('hermes-apk-downloaded-version') ?? '0', 10)
        setUpdateAvailable(stored > 0 && v.versionCode > stored)
      })
      .catch(() => {})
    setReminderEnabled(localStorage.getItem('claude-mobile-access-dismissed') !== 'true')
  }, [])

  const toggleReminder = (checked: boolean) => {
    setReminderEnabled(checked)
    if (checked) {
      localStorage.removeItem('claude-mobile-access-dismissed')
    } else {
      localStorage.setItem('claude-mobile-access-dismissed', 'true')
    }
  }

  return (
    <SettingsSection
      title="Android App"
      description="Native Hermes experience with home screen shortcuts for Chat, Operations, and Tasks."
      icon={CloudIcon}
    >
      {/* App card */}
      <div className="card-glow rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--theme-text)]">Hermes Workspace</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <p className="text-xs text-[var(--theme-muted)]">
                {version ? `APK v${version.versionName}` : 'Loading…'}
              </p>
              {version && (
                <a
                  href="/settings?section=whatsnew"
                  className="text-[10px] text-[var(--theme-accent)] underline-offset-2 hover:underline"
                >
                  release notes
                </a>
              )}
            </div>
          </div>
          {version && (
            updateAvailable ? (
              <span className="shrink-0 rounded-full bg-[var(--theme-accent)]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[var(--theme-accent)]">
                Update available
              </span>
            ) : (
              <span className="shrink-0 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-500">
                Up to date
              </span>
            )
          )}
        </div>
        <a
          href="/download-apk"
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-400 active:scale-[0.98]"
        >
          <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden>
            <path d="M12 16l-5-5 1.41-1.41L11 13.17V4h2v9.17l2.59-2.58L17 11zM5 20h14v-2H5z" />
          </svg>
          {updateAvailable ? 'Download Update' : 'Download APK'}
        </a>
      </div>

      {/* Install steps */}
      <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-3.5 text-xs text-[var(--theme-muted)]">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-muted)]">How to install</p>
        <ol className="list-inside list-decimal space-y-1.5">
          <li>Open <span className="font-medium text-[var(--theme-text)]">agent.fernandofamily.com/download-apk</span> on your phone</li>
          <li>Tap <span className="font-medium text-[var(--theme-text)]">Download APK</span> and open the file when it finishes</li>
          <li>Tap <span className="font-medium text-[var(--theme-text)]">Install</span> — allow unknown sources if prompted (one-time only)</li>
          <li>Updates install over the existing app and keep all your data</li>
        </ol>
      </div>

      {/* Preferences */}
      <SettingsRow
        label="Show install reminder"
        description="Display a banner when the app is not installed or a new version is available."
      >
        <Switch
          checked={reminderEnabled}
          onCheckedChange={toggleReminder}
          aria-label="Show install reminder"
        />
      </SettingsRow>
    </SettingsSection>
  )
}
