import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectOperationalStatus } from './ops-monitor.mjs'

describe('operational monitor', () => {
  it('detects stale builds, failed deployments, PID changes, and parked stashes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hermes-ops-monitor-'))
    const statePath = join(root, 'state.json')
    const fakeExec = (file, args) => {
      if (file === 'git' && args[0] === 'rev-parse') return 'abc123'
      if (file === 'git' && args[0] === 'show') return '200'
      if (file === 'git' && args[0] === 'stash') return 'stash@{0}: WIP'
      if (file === 'systemctl') return 'MainPID=42\nExecMainStatus=1\nResult=failed\nActiveState=failed'
      return ''
    }
    const status = await collectOperationalStatus({ repo: root, statePath, now: 5000, exec: fakeExec })
    expect(status.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['missing_build', 'failed_deploy', 'parked_stashes']))
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({ checkedAt: 5000, pid: '42' })
  })

  it('records a PID change as a warning on a healthy service', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hermes-ops-monitor-'))
    const statePath = join(root, 'state.json')
    const exec = (file, args) => file === 'git' && args[0] === 'rev-parse' ? 'abc' : file === 'git' && args[0] === 'show' ? '100' : file === 'systemctl' ? 'MainPID=22\nExecMainStatus=0\nResult=success\nActiveState=active' : ''
    await collectOperationalStatus({ repo: root, statePath, exec })
    const next = await collectOperationalStatus({ repo: root, statePath, exec: (file, args) => file === 'git' && args[0] === 'rev-parse' ? 'abc' : file === 'git' && args[0] === 'show' ? '100' : file === 'systemctl' ? 'MainPID=23\nExecMainStatus=0\nResult=success\nActiveState=active' : '' })
    expect(next.issues).toContainEqual(expect.objectContaining({ code: 'pid_changed', level: 'warning' }))
  })

  it('reports uptime, memory, OOM evidence, deployment history, and service errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hermes-ops-monitor-'))
    const exec = (file, args) => {
      if (file === 'git' && args[0] === 'rev-parse') return 'abc'
      if (file === 'git' && args[0] === 'show') return '100'
      if (file === 'systemctl') return 'MainPID=22\nExecMainStatus=0\nResult=success\nActiveState=active\nActiveEnterTimestamp=Thu 1970-01-01 00:00:01 UTC\nMemoryCurrent=12345\nOOMKilled=no'
      if (file === 'journalctl' && args[0] === '-k') return 'kernel: Out of memory: Killed process 999'
      if (file === 'journalctl' && args[1] === 'hermes-workspace-deploy.service') return 'deploy succeeded at commit abc'
      if (file === 'journalctl') return 'workspace: error: test failure'
      return ''
    }
    const status = await collectOperationalStatus({ repo: root, statePath: join(root, 'state.json'), now: 10_000, exec })
    expect(status.service).toMatchObject({ residentMemoryKb: null, oomDetected: true })
    expect(status.service.uptimeSeconds).toBeGreaterThan(0)
    expect(status.deploymentHistory).toEqual(['deploy succeeded at commit abc'])
    expect(status.issues).toContainEqual(expect.objectContaining({ code: 'oom_event', level: 'warning' }))
    expect(status.issues).toContainEqual(expect.objectContaining({ code: 'service_errors', level: 'warning' }))
  })
})
