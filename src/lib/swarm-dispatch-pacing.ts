export type PacingTask = {
  workerId: string
  task: string
}

export type PacingPreviewItem = PacingTask & {
  position: number
  total: number
}

/** Advisory ordering only; this does not serialize or execute worker dispatches. */
export function buildPacingPreview(
  tasks: Array<PacingTask>,
): Array<PacingPreviewItem> {
  return tasks
    .filter((task) => task.workerId.trim() && task.task.trim())
    .map((task, index, filtered) => ({
      workerId: task.workerId,
      task: task.task,
      position: index + 1,
      total: filtered.length,
    }))
}
