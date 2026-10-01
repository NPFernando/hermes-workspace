import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { safeErrorMessage } from './rate-limit'

// Operator override for HARP-learned model capabilities: calls the HARP routing
// API's `capability_forget` operation (POST /v1/capability/forget) so a wrong
// entry (e.g. a model blocked by a one-off account error) can be undone from the
// UI. The API runs on loopback (harp-api.service) with a bearer token.

const DEFAULT_URL = 'http://127.0.0.1:8766'
const REQUEST_TIMEOUT_MS = 5000
const MODEL_RE = /^[A-Za-z0-9][\w.:/@-]{0,159}$/
const OPTION_RE = /^[a-z][a-z_]{0,39}$/

function apiToken(): string | null {
  if (process.env.HARP_API_TOKEN) return process.env.HARP_API_TOKEN.trim()
  const file =
    process.env.HARP_API_TOKEN_FILE ??
    path.join(os.homedir(), '.config', 'harp', 'api-token')
  try {
    return fs.readFileSync(file, 'utf8').trim() || null
  } catch {
    return null
  }
}

export type ForgetResult =
  | { ok: true; model: string; forgotten: Array<string> }
  | { ok: false; status: number; error: string }

export async function forgetLearnedCapability(input: {
  model: unknown
  option?: unknown
}): Promise<ForgetResult> {
  const model = typeof input.model === 'string' ? input.model.trim() : ''
  if (!MODEL_RE.test(model)) {
    return { ok: false, status: 400, error: 'Invalid model' }
  }
  const option =
    input.option === undefined || input.option === null || input.option === ''
      ? undefined
      : input.option
  if (
    option !== undefined &&
    (typeof option !== 'string' || !OPTION_RE.test(option))
  ) {
    return { ok: false, status: 400, error: 'Invalid option' }
  }
  const token = apiToken()
  if (!token) {
    return { ok: false, status: 503, error: 'HARP API token not configured' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(
      `${process.env.HARP_API_URL || DEFAULT_URL}/v1/capability/forget`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(option ? { model, option } : { model }),
        signal: controller.signal,
      },
    )
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      const error =
        typeof body.error === 'string' ? body.error : `HTTP ${res.status}`
      return {
        ok: false,
        status: 502,
        error: `HARP API: ${error}`.slice(0, 200),
      }
    }
    const forgotten = Array.isArray(body.forgotten)
      ? body.forgotten.filter((o): o is string => typeof o === 'string')
      : []
    return { ok: true, model, forgotten }
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: `HARP API unavailable: ${safeErrorMessage(err)}`.slice(0, 200),
    }
  } finally {
    clearTimeout(timer)
  }
}
