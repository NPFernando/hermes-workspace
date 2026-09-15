import { describe, expect, it } from 'vitest'
import { resolveWorkspaceSessionManagerExecutable } from './workspace-session-health'

describe('resolveWorkspaceSessionManagerExecutable', () => {
  it('prefers the managed editable-install launcher', () => {
    const exists = (path: string) =>
      path === '/home/test/.local/bin/ws' || path === '/usr/bin/ws'

    expect(
      resolveWorkspaceSessionManagerExecutable({
        home: '/home/test',
        pathValue: '/usr/bin',
        exists,
      }),
    ).toBe('/home/test/.local/bin/ws')
  })

  it('supports the dedicated virtualenv and project virtualenv launchers', () => {
    const virtualenv = '/home/test/.local/share/workspace-session-manager/venv/bin/ws'
    expect(
      resolveWorkspaceSessionManagerExecutable({
        home: '/home/test',
        exists: (path) => path === virtualenv,
      }),
    ).toBe(virtualenv)

    const project = '/home/test/workspace/projects/workspace-session-manager/.venv/bin/ws'
    expect(
      resolveWorkspaceSessionManagerExecutable({
        home: '/home/test',
        exists: (path) => path === project,
      }),
    ).toBe(project)
  })

  it('uses PATH only when no known managed install exists', () => {
    expect(
      resolveWorkspaceSessionManagerExecutable({
        home: '/home/test',
        pathValue: '/opt/bin:/usr/bin',
        exists: (path) => path === '/usr/bin/ws',
      }),
    ).toBe('ws')
  })

  it('honors an explicit executable and reports missing installations', () => {
    expect(
      resolveWorkspaceSessionManagerExecutable({
        configured: ' /srv/wsm/bin/ws ',
        home: '/home/test',
        exists: () => false,
      }),
    ).toBe('/srv/wsm/bin/ws')
    expect(
      resolveWorkspaceSessionManagerExecutable({
        home: '/home/test',
        pathValue: '/opt/bin',
        exists: () => false,
      }),
    ).toBeNull()
  })
})
