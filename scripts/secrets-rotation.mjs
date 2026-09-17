#!/usr/bin/env node
/**
 * Value-blind secret rotation metadata and expiry audit.
 *
 * This records only metadata. It never loads, hashes, or prints a secret
 * value, and it does not mutate environment files or provider keychains.
 */
import { appendFileSync, chmodSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const DEFAULT_KEYS = [
  'HERMES_PASSWORD',
  'HERMES_E2E_PASSWORD',
  'AUTH_E2E_PASSWORD',
  'HERMES_PG_PASSWORD',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'TELEGRAM_BOT_TOKEN',
]

const defaultMetadataPath = resolve(process.env.HERMES_SECRET_ROTATION_FILE || '.runtime/secret-rotation.json')
const defaultAuditPath = resolve(process.env.HERMES_SECRET_ROTATION_AUDIT_FILE || '.runtime/secret-rotation-audit.jsonl')

function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
}

export function readMetadata(path = defaultMetadataPath) {
  if (!existsSync(path)) return { version: 1, secrets: {} }
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  if (parsed?.version !== 1 || !parsed?.secrets || typeof parsed.secrets !== 'object') {
    throw new Error(`Invalid rotation metadata format: ${path}`)
  }
  return parsed
}

function validDate(value, label) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) throw new Error(`${label} must be an ISO date`)
  return date.toISOString()
}

export function recordRotation(metadata, { key, owner, source, expiresAt, rotatedAt = new Date().toISOString() }) {
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(key)) throw new Error('key must be an uppercase environment variable name')
  if (!owner?.trim() || !source?.trim()) throw new Error('owner and source are required')
  const next = structuredClone(metadata)
  next.secrets[key] = {
    owner: owner.trim(),
    source: source.trim(),
    rotatedAt: validDate(rotatedAt, 'rotatedAt'),
    expiresAt: validDate(expiresAt, 'expiresAt'),
  }
  return next
}

export function rotationStatus(metadata, { configuredKeys = [], now = Date.now(), warningDays = 14 } = {}) {
  const warningMs = warningDays * 24 * 60 * 60 * 1000
  return Object.entries(metadata.secrets).map(([key, entry]) => {
    const expiry = Date.parse(entry.expiresAt)
    const remainingMs = expiry - now
    const state = remainingMs < 0 ? 'expired' : remainingMs <= warningMs ? 'expiring' : 'valid'
    return {
      key,
      configured: configuredKeys.includes(key),
      owner: entry.owner,
      source: entry.source,
      rotatedAt: entry.rotatedAt,
      expiresAt: entry.expiresAt,
      state,
      daysRemaining: Math.ceil(remainingMs / (24 * 60 * 60 * 1000)),
    }
  })
}

export function writeRotation(metadata, { metadataPath = defaultMetadataPath, auditPath = defaultAuditPath, event = {} } = {}) {
  ensureParent(metadataPath)
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 })
  chmodSync(metadataPath, 0o600)
  ensureParent(auditPath)
  appendFileSync(auditPath, `${JSON.stringify({ at: new Date().toISOString(), action: 'record_rotation', ...event })}\n`, { mode: 0o600 })
  chmodSync(auditPath, 0o600)
}

function configuredKeys() {
  const files = [
    '/home/ubuntu/hermes-workspace-live/.env',
    '/home/ubuntu/.hermes/.env',
    '/home/ubuntu/.hermes/fork-sync-preview.env',
  ]
  const configured = new Set(DEFAULT_KEYS.filter((key) => Boolean(process.env[key])))
  for (const file of files) {
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    for (const key of DEFAULT_KEYS) {
      if (new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*=`, 'm').test(text)) configured.add(key)
    }
  }
  return [...configured]
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, key, ...args] = process.argv.slice(2)
  const metadata = readMetadata()
  if (!command || command === 'status') {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), warning: 'Metadata only; secret values are never displayed or loaded.', status: rotationStatus(metadata, { configuredKeys: configuredKeys() }) }, null, 2))
  } else if (command === 'record') {
    const value = (name) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1)
    const next = recordRotation(metadata, { key, owner: value('--owner'), source: value('--source'), expiresAt: value('--expires-at'), rotatedAt: value('--rotated-at') || undefined })
    writeRotation(next, { event: { key, owner: next.secrets[key].owner, source: next.secrets[key].source, expiresAt: next.secrets[key].expiresAt } })
    console.log(JSON.stringify({ ok: true, key, expiresAt: next.secrets[key].expiresAt, metadataOnly: true }))
  } else {
    console.error('Usage: secrets-rotation.mjs [status|record KEY --owner=... --source=... --expires-at=ISO]')
    process.exitCode = 2
  }
}
