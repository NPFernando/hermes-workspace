// Client-side counterpart of server/rate-limit.ts's safeErrorMessage. No
// production hiding here — this formats local UI state for the person
// already looking at their own screen, not a network response crossing a
// trust boundary.
export function safeErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
