/**
 * GET  /api/cli-agents          — list running Claude CLI agent processes
 * POST /api/cli-agents/:pid/kill — send SIGTERM to a specific process
 *
 * Scans /proc for processes whose argv[0] matches `claude` and returns
 * their pid, name, approximate task (from argv), and runtime in seconds.
 */
import fs from 'node:fs'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'

type CliAgentEntry = {
  pid: number
  name: string
  task: string
  runtimeSeconds: number
  status: 'running' | 'finished'
}

function readProcFile(pid: number, file: string): string {
  try {
    return fs.readFileSync(`/proc/${pid}/${file}`, 'utf-8')
  } catch {
    return ''
  }
}

function getProcessStartSecs(pid: number): number {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf-8')
    const parts = stat.split(' ')
    // Field 22 (0-indexed) = starttime in clock ticks since boot
    const startTicks = parseInt(parts[21] ?? '0', 10)
    const uptimeSecs = parseFloat(
      fs.readFileSync('/proc/uptime', 'utf-8').split(' ')[0] ?? '0',
    )
    const clkTck = 100 // SC_CLK_TCK is almost always 100 on Linux
    const startSecs = startTicks / clkTck
    const nowSecs = Date.now() / 1000
    const bootTime = nowSecs - uptimeSecs
    return bootTime + startSecs
  } catch {
    return 0
  }
}

function listClaudeProcesses(): Array<CliAgentEntry> {
  let pids: Array<number>
  try {
    pids = fs
      .readdirSync('/proc')
      .map((d) => parseInt(d, 10))
      .filter((n) => !isNaN(n))
  } catch {
    return []
  }

  const result: Array<CliAgentEntry> = []

  for (const pid of pids) {
    const comm = readProcFile(pid, 'comm').trim()
    if (comm !== 'claude' && comm !== 'node') continue

    const cmdline = readProcFile(pid, 'cmdline')
    if (!cmdline) continue

    const args = cmdline.split('\0').filter(Boolean)
    // argv[0] must be a claude binary, or argv contains 'claude' as first meaningful token
    const isClaude =
      args[0]?.includes('claude') ||
      (args[1]?.includes('claude') && args[0]?.includes('node'))
    if (!isClaude) continue

    // Derive a task label from the --print or positional arg flags
    let task = 'Agent'
    const printIdx = args.indexOf('--print')
    if (printIdx !== -1 && args[printIdx + 1]) {
      task = args[printIdx + 1].slice(0, 80)
    } else {
      const positional = args.filter((a) => !a.startsWith('-') && !a.includes('claude')).join(' ')
      if (positional.trim()) task = positional.slice(0, 80)
    }

    const startedAt = getProcessStartSecs(pid)
    const runtimeSeconds =
      startedAt > 0 ? Math.max(0, Math.floor(Date.now() / 1000 - startedAt)) : 0

    result.push({
      pid,
      name: 'Claude',
      task: task.trim() || 'Running',
      runtimeSeconds,
      status: 'running',
    })
  }

  return result
}

export const Route = createFileRoute('/api/cli-agents')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const agents = listClaudeProcesses()
        return json({ ok: true, agents })
      },
    },
  },
})
