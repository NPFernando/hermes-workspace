import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const scriptPath = join(
  process.cwd(),
  'scripts',
  'install-finance-schedulers.sh',
)
const runtimeScripts = [
  'daily-finance-check.sh',
  'monthly-finance-report.sh',
  'monthly-net-worth-snapshot.sh',
  'cse-market-snapshot.sh',
]

function runLiveCheck(liveRoot: string): { status: number; output: string } {
  try {
    return {
      status: 0,
      output: execFileSync('bash', [scriptPath, '--check-live'], {
        env: { ...process.env, FINANCE_LIVE_ROOT: liveRoot },
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    }
  } catch (error) {
    const failure = error as {
      status?: number
      stdout?: string
      stderr?: string
    }
    return {
      status: failure.status ?? -1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    }
  }
}

describe('install-finance-schedulers.sh --check-live', () => {
  it('fails when a live checkout is missing referenced runtime scripts', async () => {
    const liveRoot = await mkdtemp(join(tmpdir(), 'finance-scheduler-check-'))
    try {
      const result = runLiveCheck(liveRoot)
      expect(result.status).toBe(1)
      expect(result.output).toContain('live scheduler check: not ready')
    } finally {
      await rm(liveRoot, { recursive: true, force: true })
    }
  })

  it('passes when every referenced runtime script is executable', async () => {
    const liveRoot = await mkdtemp(join(tmpdir(), 'finance-scheduler-check-'))
    const scriptsDir = join(liveRoot, 'scripts')
    try {
      await mkdir(scriptsDir, { recursive: true })
      for (const script of runtimeScripts) {
        const path = join(scriptsDir, script)
        await writeFile(path, '#!/usr/bin/env bash\nexit 0\n')
        await chmod(path, 0o755)
      }

      const result = runLiveCheck(liveRoot)
      expect(result.status).toBe(0)
      expect(result.output).toContain('live scheduler check: ready')
    } finally {
      await rm(liveRoot, { recursive: true, force: true })
    }
  })

  it('fails when the optional scheduler env file is group/world readable', async () => {
    const liveRoot = await mkdtemp(join(tmpdir(), 'finance-scheduler-check-'))
    const scriptsDir = join(liveRoot, 'scripts')
    try {
      await mkdir(scriptsDir, { recursive: true })
      for (const script of runtimeScripts) {
        const path = join(scriptsDir, script)
        await writeFile(path, '#!/usr/bin/env bash\nexit 0\n')
        await chmod(path, 0o755)
      }
      const envFile = join(liveRoot, '.env.finance-scheduler')
      await writeFile(envFile, 'FINANCE_SESSION_COOKIE=redacted\n')
      await chmod(envFile, 0o644)

      const result = runLiveCheck(liveRoot)
      expect(result.status).toBe(1)
      expect(result.output).toContain('scheduler env file: permissions must not grant')
    } finally {
      await rm(liveRoot, { recursive: true, force: true })
    }
  })

  it('passes with a private scheduler env file', async () => {
    const liveRoot = await mkdtemp(join(tmpdir(), 'finance-scheduler-check-'))
    const scriptsDir = join(liveRoot, 'scripts')
    try {
      await mkdir(scriptsDir, { recursive: true })
      for (const script of runtimeScripts) {
        const path = join(scriptsDir, script)
        await writeFile(path, '#!/usr/bin/env bash\nexit 0\n')
        await chmod(path, 0o755)
      }
      const envFile = join(liveRoot, '.env.finance-scheduler')
      await writeFile(envFile, 'FINANCE_SESSION_COOKIE=redacted\n')
      await chmod(envFile, 0o600)

      const result = runLiveCheck(liveRoot)
      expect(result.status).toBe(0)
      expect(result.output).toContain('scheduler env file: secure permissions')
      expect(result.output).not.toContain('FINANCE_SESSION_COOKIE')
    } finally {
      await rm(liveRoot, { recursive: true, force: true })
    }
  })
})
