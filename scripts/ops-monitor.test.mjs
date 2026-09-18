import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectOperationalStatus, notifyOperationalAlerts } from './ops-monitor.mjs'

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

  it('reports the deployed commit and pending runtime files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hermes-ops-monitor-'))
    const runtime = join(root, '.runtime')
    await mkdir(runtime, { recursive: true })
    await writeFile(join(runtime, 'build-commit'), 'old\n')
    await mkdir(join(root, 'dist/server'), { recursive: true })
    const buildPath = join(root, 'dist/server/server.js')
    await writeFile(buildPath, 'built')
    await utimes(buildPath, 1, 1)
    const exec = (file, args) => {
      if (file === 'git' && args[0] === 'rev-parse') return 'new'
      if (file === 'git' && args[0] === 'show') return '100'
      if (file === 'git' && args[0] === 'diff') return 'src/server/example.ts\ndocs/example.md'
      if (file === 'systemctl') return 'MainPID=22\nExecMainStatus=0\nResult=success\nActiveState=active'
      return ''
    }
    const status = await collectOperationalStatus({ repo: root, statePath: join(runtime, 'state.json'), now: Date.now(), exec })
    expect(status.deployedCommit).toBe('old')
    expect(status.pendingFiles).toEqual(['src/server/example.ts', 'docs/example.md'])
    expect(status.pendingRuntimeFiles).toEqual(['src/server/example.ts'])
    expect(status.issues).toContainEqual(expect.objectContaining({ code: 'stale_build', level: 'critical' }))
  })

  it('alerts on a sustained resident-memory increase', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hermes-ops-monitor-'))
    const statePath = join(root, 'state.json')
    await writeFile(statePath, JSON.stringify({ residentMemoryKb: 100_000 }))
    const exec = (file, args) => {
      if (file === 'git' && args[0] === 'rev-parse') return 'abc'
      if (file === 'git' && args[0] === 'show') return '100'
      if (file === 'systemctl') return 'MainPID=22\nExecMainStatus=0\nResult=success\nActiveState=active'
      if (file === 'bash') return '150000 kB'
      return ''
    }
    const status = await collectOperationalStatus({ repo: root, statePath, exec })
    expect(status.service.memoryGrowthKb).toBe(50_000)
    expect(status.issues).not.toContainEqual(expect.objectContaining({ code: 'memory_growth' }))

    await writeFile(statePath, JSON.stringify({ residentMemoryKb: 100_000 }))
    const larger = await collectOperationalStatus({ repo: root, statePath, exec: (file, args) => file === 'bash' ? '200000 kB' : exec(file, args) })
    expect(larger.service.memoryGrowthPercent).toBe(100)
    expect(larger.issues).toContainEqual(expect.objectContaining({ code: 'memory_growth', level: 'warning' }))
  })

  it('requires repeated high-growth samples before suggesting a restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hermes-ops-restart-threshold-'))
    const statePath = join(root, 'state.json')
    const exec = (file, args) => {
      if (file === 'git' && args[0] === 'rev-parse') return 'abc'
      if (file === 'git' && args[0] === 'show') return '100'
      if (file === 'systemctl') return 'MainPID=22\nExecMainStatus=0\nResult=success\nActiveState=active'
      if (file === 'bash') return '400000 kB'
      return ''
    }
    await writeFile(statePath, JSON.stringify({ residentMemoryKb: 100_000, memoryGrowthSamples: 2 }))
    const status = await collectOperationalStatus({ repo: root, statePath, exec })
    expect(status.restart).toMatchObject({ enabled: false, attempted: false })
    expect(status.issues).toContainEqual(expect.objectContaining({ code: 'memory_restart_required', level: 'critical' }))
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({ memoryGrowthSamples: 3 })
  })

  it('performs only an explicitly enabled guarded restart and records its cooldown', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hermes-ops-restart-enabled-'))
    const statePath = join(root, 'state.json')
    const previousEnabled = process.env.HERMES_OPS_MEMORY_RESTART_ENABLED
    process.env.HERMES_OPS_MEMORY_RESTART_ENABLED = '1'
    try {
      const exec = (file, args) => {
        if (file === 'git' && args[0] === 'rev-parse') return 'abc'
        if (file === 'git' && args[0] === 'show') return '100'
        if (file === 'systemctl') return 'MainPID=22\nExecMainStatus=0\nResult=success\nActiveState=active'
        if (file === 'bash') return '400000 kB'
        return ''
      }
      await writeFile(statePath, JSON.stringify({ residentMemoryKb: 100_000, memoryGrowthSamples: 2 }))
      const restarts = []
      const status = await collectOperationalStatus({ repo: root, statePath, exec, restart: (service) => { restarts.push(service); return true } })
      expect(restarts).toEqual(['hermes-workspace'])
      expect(status.restart).toMatchObject({ enabled: true, attempted: true, restarted: true, cooldown: true })
      expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({ lastRestartAt: expect.any(Number) })
    } finally {
      if (previousEnabled === undefined) delete process.env.HERMES_OPS_MEMORY_RESTART_ENABLED
      else process.env.HERMES_OPS_MEMORY_RESTART_ENABLED = previousEnabled
    }
  })

  it('delivers alertable findings once per cooldown window', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hermes-ops-alerts-'))
    const statePath = join(root, 'alerts.json')
    const status = {
      head: 'new-head',
      deployedCommit: 'old-head',
      service: { name: 'hermes-workspace' },
      issues: [
        { code: 'stale_build', level: 'critical', detail: 'runtime files pending' },
        { code: 'parked_stashes', level: 'warning', detail: 'not externally alertable' },
      ],
    }
    const requests = []
    const fetchImpl = async (url, options) => {
      requests.push({ url: String(url), options })
      return { ok: true, status: 200 }
    }
    const first = await notifyOperationalAlerts(status, { webhookUrl: 'https://alerts.example.test/hook', statePath, now: 1000, fetchImpl })
    const second = await notifyOperationalAlerts(status, { webhookUrl: 'https://alerts.example.test/hook', statePath, now: 2000, fetchImpl })
    expect(first).toMatchObject({ configured: true, sent: 1, skipped: 0, failed: 0 })
    expect(second).toMatchObject({ configured: true, sent: 0, skipped: 1, failed: 0 })
    expect(requests).toHaveLength(1)
    expect(JSON.parse(requests[0].options.body)).toMatchObject({
      service: 'hermes-workspace',
      issue: status.issues[0],
      head: 'new-head',
    })
  })

  it('fails closed for an invalid or missing webhook URL', async () => {
    const status = { issues: [{ code: 'oom_event', level: 'critical', detail: 'oom' }] }
    const fetchImpl = async () => { throw new Error('must not be called') }
    await expect(notifyOperationalAlerts(status, { webhookUrl: 'file:///tmp/alerts', fetchImpl })).resolves.toMatchObject({ configured: true, sent: 0, failed: 0 })
    await expect(notifyOperationalAlerts(status, { fetchImpl })).resolves.toMatchObject({ configured: false, sent: 0 })
  })

  it('validates a configured webhook in dry-run mode without calling it or writing cooldown state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hermes-ops-alert-dry-run-'))
    const statePath = join(root, 'alerts.json')
    const status = { issues: [{ code: 'memory_growth', level: 'warning', detail: 'synthetic test' }] }
    let calls = 0
    const result = await notifyOperationalAlerts(status, {
      webhookUrl: 'https://alerts.example.test/hook',
      statePath,
      dryRun: true,
      fetchImpl: async () => { calls += 1; return { ok: true } },
    })
    expect(result).toMatchObject({ configured: true, dryRun: true, sent: 0, failed: 0 })
    expect(calls).toBe(0)
    await expect(readFile(statePath, 'utf8')).rejects.toThrow()
  })

  it('delivers alertable findings through the opt-in Telegram relay', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hermes-ops-telegram-'))
    const requests = []
    const status = {
      head: 'new-head',
      deployedCommit: 'old-head',
      issues: [{ code: 'oom_event', level: 'critical', detail: 'service oom' }],
    }
    const fetchImpl = async (url, options) => {
      requests.push({ url: String(url), options })
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    const result = await notifyOperationalAlerts(status, {
      webhookUrl: '',
      telegramConfig: { token: 'test-token', relayBase: 'https://relay.example.test', chatId: 12345 },
      statePath: join(root, 'alerts.json'),
      now: 1000,
      fetchImpl,
    })
    expect(result).toMatchObject({ configured: true, sent: 1, failed: 0 })
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://relay.example.test/bottest-token/sendMessage')
    expect(JSON.parse(requests[0].options.body)).toMatchObject({ chat_id: 12345, text: expect.stringContaining('oom_event') })
  })
})
