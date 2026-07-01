import { Row, SETTINGS_CARD_CLASS, SectionHeader } from './settings-dialog-primitives'
import { Switch } from '@/components/ui/switch'
import { useChatSettingsStore } from '@/hooks/use-chat-settings'

export function ChatContent() {
  const { settings: cs, updateSettings: updateCS } = useChatSettingsStore()
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Chat"
        description="Message visibility and response loader style."
      />
      <div className={SETTINGS_CARD_CLASS}>
        <Row
          label="Show tool messages"
          description="Display tool call details in assistant responses."
        >
          <Switch
            checked={cs.showToolMessages}
            onCheckedChange={(c) => updateCS({ showToolMessages: c })}
            aria-label="Show tool messages"
          />
        </Row>
        <Row
          label="Show reasoning blocks"
          description="Display model reasoning blocks when available."
        >
          <Switch
            checked={cs.showReasoningBlocks}
            onCheckedChange={(c) => updateCS({ showReasoningBlocks: c })}
            aria-label="Show reasoning blocks"
          />
        </Row>
        <Row
          label="Sound on response complete"
          description="Play a short sound in the browser when the agent finishes replying."
        >
          <Switch
            checked={cs.soundOnChatComplete}
            onCheckedChange={(c) => updateCS({ soundOnChatComplete: c })}
            aria-label="Sound on response complete"
          />
        </Row>
        <Row
          label="Enter key behavior"
          description={
            cs.enterBehavior === 'newline'
              ? 'Enter inserts a newline. Use ⌘/Ctrl+Enter to send.'
              : 'Enter sends the message. Use Shift+Enter for a newline.'
          }
        >
          <Switch
            checked={cs.enterBehavior === 'newline'}
            onCheckedChange={(c) =>
              updateCS({ enterBehavior: c ? 'newline' : 'send' })
            }
            aria-label="Enter inserts newline instead of sending"
          />
        </Row>
        <Row
          label="Chat content width"
          description="Max-width of the message column on wide screens."
        >
          <select
            value={cs.chatWidth}
            onChange={(e) =>
              updateCS({
                chatWidth: e.target.value as 'comfortable' | 'wide' | 'full',
              })
            }
            className="h-8 rounded-md border border-[var(--theme-border)] bg-[var(--theme-panel)] px-2 text-sm text-[var(--theme-text)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]"
            aria-label="Chat content width"
          >
            <option value="comfortable">Comfortable (900px)</option>
            <option value="wide">Wide (1200px)</option>
            <option value="full">Full width</option>
          </select>
        </Row>
        <Row
          label="Expand sidebar on hover"
          description={
            cs.sidebarHoverExpand
              ? 'Collapsed sidebar expands temporarily on hover.'
              : 'Collapsed sidebar stays at 48px until you click the toggle.'
          }
        >
          <Switch
            checked={cs.sidebarHoverExpand}
            onCheckedChange={(c) => updateCS({ sidebarHoverExpand: c })}
            aria-label="Expand sidebar on hover"
          />
        </Row>
      </div>
      {/* Loading animation removed — not relevant for Hermes */}
    </div>
  )
}
