import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import type { ChangeKind } from '@/lib/changelog'
import { usePageTitle } from '@/hooks/use-page-title'
import { markVersionDownloaded } from '@/components/mobile-prompt/MobilePromptTrigger'
import { CHANGELOG } from '@/lib/changelog'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/download-apk')({
  component: DownloadApkPage,
})

type AppVersion = { versionCode: number; versionName: string }
type Platform = 'android' | 'ios' | 'desktop' | 'unknown'
type LoadState = 'loading' | 'ready' | 'error'

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent || ''
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1
  if (/Android/i.test(ua)) return 'android'
  if (/iPhone|iPad|iPod/i.test(ua) || touchMac) return 'ios'
  return 'desktop'
}

const KIND_STYLE: Record<ChangeKind, { label: string; className: string }> = {
  added:    { label: 'New',     className: 'bg-emerald-500/10 text-emerald-500' },
  fixed:    { label: 'Fix',     className: 'bg-rose-500/10 text-rose-400' },
  improved: { label: 'Better',  className: 'bg-[var(--theme-accent)]/10 text-[var(--theme-accent)]' },
  removed:  { label: 'Removed', className: 'bg-[var(--theme-muted)]/10 text-[var(--theme-muted)]' },
}

function DownloadApkPage() {
  usePageTitle('Download Hermes App')

  const [version, setVersion] = useState<AppVersion | null>(null)
  const [isUpdate, setIsUpdate] = useState(false)
  const [platform, setPlatform] = useState<Platform>('unknown')
  const [loadState, setLoadState] = useState<LoadState>('loading')

  useEffect(() => {
    let cancelled = false
    setPlatform(detectPlatform())

    fetch('/api/app-version')
      .then((r) => {
        if (!r.ok) throw new Error(`Version lookup failed: ${r.status}`)
        return r.json() as Promise<AppVersion>
      })
      .then((v) => {
        if (cancelled) return
        setVersion(v)
        const stored = parseInt(
          localStorage.getItem('hermes-apk-downloaded-version') ?? '0',
          10,
        )
        setIsUpdate(stored > 0 && v.versionCode > stored)
        setLoadState('ready')
      })
      .catch(() => {
        if (!cancelled) setLoadState('error')
      })

    return () => {
      cancelled = true
    }
  }, [])

  const handleDownload = () => {
    if (version) markVersionDownloaded(version.versionCode)
  }

  // Find changelog entries for this APK version
  const apkChangelog = version
    ? CHANGELOG.filter((e) => e.apkVersion === version.versionName)
    : []
  const isAndroid = platform === 'android'
  const isIos = platform === 'ios'
  const platformLabel =
    platform === 'android' ? 'Android detected' :
    platform === 'ios' ? 'iPhone / iPad detected' :
    platform === 'desktop' ? 'Desktop browser detected' :
    'Device check running'

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[var(--theme-bg)] p-6">
      <div className="w-full max-w-sm space-y-3">
        {/* Main card */}
        <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-8 shadow-xl text-center">
          <img
            src="/claude-avatar.webp"
            alt="Hermes"
            className="mx-auto mb-5 size-20 rounded-2xl"
          />
          <h1 className="mb-1 text-xl font-bold text-[var(--theme-text)]">
            Hermes Workspace
          </h1>
          <p className="mb-2 text-sm text-[var(--theme-muted)]">
            Android app{version ? ` · v${version.versionName}` : ''}
          </p>
          <div className="mx-auto mb-4 inline-flex items-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-1 text-[11px] font-medium text-[var(--theme-muted)]">
            {loadState === 'loading' ? 'Checking latest build…' : platformLabel}
          </div>

          {loadState === 'error' && (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              Couldn&apos;t verify the latest APK version. You can still open the workspace or retry this page.
            </div>
          )}

          {isIos && (
            <div className="mb-4 rounded-lg border border-[var(--theme-accent)]/30 bg-[var(--theme-accent)]/10 px-3 py-2 text-left text-xs text-[var(--theme-muted)]">
              <p className="mb-1 font-medium text-[var(--theme-text)]">Best option on iOS</p>
              Use the web app, then Share → Add to Home Screen for an app-like launch icon.
            </div>
          )}

          {isUpdate && (
            <div className="mb-4 rounded-lg border border-[var(--theme-accent)]/30 bg-[var(--theme-accent)]/10 px-3 py-2 text-xs text-[var(--theme-accent)]">
              Update available — this will replace your existing app.
            </div>
          )}

          <div className="mb-4 grid gap-2">
            {isIos ? (
              <a
                href="/chat/new?source=download-page-ios"
                className="flex w-full items-center justify-center rounded-xl bg-accent-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-400 active:scale-95"
              >
                Continue in Web App
              </a>
            ) : (
              <a
                href="/api/download-apk"
                download="hermes-workspace.apk"
                onClick={handleDownload}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-400 active:scale-95"
              >
                <svg viewBox="0 0 24 24" className="size-5 fill-current" aria-hidden>
                  <path d="M12 16l-5-5 1.41-1.41L11 13.17V4h2v9.17l2.59-2.58L17 11zM5 20h14v-2H5z" />
                </svg>
                {isUpdate ? 'Download Update' : isAndroid ? 'Download APK' : 'Download Android APK'}
              </a>
            )}
            {!isAndroid && (
              <a
                href={isIos ? '/api/download-apk' : '/chat/new?source=download-page'}
                download={isIos ? 'hermes-workspace.apk' : undefined}
                onClick={isIos ? handleDownload : undefined}
                className="flex w-full items-center justify-center rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-5 py-3 text-sm font-semibold text-[var(--theme-text)] transition-colors hover:bg-[var(--theme-hover)]"
              >
                {isIos ? 'Download Android APK anyway' : 'Continue in Web App'}
              </a>
            )}
          </div>

          <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-3 text-left text-xs text-[var(--theme-muted)]">
            <p className="mb-1 font-medium text-[var(--theme-text)]">
              {isIos ? 'iOS / iPadOS steps' : isUpdate ? 'Update steps' : 'Install steps'}
            </p>
            <ol className="list-inside list-decimal space-y-0.5">
              {isIos ? (
                <>
                  <li>Open the web app button above</li>
                  <li>Tap Safari Share</li>
                  <li>Choose Add to Home Screen</li>
                  <li>Use the APK only for an Android device</li>
                </>
              ) : isUpdate ? (
                <>
                  <li>Download the update above</li>
                  <li>Open the downloaded file</li>
                  <li>Tap Install — it replaces your existing app</li>
                </>
              ) : (
                <>
                  <li>Download the APK above</li>
                  <li>Open the downloaded file</li>
                  <li>Allow install from unknown sources if prompted</li>
                  <li>Tap Install</li>
                </>
              )}
            </ol>
          </div>
        </div>

        {/* Changelog card for this APK version */}
        {apkChangelog.length > 0 && (
          <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5 shadow-xl">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--theme-muted)]">
              What's new in v{version?.versionName}
            </p>
            <div className="space-y-2">
              {apkChangelog.flatMap((entry) =>
                entry.changes.map((c, i) => {
                  const style = KIND_STYLE[c.kind]
                  return (
                    <div key={`${entry.version}-${i}`} className="flex items-start gap-2.5">
                      <span
                        className={cn(
                          'mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none',
                          style.className,
                        )}
                      >
                        {style.label}
                      </span>
                      <span className="text-xs leading-snug text-[var(--theme-muted)]">{c.text}</span>
                    </div>
                  )
                }),
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
