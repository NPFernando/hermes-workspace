import type { ClaudeTask } from '@/lib/tasks-api'
import type { VirtualRow } from './virtual-task-list'

export function buildGroupedTodoRows(
  todoTasks: Array<ClaudeTask>,
  allTasks: Array<ClaudeTask>,
  collapsedGroups: ReadonlySet<string>,
  onToggle: (groupId: string) => void,
): Array<VirtualRow> {
  const allById = new Map(allTasks.map((task) => [task.id, task]))
  const parentGroups = new Map<
    string,
    { label: string; items: Array<ClaudeTask> }
  >()
  const byAssignee = new Map<string, Array<ClaudeTask>>()

  for (const task of todoTasks) {
    const parentId = task.depends_on?.[0]
    if (parentId && allById.has(parentId)) {
      const parent = allById.get(parentId)!
      if (!parentGroups.has(parentId))
        parentGroups.set(parentId, { label: parent.title, items: [] })
      parentGroups.get(parentId)!.items.push(task)
      continue
    }

    const assignee = task.assignee ?? 'unassigned'
    if (!byAssignee.has(assignee)) byAssignee.set(assignee, [])
    byAssignee.get(assignee)!.push(task)
  }

  const rows: Array<VirtualRow> = []
  const addGroup = (
    groupId: string,
    label: string,
    items: Array<ClaudeTask>,
  ) => {
    const collapsed = collapsedGroups.has(groupId)
    rows.push({
      kind: 'group-header',
      label,
      count: items.length,
      groupId,
      collapsed,
      onToggle: () => onToggle(groupId),
    })
    if (!collapsed) items.forEach((task) => rows.push({ kind: 'task', task }))
  }

  for (const [parentId, { label, items }] of parentGroups) {
    addGroup(parentId, label, items)
  }

  const sortedAssignees = [...byAssignee.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )
  for (const [assignee, items] of sortedAssignees) {
    addGroup(`__asgn__${assignee}`, assignee, items)
  }

  return rows
}
