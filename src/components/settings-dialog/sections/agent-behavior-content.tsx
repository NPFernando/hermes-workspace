import {
  Row,
  SETTINGS_CARD_CLASS,
  SETTINGS_SELECT_CLASS,
  SavedMessageBanner,
  SectionHeader,
} from './settings-dialog-primitives'
import { cn } from '@/lib/utils'
import {
  useHermesConfigSection,
  useSavedMessage,
} from '@/hooks/use-hermes-config-section'

export function AgentBehaviorContent() {
  const { config, save: rawSave } = useHermesConfigSection('agent')
  const { msg, runWithSavedMessage } = useSavedMessage()

  const save = (key: string, value: unknown) =>
    runWithSavedMessage(() => rawSave(key, value))

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Agent Behavior"
        description="Execution limits and tool access."
      />
      <SavedMessageBanner msg={msg} />
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
            className={cn(SETTINGS_SELECT_CLASS, 'w-20 text-center')}
          />
        </Row>
        <Row label="Gateway timeout" description="Seconds before timeout">
          <input
            type="number"
            min={10}
            max={600}
            value={Number(config.gateway_timeout) || 120}
            onChange={(e) => save('gateway_timeout', Number(e.target.value))}
            className={cn(SETTINGS_SELECT_CLASS, 'w-20 text-center')}
          />
        </Row>
        <Row label="Tool enforcement" description="When agent must use tools">
          <select
            value={String(config.tool_use_enforcement || 'auto')}
            onChange={(e) => save('tool_use_enforcement', e.target.value)}
            className={SETTINGS_SELECT_CLASS}
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
