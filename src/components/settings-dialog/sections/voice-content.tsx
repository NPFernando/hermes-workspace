import {
  Row,
  SETTINGS_CARD_CLASS,
  SETTINGS_SELECT_CLASS,
  SavedMessageBanner,
  SectionHeader,
} from './settings-dialog-primitives'
import { GROQ_STT_MODELS, STT_PROVIDER_OPTIONS } from '@/lib/stt-config'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import {
  useHermesConfigSection,
  useSavedMessage,
} from '@/hooks/use-hermes-config-section'

export function VoiceContent() {
  const { config: tts, save: rawSaveTts } = useHermesConfigSection('tts')
  const { config: stt, save: rawSaveStt } = useHermesConfigSection('stt')
  const { msg, runWithSavedMessage } = useSavedMessage()

  const saveTts = (key: string, value: unknown) =>
    runWithSavedMessage(() => rawSaveTts(key, value))
  const saveStt = (key: string, value: unknown) =>
    runWithSavedMessage(() => rawSaveStt(key, value))

  const ttsProvider = String(tts.provider || 'edge')
  const sttProvider = String(stt.provider || 'local')
  const sttGroq = (stt.groq as Record<string, unknown> | undefined) || {}

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Voice"
        description="Text-to-speech and speech-to-text."
      />
      <SavedMessageBanner msg={msg} />
      <div className={SETTINGS_CARD_CLASS}>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--theme-muted)]">
          Text-to-Speech
        </p>
        <Row label="TTS Provider">
          <select
            value={ttsProvider}
            onChange={(e) => saveTts('provider', e.target.value)}
            className={SETTINGS_SELECT_CLASS}
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
                  ...(tts.openai
                    ? (tts.openai as Record<string, unknown>)
                    : {}),
                  voice: e.target.value,
                })
              }
              className={SETTINGS_SELECT_CLASS}
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
            className={SETTINGS_SELECT_CLASS}
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
                className={SETTINGS_SELECT_CLASS}
              >
                {GROQ_STT_MODELS.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </Row>
            <Row
              label="Language"
              description="Optional BCP-47 code, e.g. en or en-US."
            >
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
