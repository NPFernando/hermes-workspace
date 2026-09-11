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
      if (file === 'systemctl') return 'failed\n42\n1\nfailed'
      return ''
    }
    const status = await collectOperationalStatus({ repo: root, statePath, now: 5000, exec: fakeExec })
    expect(status.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['missing_build', 'failed_deploy', 'parked_stashes']))
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({ checkedAt: 5000, pid: '42' })
  })

  it('records a PID change as a warning on a healthy service', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hermes-ops-monitor-'))
    const statePath = join(root, 'state.json')
    const exec = (file, args) => file === 'git' && args[0] === 'rev-parse' ? 'abc' : file === 'git' && args[0] === 'show' ? '100' : file === 'systemctl' ? 'active\n22\n0\nsuccess' : ''
    await collectOperationalStatus({ repo: root, statePath, exec })
    const next = await collectOperationalStatus({ repo: root, statePath, exec: (file, args) => file === 'git' && args[0] === 'rev-parse' ? 'abc' : file === 'git' && args[0] === 'show' ? '100' : file === 'systemctl' ? 'active\n23\n0\nsuccess' : '' })
    expect(next.issues).toContainEqual(expect.objectContaining({ code: 'pid_changed', level: 'warning' }))
  })
})
