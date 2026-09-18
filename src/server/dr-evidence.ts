import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

const EVIDENCE_FILE = /^exercise-[0-9]{14,}\.json$/

export type SanitizedDrEvidence = {
  file: string
  generatedAt: string | null
  mode: 'plan' | 'run' | null
  nonDestructive: boolean | null
  ok: boolean | null
  results: Array<{
    name: string
    status: 'planned' | 'passed' | 'failed' | 'skipped' | 'unknown'
    detail: string | null
  }>
}

function evidenceDirectory(): string {
  return process.env.HERMES_DR_EVIDENCE_DIR || join(homedir(), '.hermes-data', 'dr-exercises')
}

function safeText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value.slice(0, 1_000)
}

export function sanitizeDrEvidence(file: string, value: unknown): SanitizedDrEvidence | null {
  if (!value || typeof value !== 'object') return null
  const report = value as Record<string, unknown>
  const results = Array.isArray(report.results) ? report.results : []
  return {
    file,
    generatedAt: safeText(report.generatedAt),
    mode: report.mode === 'plan' || report.mode === 'run' ? report.mode : null,
    nonDestructive: typeof report.nonDestructive === 'boolean' ? report.nonDestructive : null,
    ok: typeof report.ok === 'boolean' ? report.ok : null,
    results: results.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const result = item as Record<string, unknown>
      const status = ['planned', 'passed', 'failed', 'skipped'].includes(String(result.status))
        ? (result.status as SanitizedDrEvidence['results'][number]['status'])
        : 'unknown'
      return [{ name: safeText(result.name) || 'unnamed', status, detail: safeText(result.detail) }]
    }),
  }
}

function evidenceFiles(): Array<string> {
  try {
    return readdirSync(evidenceDirectory())
      .filter((file) => EVIDENCE_FILE.test(file))
      .sort()
      .reverse()
  } catch {
    return []
  }
}

export function listDrEvidence(): Array<SanitizedDrEvidence> {
  return evidenceFiles().flatMap((file) => {
    try {
      const parsed = JSON.parse(readFileSync(join(evidenceDirectory(), file), 'utf8')) as unknown
      const sanitized = sanitizeDrEvidence(file, parsed)
      return sanitized ? [sanitized] : []
    } catch {
      return []
    }
  })
}

export function readDrEvidence(file: string): SanitizedDrEvidence | null {
  if (basename(file) !== file || !EVIDENCE_FILE.test(file)) return null
  try {
    const directory = evidenceDirectory()
    const path = join(directory, file)
    if (!statSync(path).isFile()) return null
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return sanitizeDrEvidence(file, parsed)
  } catch {
    return null
  }
}
