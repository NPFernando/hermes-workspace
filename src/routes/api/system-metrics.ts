import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  ensureGatewayProbed,
  getConnectionStatus,
} from '../../server/gateway-capabilities'
import { getOpsCronJobs } from '../../server/ops-observability'
import { getSwarmDispatchQueueSnapshot } from '../../server/swarm-dispatch-queue'

type SystemMetricsResponse = {
  checkedAt: number
  cpu: {
    loadPercent: number
    loadAverage1m: number
    cores: number
  }
  memory: {
    usedBytes: number
    totalBytes: number
    usedPercent: number
  }
  disk: {
    path: string
    usedBytes: number
    totalBytes: number
    usedPercent: number
  }
  hermes: {
    status: 'connected' | 'enhanced' | 'partial' | 'disconnected'
    health: boolean
    dashboard: boolean
  }
  process: {
    uptimeSeconds: number
    pid: number
  }
  api: {
    windowMinutes: number
    requests: number
    errorCount: number
    errorRatePercent: number
    averageLatencyMs: number | null
    p95LatencyMs: number | null
    topRoutes: Array<{ path: string; requests: number; averageLatencyMs: number }>
  }
  jobs: {
    totalCronJobs: number | null
    failedCronJobs: number | null
    queueDepth: number | null
    queueRunning: number | null
    queueFailedRecent: number | null
  }
}

type HttpMetricSample = {
  at: number
  pathname: string
  method: string
  statusCode: number
  durationMs: number
}

type HttpMetricState = {
  startedAt: number
  samples: Array<HttpMetricSample>
}

function readHttpMetrics(now: number) {
  const state = (globalThis as typeof globalThis & {
    __hermesHttpMetrics?: HttpMetricState
  }).__hermesHttpMetrics
  const cutoff = now - 15 * 60 * 1000
  const samples = (state?.samples ?? []).filter(
    (sample) => sample.at >= cutoff && sample.pathname.startsWith('/api/'),
  )
  const durations = samples.map((sample) => sample.durationMs).sort((a, b) => a - b)
  const errorCount = samples.filter((sample) => sample.statusCode >= 400).length
  const percentile = (ratio: number) =>
    durations.length === 0
      ? null
      : durations[Math.min(durations.length - 1, Math.ceil(durations.length * ratio) - 1)]
  const routeMap = new Map<string, { requests: number; totalMs: number }>()
  for (const sample of samples) {
    const current = routeMap.get(sample.pathname) ?? { requests: 0, totalMs: 0 }
    current.requests += 1
    current.totalMs += sample.durationMs
    routeMap.set(sample.pathname, current)
  }
  return {
    windowMinutes: 15,
    requests: samples.length,
    errorCount,
    errorRatePercent: samples.length === 0 ? 0 : Math.round((errorCount / samples.length) * 1000) / 10,
    averageLatencyMs:
      durations.length === 0
        ? null
        : Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
    p95LatencyMs: percentile(0.95),
    topRoutes: [...routeMap.entries()]
      .sort((a, b) => b[1].requests - a[1].requests)
      .slice(0, 8)
      .map(([path, value]) => ({
        path,
        requests: value.requests,
        averageLatencyMs: Math.round(value.totalMs / value.requests),
      })),
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function cpuTotals() {
  // Sum busy and idle jiffies across every core. The ratio of busy-delta to
  // total-delta over a short window is true utilization — unlike load average,
  // which is a run-queue length (it counts I/O waiters and can exceed 100%).
  let busy = 0
  let idle = 0
  for (const cpu of os.cpus()) {
    busy += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq
    idle += cpu.times.idle
  }
  return { busy, idle }
}

async function readCpu() {
  const cores = Math.max(1, os.cpus().length)
  const loadAverage1m = os.loadavg()[0] ?? 0

  const start = cpuTotals()
  await delay(150)
  const end = cpuTotals()

  const busyDelta = end.busy - start.busy
  const totalDelta = busyDelta + (end.idle - start.idle)
  const loadPercent =
    totalDelta > 0 ? clampPercent((busyDelta / totalDelta) * 100) : 0

  return {
    loadPercent,
    loadAverage1m: Math.round(loadAverage1m * 100) / 100,
    cores,
  }
}

// On macOS, os.freemem() reports only truly-free pages (often near zero),
// because the kernel keeps inactive/speculative/purgeable pages populated as
// reclaimable cache. Treating that as "used" pins the gauge at ~100%. Parse
// vm_stat to count reclaimable pages as available, matching how Activity
// Monitor and `top` present memory pressure.
function readDarwinAvailableBytes(totalBytes: number): number | null {
  try {
    const output = execFileSync('vm_stat', { encoding: 'utf8', timeout: 1000 })

    const pageSizeMatch = output.match(/page size of (\d+) bytes/)
    const pageSize = pageSizeMatch ? Number(pageSizeMatch[1]) : 4096

    const pageStat = (label: string): number => {
      const match = output.match(new RegExp(`${label}:\\s+(\\d+)\\.`))
      return match ? Number(match[1]) : 0
    }

    const reclaimablePages =
      pageStat('Pages free') +
      pageStat('Pages inactive') +
      pageStat('Pages speculative') +
      pageStat('Pages purgeable')

    const availableBytes = reclaimablePages * pageSize
    if (!Number.isFinite(availableBytes) || availableBytes <= 0) return null
    return Math.min(availableBytes, totalBytes)
  } catch {
    return null
  }
}

function readMemory() {
  const totalBytes = os.totalmem()

  const availableBytes =
    process.platform === 'darwin' ? readDarwinAvailableBytes(totalBytes) : null

  const freeBytes = availableBytes ?? os.freemem()
  const usedBytes = Math.max(0, totalBytes - freeBytes)
  const usedPercent =
    totalBytes > 0 ? clampPercent((usedBytes / totalBytes) * 100) : 0

  return {
    usedBytes,
    totalBytes,
    usedPercent,
  }
}

function readDisk() {
  const diskPath =
    process.env.HERMES_WORKSPACE_METRICS_DISK_PATH || os.homedir()

  try {
    const stats = fs.statfsSync(diskPath)
    const totalBytes = stats.blocks * stats.bsize
    const freeBytes = stats.bavail * stats.bsize
    const usedBytes = Math.max(0, totalBytes - freeBytes)
    const usedPercent =
      totalBytes > 0 ? clampPercent((usedBytes / totalBytes) * 100) : 0

    return {
      path: diskPath,
      usedBytes,
      totalBytes,
      usedPercent,
    }
  } catch {
    return {
      path: diskPath,
      usedBytes: 0,
      totalBytes: 0,
      usedPercent: 0,
    }
  }
}

export const Route = createFileRoute('/api/system-metrics')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // isAuthenticated() returns boolean. Don't cast it to Response —
        // that throws at runtime. Match the pattern used by adjacent routes.
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        const [caps, cpu, queue, cronJobs] = await Promise.all([
          ensureGatewayProbed(),
          readCpu(),
          getSwarmDispatchQueueSnapshot().catch(() => null),
          Promise.resolve(getOpsCronJobs()),
        ])
        const status = getConnectionStatus()

        const body: SystemMetricsResponse = {
          checkedAt: Date.now(),
          cpu,
          memory: readMemory(),
          disk: readDisk(),
          hermes: {
            status,
            health: caps.health,
            dashboard: caps.dashboard.available,
          },
          process: {
            uptimeSeconds: Math.floor(process.uptime()),
            pid: process.pid,
          },
          api: readHttpMetrics(Date.now()),
          jobs: {
            totalCronJobs: cronJobs?.length ?? null,
            failedCronJobs:
              cronJobs?.filter((job) => /fail|error/i.test(job.lastStatus ?? '')).length ?? null,
            queueDepth: queue ? queue.waiting.length : null,
            queueRunning: queue?.active ? 1 : queue ? 0 : null,
            queueFailedRecent: queue
              ? queue.recent.filter((job) => job.status === 'failed').length
              : null,
          },
        }

        return Response.json(body)
      },
    },
  },
})
