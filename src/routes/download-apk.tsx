import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'

export const Route = createFileRoute('/download-apk')({
  component: DownloadApkPage,
})

function DownloadApkPage() {
  usePageTitle('Download Hermes App')

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--theme-bg)] p-6 text-center">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-8 shadow-xl">
        <img
          src="/claude-avatar.webp"
          alt="Hermes"
          className="mx-auto mb-5 size-20 rounded-2xl"
        />
        <h1 className="mb-1 text-xl font-bold text-[var(--theme-text)]">
          Hermes Workspace
        </h1>
        <p className="mb-6 text-sm text-[var(--theme-muted)]">
          Android app · v1.0
        </p>

        <a
          href="/api/download-apk"
          download="hermes-workspace.apk"
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl bg-accent-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-400 active:scale-95"
        >
          <svg viewBox="0 0 24 24" className="size-5 fill-current" aria-hidden>
            <path d="M12 16l-5-5 1.41-1.41L11 13.17V4h2v9.17l2.59-2.58L17 11zM5 20h14v-2H5z" />
          </svg>
          Download APK
        </a>

        <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] p-3 text-left text-xs text-[var(--theme-muted)]">
          <p className="mb-1 font-medium text-[var(--theme-text)]">Install steps</p>
          <ol className="space-y-0.5 list-decimal list-inside">
            <li>Download the APK above</li>
            <li>Open the downloaded file</li>
            <li>Allow install from unknown sources if prompted</li>
            <li>Tap Install</li>
          </ol>
        </div>
      </div>
    </div>
  )
}
