import {
  Row,
  SETTINGS_CARD_CLASS,
  SETTINGS_SELECT_CLASS,
  SavedMessageBanner,
  SectionHeader,
} from './settings-dialog-primitives'
import { Switch } from '@/components/ui/switch'
import {
  useHermesConfigSection,
  useSavedMessage,
} from '@/hooks/use-hermes-config-section'

export function DisplayContent() {
  const { config, save: rawSave } = useHermesConfigSection('display')
  const { msg, runWithSavedMessage } = useSavedMessage()

  const save = (key: string, value: unknown) =>
    runWithSavedMessage(() => rawSave(key, value))

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Display"
        description="Agent response style and output preferences."
      />
      <SavedMessageBanner msg={msg} />
      <div className={SETTINGS_CARD_CLASS}>
        <Row label="Personality" description="Agent response style">
          <select
            value={String(config.personality || 'default')}
            onChange={(e) => save('personality', e.target.value)}
            className={SETTINGS_SELECT_CLASS}
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
