#!/usr/bin/env node
/**
 * Bounded post-restart canary. It samples the public root only, records
 * latency/error rate, and exits non-zero so deploy.sh's rollback trap can
 * restore the previous artifact when the new process is unhealthy.
 */
const baseUrl = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '')
const requests = Math.max(3, Number(process.env.CANARY_REQUESTS || 5))
const maxErrorRate = Math.min(
  1,
  Math.max(0, Number(process.env.CANARY_MAX_ERROR_RATE || 0)),
)
const maxP95Ms = Math.max(1, Number(process.env.CANARY_MAX_P95_MS || 1500))
const timeoutMs = Math.max(100, Number(process.env.CANARY_TIMEOUT_MS || 5000))
const latencies = []
let failures = 0

for (let index = 0; index < requests; index += 1) {
  const started = performance.now()
  try {
    const response = await fetch(`${baseUrl}/`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
    latencies.push(performance.now() - started)
    if (!response.ok) failures += 1
  } catch {
    latencies.push(performance.now() - started)
    failures += 1
  }
}

const sorted = [...latencies].sort((a, b) => a - b)
const p95 =
  sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] || 0
const errorRate = failures / requests
const report = {
  ok: errorRate <= maxErrorRate && p95 <= maxP95Ms,
  baseUrl,
  requests,
  failures,
  errorRate,
  p95Ms: Math.round(p95),
  thresholds: { maxErrorRate, maxP95Ms, timeoutMs },
}
console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exitCode = 1
