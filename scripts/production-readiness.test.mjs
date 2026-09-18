import { describe, expect, it } from 'vitest'
import { buildConfigurationPreflight } from './production-readiness.mjs'

function configured(keys) {
  return (key) => keys.has(key)
}

describe('production configuration preflight', () => {
  it('passes when Google OAuth, Postgres, and webhook settings are present', () => {
    const report = buildConfigurationPreflight({
      isConfigured: configured(
        new Set([
          'GOOGLE_CLIENT_ID',
          'GOOGLE_CLIENT_SECRET',
          'HERMES_PG_PASSWORD',
          'HERMES_OPS_ALERT_WEBHOOK_URL',
        ]),
      ),
    })
    expect(report).toMatchObject({
      status: 'pass',
      oauth: { googleConfigured: true },
      database: { postgresPasswordConfigured: true },
      alerts: { webhookConfigured: true },
    })
  })

  it('keeps password-only auth usable but reports optional OAuth and alerts as degraded', () => {
    const report = buildConfigurationPreflight({
      isConfigured: configured(
        new Set(['HERMES_PASSWORD', 'HERMES_PG_PASSWORD']),
      ),
    })
    expect(report.status).toBe('degraded')
    expect(report.oauth).toMatchObject({
      status: 'degraded',
      googleConfigured: false,
      passwordAuthConfigured: true,
    })
    expect(report.alerts).toMatchObject({
      status: 'degraded',
      webhookConfigured: false,
    })
  })

  it('fails when core authentication and database settings are absent', () => {
    const report = buildConfigurationPreflight({
      isConfigured: configured(new Set()),
    })
    expect(report.status).toBe('fail')
    expect(report.detail).toContain('HERMES_PG_PASSWORD')
    expect(report.oauth).toMatchObject({
      status: 'fail',
      passwordAuthConfigured: false,
    })
  })

  it('accepts a deployment env-file-backed password session without reading values', () => {
    const report = buildConfigurationPreflight({
      isConfigured: configured(
        new Set([
          'HERMES_PASSWORD',
          'HERMES_PG_PASSWORD',
          'TELEGRAM_BOT_TOKEN',
          'TELEGRAM_RELAY_BASE',
          'HERMES_OPS_ALERT_TELEGRAM_CHAT_ID',
        ]),
      ),
    })
    expect(report).toMatchObject({
      status: 'degraded',
      oauth: { status: 'degraded', passwordAuthConfigured: true },
      database: { status: 'pass' },
      alerts: { status: 'pass', telegramConfigured: true },
    })
  })
})
