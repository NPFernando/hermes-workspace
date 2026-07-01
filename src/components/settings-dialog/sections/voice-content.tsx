import { useEffect, useState } from 'react'
import { Row, SETTINGS_CARD_CLASS, SectionHeader } from './settings-dialog-primitives'
import { GROQ_STT_MODELS, STT_PROVIDER_OPTIONS } from '@/lib/stt-config'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function VoiceContent() {
  const [tts, setTts] = useState<Record<string, unknown>>({})
  const [stt, setStt] = useState<Record<string, unknown>>({})
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/hermes-config')
      .then((r) => r.json())
      .then((d: any) => {
        setTts(d.config?.tts ? (d.config.tts as Record<string, unknown>) : {})
        setStt(d.config?.stt ? (d.config.stt as Record<string, unknown>) : {})
      })
      .catch(() => {})
  }, [])

  const saveTts = async (key: string, value: unknown) => {
    setMsg(null)
    try {
      await fetch('/api/hermes-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { tts: { [key]: value } } }),
      })
      setTts((prev) => ({ ...prev, [key]: value }))
      setMsg('Saved')
      setTimeout(() => setMsg(null), 2000)
    } catch {
      setMsg('Failed')
    }
  }

  const saveStt = async (key: string, value: unknown) => {
    setMsg(null)
    try {
      await fetch('/api/hermes-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { stt: { [key]: value } } }),
      })
      setStt((prev) => ({ ...prev, [key]: value }))
      setMsg('Saved')
      setTimeout(() => setMsg(null), 2000)
    } catch {
      setMsg('Failed')
    }
  }

  const ttsProvider = String(tts.provider || 'edge')
  const sttProvider = String(stt.provider || 'local')
  const sttGroq =
    (stt.groq as Record<string, unknown> | undefined) || {}

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Voice"
        description="Text-to-speech and speech-to-text."
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
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--theme-muted)]">
          Text-to-Speech
        </p>
        <Row label="TTS Provider">
          <select
            value={ttsProvider}
            onChange={(e) => saveTts('provider', e.target.value)}
            className="h-8 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-input)] px-2 text-sm text-[var(--theme-text)] outline-none"
          >
            <option value="edge">Edge TTS</option>
            <option value="elevenlabs">ElevenLabs</option>
            <option value="openai">OpenAI TTS</option>
            <option value="neutts">NeuTTS</option>
          </select>
        </Row>
        {ttsProvider === 'openai' && (
          <Row label="Voice">
            <select
              value={String(
                tts.openai
                  ? (tts.openai as Record<string, unknown>).voice || 'nova'
                  : 'nova',
              )}
              onChange={(e) =>
                saveTts('openai', {
                  ...(tts.openai ? (tts.openai as Record<string, unknown>) : {}),
                  voice: e.target.value,
                })
              }
              className="h-8 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-input)] px-2 text-sm text-[var(--theme-text)] outline-none"
            >
              {['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].map(
                (v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ),
              )}
            </select>
          </Row>
        )}
      </div>
      <div className={SETTINGS_CARD_CLASS}>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--theme-muted)]">
          Speech-to-Text
        </p>
        <Row label="Enable STT">
          <Switch
            checked={stt.enabled !== false}
            onCheckedChange={(c) => saveStt('enabled', c)}
          />
        </Row>
        <Row label="STT Provider">
          <select
            value={sttProvider}
            onChange={(e) => saveStt('provider', e.target.value)}
            className="h-8 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-input)] px-2 text-sm text-[var(--theme-text)] outline-none"
          >
            {STT_PROVIDER_OPTIONS.map((provider) => (
              <option key={provider.value} value={provider.value}>
                {provider.label}
              </option>
            ))}
          </select>
        </Row>
        {sttProvider === 'groq' && (
          <>
            <Row label="Groq model">
              <select
                value={String(sttGroq.model || GROQ_STT_MODELS[0])}
                onChange={(e) =>
                  saveStt('groq', {
                    ...sttGroq,
                    model: e.target.value,
                  })
                }
                className="h-8 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-input)] px-2 text-sm text-[var(--theme-text)] outline-none"
              >
                {GROQ_STT_MODELS.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Language" description="Optional BCP-47 code, e.g. en or en-US.">
              <Input
                value={String(stt.language || '')}
                onChange={(e) => saveStt('language', e.target.value)}
                placeholder="auto"
                className="h-8 w-40"
              />
            </Row>
          </>
        )}
      </div>
    </div>
  )
}

