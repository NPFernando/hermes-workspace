import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type WorkspaceSessionManagerExecutableOptions = {
  configured?: string
  home?: string
  pathValue?: string
  exists?: (path: string) => boolean
}

/** Resolve the intended editable install before relying on a service PATH. */
export function resolveWorkspaceSessionManagerExecutable(
  options: WorkspaceSessionManagerExecutableOptions = {},
): string | null {
  const configured = options.configured ?? process.env.WS_SESSION_MANAGER_BIN
  if (configured?.trim()) return configured.trim()

  const home = options.home ?? homedir()
  const exists = options.exists ?? existsSync
  const candidates = [
    join(home, '.local/bin/ws'),
    join(home, '.local/share/workspace-session-manager/venv/bin/ws'),
    join(home, 'workspace/projects/workspace-session-manager/.venv/bin/ws'),
  ]
  const installed = candidates.find((candidate) => exists(candidate))
  if (installed) return installed

  const pathValue = options.pathValue ?? process.env.PATH ?? ''
  return pathValue
    .split(delimiter)
    .filter(Boolean)
    .some((directory) => exists(join(directory, 'ws')))
    ? 'ws'
    : null
}

export type WorkspaceSessionHealth = {
  available: boolean
  checkedAt: number
  reason: 'ready' | 'not_installed' | 'probe_failed'
  installation: {
    installedExecutable: boolean
    packageVersion: string | null
  }
  probeProcess: {
    alive: boolean | null
    pid: number | null
    role: string | null
  }
  sessions: Array<{
    name: string
    attached: boolean
    paneProcessAlive: boolean | null
    paneDead: boolean
    tuiResponsive: boolean
    heartbeatLatencyMs: number | null
    keysSent: false
  }>
}

type RawLiveState = {
  installation?: { installed_executable?: unknown; package_version?: unknown }
  probe_process?: { alive?: unknown; pid?: unknown; role?: unknown }
  sessions?: Array<{
    name?: unknown
    attached?: unknown
    pane_process_alive?: unknown
    pane_dead?: unknown
    tui_responsive?: unknown
    heartbeat?: { latency_ms?: unknown; keys_sent?: unknown }
  }>
}

function unavailable(
  reason: 'not_installed' | 'probe_failed',
): WorkspaceSessionHealth {
  return {
    available: false,
    checkedAt: Date.now(),
    reason,
    installation: { installedExecutable: false, packageVersion: null },
    probeProcess: { alive: null, pid: null, role: null },
    sessions: [],
  }
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

export async function getWorkspaceSessionHealth(): Promise<WorkspaceSessionHealth> {
  const executable = resolveWorkspaceSessionManagerExecutable()
  if (!executable) return unavailable('not_installed')

  try {
    const { stdout } = await execFileAsync(
      executable,
      ['live-state', '--json'],
      {
        timeout: 8000,
        maxBuffer: 256 * 1024,
        windowsHide: true,
      },
    )
    const raw = JSON.parse(stdout) as RawLiveState
    const sessions = Array.isArray(raw.sessions) ? raw.sessions : []
    return {
      available: true,
      checkedAt: Date.now(),
      reason: 'ready',
      installation: {
        installedExecutable: raw.installation?.installed_executable === true,
        packageVersion:
          typeof raw.installation?.package_version === 'string'
            ? raw.installation.package_version
            : null,
      },
      probeProcess: {
        alive: booleanOrNull(raw.probe_process?.alive),
        pid:
          typeof raw.probe_process?.pid === 'number' &&
          Number.isInteger(raw.probe_process.pid)
            ? raw.probe_process.pid
            : null,
        role:
          typeof raw.probe_process?.role === 'string'
            ? raw.probe_process.role
            : null,
      },
      sessions: sessions.flatMap((session) => {
        if (typeof session.name !== 'string') return []
        const heartbeat = session.heartbeat
        return [
          {
            name: session.name,
            attached: session.attached === true,
            paneProcessAlive: booleanOrNull(session.pane_process_alive),
            paneDead: session.pane_dead === true,
            tuiResponsive: session.tui_responsive === true,
            heartbeatLatencyMs:
              typeof heartbeat?.latency_ms === 'number' &&
              Number.isFinite(heartbeat.latency_ms)
                ? heartbeat.latency_ms
                : null,
            // Fail closed: never imply a probe sent keys.
            keysSent: false as const,
          },
        ]
      }),
    }
  } catch {
    return unavailable('probe_failed')
  }
}
