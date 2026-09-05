import { Link01Icon } from '@hugeicons/core-free-icons'
import { useCallback, useEffect, useState } from 'react'
import { SettingsRow, SettingsSection } from './settings-primitives'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type ConnectionSettings = {
  gateway: string
  dashboard: string
  source: 'override' | 'env' | 'default'
}

export function ConnectionSection() {
  const [current, setCurrent] = useState<ConnectionSettings | null>(null)
  const [gatewayInput, setGatewayInput] = useState('')
  const [dashboardInput, setDashboardInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/connection-settings')
      if (!res.ok) return
      const data = (await res.json()) as ConnectionSettings
      setCurrent(data)
      setGatewayInput(data.gateway)
      setDashboardInput(data.dashboard)
    } catch {
      // non-fatal
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = async () => {
    setSaving(true)
    setMessage(null)
    setIsError(false)
    try {
      const res = await fetch('/api/connection-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gateway: gatewayInput.trim(),
          dashboard: dashboardInput.trim(),
        }),
      })
      const data = (await res.json()) as ConnectionSettings & { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setCurrent(data)
      setMessage('Saved. Connection updated — no restart needed.')
    } catch (err) {
      setIsError(true)
      setMessage(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
      setTimeout(() => setMessage(null), 6000)
    }
  }

  const reset = async () => {
    setGatewayInput('')
    setDashboardInput('')
    setSaving(true)
    try {
      const res = await fetch('/api/connection-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gateway: '', dashboard: '' }),
      })
      const data = (await res.json()) as ConnectionSettings
      setCurrent(data)
      setGatewayInput(data.gateway)
      setDashboardInput(data.dashboard)
      setMessage('Reset to env / default URLs.')
    } catch {
      setIsError(true)
      setMessage('Reset failed')
    } finally {
      setSaving(false)
      setTimeout(() => setMessage(null), 6000)
    }
  }

  const inputClass =
    'h-9 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 text-sm text-[var(--theme-text)] font-mono outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]'

  const sourceLabel: Record<ConnectionSettings['source'], string> = {
    override: 'Runtime override (saved in workspace-overrides.json)',
    env: 'From HERMES_API_URL / HERMES_DASHBOARD_URL env vars',
    default: 'Defaults — no override set',
  }

  return (
    <SettingsSection
      title="Connection"
      description="Point the workspace at your Hermes Agent services. Useful for Tailscale, LAN, or remote-server setups (#101)."
      icon={Link01Icon}
    >
      <div className="text-xs text-[var(--theme-muted)]">
        {current ? sourceLabel[current.source] : 'Loading…'}
      </div>

      <SettingsRow
        label="Gateway URL"
        description="Core chat + completions + health. Default http://127.0.0.1:8645."
      >
        <input
          className={inputClass}
          value={gatewayInput}
          onChange={(e) => setGatewayInput(e.target.value)}
          placeholder="http://100.x.y.z:8642"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
      </SettingsRow>

      <SettingsRow
        label="Dashboard URL"
        description="Extended APIs — sessions, skills, config, jobs. Default http://127.0.0.1:9119."
      >
        <input
          className={inputClass}
          value={dashboardInput}
          onChange={(e) => setDashboardInput(e.target.value)}
          placeholder="http://100.x.y.z:9119"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
      </SettingsRow>

      <div className="flex items-center gap-2 pt-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save & reprobe'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={reset}
          disabled={saving || current?.source === 'default'}
        >
          Reset to defaults
        </Button>
        {message ? (
          <span
            className={cn(
              'text-xs',
              isError ? 'text-red-500' : 'text-emerald-600',
            )}
          >
            {message}
          </span>
        ) : null}
      </div>

      <div className="mt-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-hover)] p-3 text-xs text-[var(--theme-muted)]">
        <strong className="font-semibold">Tailscale / remote tip:</strong> Set
        the gateway to its Tailscale IP (e.g. <code>http://100.x.y.z:8642</code>
        ) and ensure the gateway listens on <code>0.0.0.0</code> (set{' '}
        <code>API_SERVER_HOST=0.0.0.0</code> in the agent-side <code>.env</code>
        ). No workspace restart needed — capabilities reprobe on save.
      </div>
    </SettingsSection>
  )
}
