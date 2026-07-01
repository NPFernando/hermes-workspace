import { MessageMultiple01Icon } from '@hugeicons/core-free-icons'
import { SettingsRow, SettingsSection } from './settings-primitives'
import { Switch } from '@/components/ui/switch'
import { useSettings } from '@/hooks/use-settings'
import { useChatSettingsStore } from '@/hooks/use-chat-settings'

// ── Chat Display Section ────────────────────────────────────────────────

export function ChatDisplaySection() {
  const { settings: chatSettings, updateSettings: updateChatSettings } =
    useChatSettingsStore()
  const { settings, updateSettings } = useSettings()

  return (
    <>
      <SettingsSection
        title="Chat Display"
        description="Control what's visible in chat messages."
        icon={MessageMultiple01Icon}
      >
        <SettingsRow
          label="Show tool messages"
          description="Display tool call details when the agent uses tools."
        >
          <Switch
            checked={chatSettings.showToolMessages}
            onCheckedChange={(checked) =>
              updateChatSettings({ showToolMessages: checked })
            }
            aria-label="Show tool messages"
          />
        </SettingsRow>
        <SettingsRow
          label="Show reasoning blocks"
          description="Display model thinking and reasoning process."
        >
          <Switch
            checked={chatSettings.showReasoningBlocks}
            onCheckedChange={(checked) =>
              updateChatSettings({ showReasoningBlocks: checked })
            }
            aria-label="Show reasoning blocks"
          />
        </SettingsRow>
        <SettingsRow
          label="Sound on response complete"
          description="Play a short sound in the browser when the agent finishes replying."
        >
          <Switch
            checked={chatSettings.soundOnChatComplete}
            onCheckedChange={(checked) =>
              updateChatSettings({ soundOnChatComplete: checked })
            }
            aria-label="Sound on response complete"
          />
        </SettingsRow>
        <SettingsRow
          label="Enter key behavior"
          description={
            chatSettings.enterBehavior === 'newline'
              ? 'Enter inserts a newline. Use ⌘/Ctrl+Enter to send.'
              : 'Enter sends the message. Use Shift+Enter for a newline.'
          }
        >
          <Switch
            checked={chatSettings.enterBehavior === 'newline'}
            onCheckedChange={(checked) =>
              updateChatSettings({
                enterBehavior: checked ? 'newline' : 'send',
              })
            }
            aria-label="Enter inserts newline instead of sending"
          />
        </SettingsRow>
        <SettingsRow
          label="Chat content width"
          description="Controls the max-width of the message column on wide screens."
        >
          <select
            value={chatSettings.chatWidth}
            onChange={(e) =>
              updateChatSettings({
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
        </SettingsRow>
        <SettingsRow
          label="Expand sidebar on hover"
          description={
            chatSettings.sidebarHoverExpand
              ? 'Collapsed sidebar expands temporarily when you hover over it.'
              : 'Collapsed sidebar stays at 48px. Click the toggle to open (default).'
          }
        >
          <Switch
            checked={chatSettings.sidebarHoverExpand}
            onCheckedChange={(checked) =>
              updateChatSettings({ sidebarHoverExpand: checked })
            }
            aria-label="Expand sidebar on hover"
          />
        </SettingsRow>
        <SettingsRow
          label="Show usage meter"
          description="Show the floating usage/provider pill in chat. Off by default to keep the composer clean."
        >
          <Switch
            checked={settings.showUsageMeter}
            onCheckedChange={(checked) =>
              updateSettings({ showUsageMeter: checked })
            }
            aria-label="Show usage meter"
          />
        </SettingsRow>
      </SettingsSection>
    </>
  )
}

