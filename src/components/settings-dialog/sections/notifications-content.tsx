import { Row, SETTINGS_CARD_CLASS, SectionHeader } from './settings-dialog-primitives'
import { Switch } from '@/components/ui/switch'
import { useSettings } from '@/hooks/use-settings'

export function NotificationsContent() {
  const { settings, updateSettings } = useSettings()
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Notifications"
        description="Simple alerts and threshold controls."
      />
      <div className={SETTINGS_CARD_CLASS}>
        <Row label="Enable alerts">
          <Switch
            checked={settings.notificationsEnabled}
            onCheckedChange={(c) => updateSettings({ notificationsEnabled: c })}
            aria-label="Enable alerts"
          />
        </Row>
        <Row label="Usage threshold">
          <div className="flex w-full max-w-[14rem] items-center gap-2">
            <input
              type="range"
              min={50}
              max={100}
              value={settings.usageThreshold}
              onChange={(e) =>
                updateSettings({ usageThreshold: Number(e.target.value) })
              }
              className="w-full accent-[var(--theme-text)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!settings.notificationsEnabled}
              aria-label={`Usage threshold: ${settings.usageThreshold} percent`}
              aria-valuemin={50}
              aria-valuemax={100}
              aria-valuenow={settings.usageThreshold}
            />
            <span className="w-10 text-right text-sm tabular-nums text-[var(--theme-muted)]">
              {settings.usageThreshold}%
            </span>
          </div>
        </Row>
      </div>
    </div>
  )
}
