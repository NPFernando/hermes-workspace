import { useEffect, useState } from 'react'
import { Row, SETTINGS_CARD_CLASS, SectionHeader } from './settings-dialog-primitives'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

export function DisplayContent() {
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/hermes-config')
      .then((r) => r.json())
      .then((d: any) => {
        setConfig(d.config?.display ? (d.config.display as Record<string, unknown>) : {})
      })
      .catch(() => {})
  }, [])

  const save = async (key: string, value: unknown) => {
    setMsg(null)
    try {
      await fetch('/api/hermes-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { display: { [key]: value } } }),
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
        title="Display"
        description="Agent response style and output preferences."
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
        <Row label="Personality" description="Agent response style">
          <select
            value={String(config.personality || 'default')}
            onChange={(e) => save('personality', e.target.value)}
            className="h-8 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-input)] px-2 text-sm text-[var(--theme-text)] outline-none"
          >
            <option value="default">Default</option>
            <option value="concise">Concise</option>
            <option value="verbose">Verbose</option>
            <option value="creative">Creative</option>
          </select>
        </Row>
        <Row label="Streaming" description="Stream responses in real-time">
          <Switch
            checked={config.streaming !== false}
            onCheckedChange={(c) => save('streaming', c)}
          />
        </Row>
        <Row
          label="Show reasoning"
          description="Display model thinking process"
        >
          <Switch
            checked={config.show_reasoning !== false}
            onCheckedChange={(c) => save('show_reasoning', c)}
          />
        </Row>
        <Row label="Show cost" description="Display token cost per response">
          <Switch
            checked={config.show_cost === true}
            onCheckedChange={(c) => save('show_cost', c)}
          />
        </Row>
        <Row label="Compact mode" description="Reduce spacing in responses">
          <Switch
            checked={config.compact === true}
            onCheckedChange={(c) => save('compact', c)}
          />
        </Row>
      </div>
    </div>
  )
}
