import { useQuery } from '@tanstack/react-query'

type TaskExecLogResponse = { ok?: boolean; found?: boolean; log?: string }

// Shared by RunningTaskRow (tasks-screen.tsx) and ExecLogTail (task-dialog.tsx).
// Both used to poll /api/tasks-exec-log independently every 6s for the same
// task when a running task's row and its dialog were both open at once —
// react-query dedupes identical queryKeys, so mounting both now shares one
// poll instead of firing two.
const LINES = 25

export function useTaskExecLog(taskId: string) {
  const query = useQuery({
    queryKey: ['tasks-exec-log', taskId],
    queryFn: async () => {
      const res = await fetch(
        `/api/tasks-exec-log?task_id=${encodeURIComponent(taskId)}&lines=${LINES}`,
      )
      if (!res.ok) return ''
      const data = (await res.json()) as TaskExecLogResponse
      return data.ok && data.found && data.log ? data.log : ''
    },
    refetchInterval: 6_000,
    staleTime: 3_000,
    enabled: Boolean(taskId),
  })
  return query.data ?? ''
}
