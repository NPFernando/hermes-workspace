import { useEffect, useState } from 'react'
import { Row, SETTINGS_CARD_CLASS, SectionHeader } from './settings-dialog-primitives'
import { cn } from '@/lib/utils'

export function AgentBehaviorContent() {
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/hermes-config')
      .then((r) => r.json())
      .then((d: any) => {
        setConfig(d.config?.agent ? (d.config.agent as Record<string, unknown>) : {})
      })
      .catch(() => {})
  }, [])

  const save = async (key: string, value: unknown) => {
    setMsg(null)
    try {
      await fetch('/api/hermes-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { agent: { [key]: value } } }),
      })
      setConfig((prev) => ({ ...prev, [key]: value }))
      setMsg('Saved')
      setTimeout(() => setMsg(null), 2000)
    } catch {
      setMsg('Failed')
    }
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Agent Behavior"
        description="Execution limits and tool access."
      />
      {msg && (
        <div
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs font-medium',
            msg === 'Saved'
              ? 'bg-green-500/15 text-green-400'
              : 'bg-red-500/15 text-red-400',
          )}
        >
          {msg}
        </div>
      )}
      <div className={SETTINGS_CARD_CLASS}>
        <Row
          label="Max turns"
          description="Maximum agent turns per request (1-100)"
        >
          <input
            type="number"
            min={1}
            max={100}
            value={Number(config.max_turns) || 50}
            onChange={(e) => save('max_turns', Number(e.target.value))}
            className="h-8 w-20 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-input)] px-2 text-sm text-center text-[var(--theme-text)] outline-none"
          />
        </Row>
        <Row label="Gateway timeout" description="Seconds before timeout">
          <input
            type="number"
            min={10}
            max={600}
            value={Number(config.gateway_timeout) || 120}
            onChange={(e) => save('gateway_timeout', Number(e.target.value))}
            className="h-8 w-20 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-input)] px-2 text-sm text-center text-[var(--theme-text)] outline-none"
          />
        </Row>
        <Row label="Tool enforcement" description="When agent must use tools">
          <select
            value={String(config.tool_use_enforcement || 'auto')}
            onChange={(e) => save('tool_use_enforcement', e.target.value)}
            className="h-8 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-input)] px-2 text-sm text-[var(--theme-text)] outline-none"
          >
            <option value="auto">Auto</option>
            <option value="required">Required</option>
            <option value="none">None</option>
          </select>
        </Row>
      </div>
    </div>
  )
}

