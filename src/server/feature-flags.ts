import { createHash } from 'node:crypto'

export type FeatureFlagName =
  | 'dashboard-dr-evidence'
  | 'dashboard-service-health-history'

export type FeatureFlagConfig = {
  enabled: boolean
  rolloutPercent: number
}

export type FeatureFlagDecision = FeatureFlagConfig & {
  name: FeatureFlagName
  enabledForSubject: boolean
}

const DEFAULT_FLAGS: Record<FeatureFlagName, FeatureFlagConfig> = {
  'dashboard-dr-evidence': { enabled: true, rolloutPercent: 100 },
  'dashboard-service-health-history': { enabled: true, rolloutPercent: 100 },
}

function configuredFlags(
  env: NodeJS.ProcessEnv = process.env,
): Record<FeatureFlagName, FeatureFlagConfig> {
  const flags = Object.fromEntries(
    Object.entries(DEFAULT_FLAGS).map(([name, config]) => [name, { ...config }]),
  ) as Record<FeatureFlagName, FeatureFlagConfig>
  const raw = env.HERMES_FEATURE_FLAGS?.trim()
  if (!raw) return flags
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    for (const name of Object.keys(DEFAULT_FLAGS) as Array<FeatureFlagName>) {
      const value = parsed[name]
      if (typeof value === 'boolean') {
        flags[name] = { enabled: value, rolloutPercent: value ? 100 : 0 }
        continue
      }
      if (!value || typeof value !== 'object') continue
      const candidate = value as { enabled?: unknown; rolloutPercent?: unknown }
      const enabled =
        typeof candidate.enabled === 'boolean'
          ? candidate.enabled
          : flags[name].enabled
      const rolloutPercent =
        typeof candidate.rolloutPercent === 'number' &&
        Number.isFinite(candidate.rolloutPercent)
          ? Math.max(0, Math.min(100, candidate.rolloutPercent))
          : flags[name].rolloutPercent
      flags[name] = { enabled, rolloutPercent }
    }
  } catch {
    // Invalid configuration fails closed for the affected override and keeps
    // the checked-in safe defaults for the rest of the dashboard.
  }
  return flags
}

function rolloutBucket(name: FeatureFlagName, subject: string): number {
  const digest = createHash('sha256').update(`${name}:${subject}`).digest()
  return (digest.readUInt32BE(0) / 0xffffffff) * 100
}

export function getFeatureFlag(
  name: FeatureFlagName,
  subject = 'anonymous',
  env: NodeJS.ProcessEnv = process.env,
): FeatureFlagDecision {
  const config = configuredFlags(env)[name]
  return {
    name,
    ...config,
    enabledForSubject:
      config.enabled && rolloutBucket(name, subject) < config.rolloutPercent,
  }
}

export function getFeatureFlagSnapshot(
  subject = 'anonymous',
  env: NodeJS.ProcessEnv = process.env,
): Array<FeatureFlagDecision> {
  return (Object.keys(DEFAULT_FLAGS) as Array<FeatureFlagName>).map((name) =>
    getFeatureFlag(name, subject, env),
  )
}
