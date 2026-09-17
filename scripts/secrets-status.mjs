#!/usr/bin/env node
/**
 * Report credential configuration presence without ever printing values.
 * This is intentionally a status tool, not a secret loader or rotator.
 */
import { existsSync, readFileSync } from 'node:fs'

const files = [
  '/home/ubuntu/hermes-workspace-live/.env',
  '/home/ubuntu/.hermes/.env',
  '/home/ubuntu/.hermes/fork-sync-preview.env',
]

const groups = [
  { name: 'workspace-auth', keys: ['HERMES_PASSWORD', 'CLAUDE_PASSWORD'] },
  {
    name: 'authenticated-e2e',
    keys: ['AUTH_E2E_PASSWORD', 'AUTH_E2E_BASE_URL'],
  },
  { name: 'database', keys: ['HERMES_PG_PASSWORD', 'RESEARCH_DATABASE_URL'] },
  {
    name: 'provider-keys',
    keys: [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'OPENROUTER_API_KEY',
      'TELEGRAM_BOT_TOKEN',
    ],
  },
]

function fileHasKey(file, key) {
  if (!existsSync(file)) return false
  const text = readFileSync(file, 'utf8')
  return new RegExp(
    `^\\s*${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*=`,
    'm',
  ).test(text)
}

const status = groups.map((group) => ({
  name: group.name,
  keys: group.keys.map((key) => ({
    key,
    configuredInEnvironment: Boolean(process.env[key]),
    configuredInKnownFile: files.some((file) => fileHasKey(file, key)),
  })),
}))

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      warning:
        'Presence only; secret values are never displayed or loaded for output.',
      status,
    },
    null,
    2,
  ),
)
