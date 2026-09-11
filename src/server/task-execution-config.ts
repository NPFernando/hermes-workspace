export const DEFAULT_MAX_CONCURRENT_EXECUTIONS = 5
export const MAX_ALLOWED_CONCURRENT_EXECUTIONS = 20

export function parseMaxConcurrentExecutions(
  value: string | undefined,
): number {
  if (!value?.trim()) return DEFAULT_MAX_CONCURRENT_EXECUTIONS
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_MAX_CONCURRENT_EXECUTIONS
  }
  return Math.min(parsed, MAX_ALLOWED_CONCURRENT_EXECUTIONS)
}
