import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { safeErrorMessage } from './rate-limit'

const BROKER = '/srv/projects/_hermes-control/scripts/harp-broker.py'

export type UniversalHarpRequest = {
  taskFamily: string
  risk: 'trivial' | 'low' | 'standard' | 'complex' | 'high_risk' | 'production' | 'unknown'
  dataClass: 'public' | 'internal' | 'confidential' | 'secret' | 'regulated'
  actionMode: 'read_only' | 'write' | 'review' | 'deploy' | 'interactive'
  scope: 'snippet' | 'file' | 'module' | 'repository' | 'system' | 'external'
  repoPath: string
  runtime?: 'auto' | 'codex' | 'claude' | 'hermes'
  sessionOrigin?: 'auto' | 'codex' | 'claude' | 'hermes'
}

export type UniversalHarpPlan = Record<string, unknown>

/**
 * Ask the control-plane broker for a prompt-free route plan. The broker is
 * deliberately execution-disabled; this is safe to call before dispatch and
 * gives the UI an auditable runtime/model/role decision.
 */
export function planUniversalHarpRoute(request: UniversalHarpRequest):
  | { ok: true; plan: UniversalHarpPlan }
  | { ok: false; error: string } {
  if (!existsSync(BROKER)) return { ok: false, error: 'Universal HARP broker is not installed' }
  try {
    const output = execFileSync('python3', [
      BROKER, 'plan',
      '--task', request.taskFamily,
      '--risk', request.risk,
      '--data-class', request.dataClass,
      '--action-mode', request.actionMode,
      '--scope', request.scope,
      '--runtime', request.runtime ?? 'auto',
      '--session-origin', request.sessionOrigin ?? 'hermes',
      '--repo-path', request.repoPath,
    ], { encoding: 'utf8', timeout: 15_000, maxBuffer: 512 * 1024 })
    return { ok: true, plan: JSON.parse(output) as UniversalHarpPlan }
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) }
  }
}
