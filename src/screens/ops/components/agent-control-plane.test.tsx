// @vitest-environment jsdom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { AgentControlPlane } from './agent-control-plane'

const { queryState } = vi.hoisted(() => ({
  queryState: {
    data: {} as Record<string, unknown>,
    keys: [] as Array<string>,
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: Array<string> }) => {
    const name = String(options.queryKey.at(-1))
    queryState.keys.push(name)
    return { data: queryState.data[name], isError: false }
  },
}))

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  queryState.keys = []
  queryState.data = {}
  window.localStorage.setItem(
    'clawsuite:approvals',
    JSON.stringify([
      {
        id: 'approval-1',
        agentId: 'codex',
        agentName: 'Codex',
        action: 'run command',
        context: 'private context omitted',
        requestedAt: 1,
        status: 'pending',
      },
    ]),
  )
})

afterEach(async () => {
  await act(async () => root.unmount())
  window.localStorage.clear()
  document.body.replaceChildren()
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  vi.restoreAllMocks()
})

describe('agent control plane dashboard', () => {
  it('shows real-source summaries and keeps controls linked to their dedicated workflows', async () => {
    queryState.data = {
      queue: {
        active: { id: 'active-1', status: 'running' },
        waiting: [{ id: 'waiting-1', status: 'pending' }],
        recent: [{ id: 'failed-1', status: 'failed', deadLetterAt: 2 }],
      },
      workers: {
        checkedAt: 2,
        workers: [],
        summary: {
          totalWorkers: 3,
          degraded: true,
          workersPrimaryAuthFailed: 1,
          workersUsingFallback: 1,
        },
      },
      'harp-readiness': {
        available: true,
        checkedAt: 3,
        repositoryPath: '/workspace/harp',
        report: {
          status: 'blocked',
          blockers: ['graphify_refresh_required'],
          graphify: {
            status: 'stale',
            fresh: false,
            refresh_required: true,
            changed_file_count: 3,
          },
          health: {
            postgres: { healthy: true, status: 'ready' },
            graphify: {
              healthy: false,
              status: 'graph_path_not_configured',
            },
          },
          quality: { schema_available: true },
          governance: { open_conflicts: 2 },
          execution_enabled: false,
          side_effects: false,
          operator_approval_required: true,
        },
      },
      'workspace-session-health': {
        available: true,
        installation: { installedExecutable: true, packageVersion: '0.2.0' },
        probeProcess: {
          alive: true,
          pid: 1234,
          role: 'live-state CLI probe',
        },
        sessions: [
          {
            name: 'codex-main',
            attached: true,
            paneProcessAlive: true,
            paneDead: false,
            tuiResponsive: true,
            heartbeatLatencyMs: 12,
            keysSent: false,
          },
        ],
      },
    }

    await act(async () => {
      root.render(<AgentControlPlane />)
    })

    expect(host.textContent).toContain('graphify_refresh_required')
    expect(host.textContent).toContain(
      'Graphify data: stale · refresh required · 3 changed files',
    )
    expect(host.textContent).toContain('Unresolved memory conflicts: 2')
    expect(host.textContent).toContain('Execution: disabled')
    expect(host.textContent).toContain('Operator approval required: true')
    expect(host.textContent).toContain(
      'Graphify service check: graph_path_not_configured',
    )
    expect(host.textContent).toContain('1 pending')
    expect(host.textContent).toContain('1 active · 1 waiting')
    expect(host.textContent).toContain('1 recent dead-lettered')
    expect(host.textContent).toContain('3 configured · degraded')
    expect(host.textContent).toContain('1 session(s)')
    expect(host.textContent).toContain('no agent reply inferred')
    expect(host.textContent).not.toContain('private context omitted')
    expect(host.querySelector('a[href="/swarm2"]')?.textContent).toContain(
      'Open queue controls',
    )
    expect(host.querySelector('a[href="/chat"]')?.textContent).toContain(
      'Open approval review',
    )
    expect(queryState.keys.sort()).toEqual(
      ['harp-readiness', 'queue', 'workers', 'workspace-session-health'].sort(),
    )
  })
})
