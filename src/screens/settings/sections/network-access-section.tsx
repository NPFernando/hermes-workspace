import { Link01Icon } from '@hugeicons/core-free-icons'
import { SettingsSection } from './settings-primitives'


export function NetworkAccessSection() {
  return (
    <SettingsSection
      title="Network Access"
      description="Connect to Hermes Workspace from your phone or other devices."
      icon={Link01Icon}
    >
      {/* Tailscale */}
      <div className="card-glow rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--theme-text)]">Tailscale</p>
            <p className="mt-0.5 text-xs text-[var(--theme-muted)]">
              Secure private network — works anywhere, no port forwarding needed.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-[var(--theme-accent)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--theme-accent)]">
            Recommended
          </span>
        </div>
        <ol className="list-inside list-decimal space-y-1 text-xs text-[var(--theme-muted)]">
          <li>Install Tailscale on this server and sign in</li>
          <li>Install Tailscale on your phone with the same account</li>
          <li>Open the server&apos;s Tailscale IP in your phone browser</li>
        </ol>
        <a
          href="https://tailscale.com/download"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-hover)] px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] transition-colors hover:bg-[var(--theme-border)]"
        >
          tailscale.com/download
          <svg viewBox="0 0 24 24" className="size-3 fill-none stroke-current" strokeWidth={2.5} aria-hidden>
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </div>

      {/* Local network */}
      <div className="card-glow rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4 space-y-2">
        <p className="text-sm font-semibold text-[var(--theme-text)]">Local network</p>
        <p className="text-xs text-[var(--theme-muted)]">
          Any device on the same Wi-Fi — no setup needed.
        </p>
        <p className="text-xs text-[var(--theme-muted)]">
          Run{' '}
          <code className="rounded bg-[var(--theme-hover)] px-1 py-0.5 font-mono">ip addr</code>
          {' '}on the server to find the LAN IP, then open{' '}
          <code className="rounded bg-[var(--theme-hover)] px-1 py-0.5 font-mono">http://&lt;LAN-IP&gt;:3000</code>
          {' '}on your phone.
        </p>
      </div>

      {/* Gateway tip */}
      <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-hover)] p-3 text-xs text-[var(--theme-muted)]">
        <span className="font-semibold text-[var(--theme-text)]">Gateway tip — </span>
        set the connection URL in{' '}
        <span className="font-medium text-[var(--theme-text)]">Settings → Connection</span>
        {' '}to the Tailscale IP (e.g.{' '}
        <code className="rounded bg-[var(--theme-panel)] px-1 font-mono">http://100.x.y.z:8642</code>
        ). Also add{' '}
        <code className="rounded bg-[var(--theme-panel)] px-1 font-mono">API_SERVER_HOST=0.0.0.0</code>
        {' '}to the agent <code className="rounded bg-[var(--theme-panel)] px-1 font-mono">.env</code>.
      </div>
    </SettingsSection>
  )
}
