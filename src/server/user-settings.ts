import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SETTINGS_FILE = join(
  process.env.HERMES_HOME ?? process.env.HERMES_AGENT_PATH ?? join(homedir(), '.hermes'),
  'workspace-user-settings.json',
)

export type UserSettings = {
  theme?: string
  studioSettings?: Record<string, unknown>
  chatSettings?: Record<string, unknown>
}

export function readUserSettings(): UserSettings {
  try {
    if (existsSync(SETTINGS_FILE)) {
      const raw = readFileSync(SETTINGS_FILE, 'utf8')
      return JSON.parse(raw) as UserSettings
    }
  } catch {
    // corrupt or missing — return empty
  }
  return {}
}

export function writeUserSettings(patch: Partial<UserSettings>): void {
  try {
    const current = readUserSettings()
    const next: UserSettings = {
      ...current,
      ...patch,
      studioSettings: patch.studioSettings
        ? { ...(current.studioSettings ?? {}), ...patch.studioSettings }
        : current.studioSettings,
      chatSettings: patch.chatSettings
        ? { ...(current.chatSettings ?? {}), ...patch.chatSettings }
        : current.chatSettings,
    }
    writeFileSync(SETTINGS_FILE, JSON.stringify(next), { encoding: 'utf8', mode: 0o600 })
  } catch (e) {
    console.warn('[user-settings] Failed to write:', e)
  }
}
