import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTaskExecLog } from './use-task-exec-log'
import type { ClaudeTask } from '@/lib/tasks-api'

export function SkeletonCard() {
  return (
    <div className="skeleton-shimmer rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] p-3">
      <div className="h-3.5 bg-[var(--theme-hover)] rounded w-3/4 mb-2" />
      <div className="h-2.5 bg-[var(--theme-hover)] rounded w-full mb-1" />
      <div className="h-2.5 bg-[var(--theme-hover)] rounded w-2/3 mb-3" />
      <div className="flex gap-1.5">
        <div className="h-4 w-12 bg-[var(--theme-hover)] rounded" />
        <div className="h-4 w-10 bg-[var(--theme-hover)] rounded" />
      </div>
    </div>
  )
}

export const VIRTUAL_THRESHOLD = 40
const CARD_ESTIMATE_PX = 96

export type VirtualRow =
  | { kind: 'task'; task: ClaudeTask }
  | { kind: 'group-header'; label: string; count: number; groupId: string; collapsed: boolean; onToggle: () => void }
  | { kind: 'divider'; label?: string }

export function VirtualTaskList({
  tasks,
  rows,
  renderCard,
  sectionBreak,
  sectionLabels,
}: {
  tasks: Array<ClaudeTask>
  rows?: Array<VirtualRow>
  renderCard: (task: ClaudeTask) => React.ReactNode
  sectionBreak?: number
  sectionLabels?: [string, string]
}) {
  const parentRef = useRef<HTMLDivElement>(null)

  if (rows) {
    return <VirtualRowList parentRef={parentRef} rows={rows} renderCard={renderCard} />
  }

  return (
    <FlatVirtualTaskList
      parentRef={parentRef}
      tasks={tasks}
      renderCard={renderCard}
      sectionBreak={sectionBreak}
      sectionLabels={sectionLabels}
    />
  )
}

function FlatVirtualTaskList({
  parentRef,
  tasks,
  renderCard,
  sectionBreak,
  sectionLabels,
}: {
  parentRef: React.RefObject<HTMLDivElement | null>
  tasks: Array<ClaudeTask>
  renderCard: (task: ClaudeTask) => React.ReactNode
  sectionBreak?: number
  sectionLabels?: [string, string]
}) {
  const hasDivider = sectionBreak != null && sectionBreak > 0 && sectionBreak < tasks.length
  const totalItems = tasks.length + (hasDivider ? 1 : 0)
  const virtualizer = useVirtualizer({
    count: totalItems,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => {
      if (hasDivider && i === sectionBreak) return 28
      return CARD_ESTIMATE_PX
    },
    overscan: 5,
    gap: 8,
  })
  const items = virtualizer.getVirtualItems()

  return (
    <div ref={parentRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-2">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${items[0]?.start ?? 0}px)` }}>
          {items.map(vItem => {
            if (hasDivider && vItem.index === sectionBreak) {
              return (
                <div key="__divider__" data-index={vItem.index} ref={virtualizer.measureElement} className="mt-2 mb-1">
                  <div className="flex items-center gap-2 px-1">
                    <div className="flex-1 h-px bg-[var(--theme-border)]" />
                    <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--theme-muted)] opacity-50 whitespace-nowrap">
                      {sectionLabels?.[1] ?? 'Stubs'}
                    </span>
                    <div className="flex-1 h-px bg-[var(--theme-border)]" />
                  </div>
                </div>
              )
            }
            const taskIdx = hasDivider && vItem.index > (sectionBreak ?? 0) ? vItem.index - 1 : vItem.index
            const task = tasks[taskIdx]
            return (
              <div key={task.id} data-index={vItem.index} ref={virtualizer.measureElement} className={vItem.index > 0 ? 'mt-2' : ''}>
                {renderCard(task)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function VirtualRowList({ parentRef, rows, renderCard }: {
  parentRef: React.RefObject<HTMLDivElement | null>
  rows: Array<VirtualRow>
  renderCard: (task: ClaudeTask) => React.ReactNode
}) {
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => {
      const row = rows[i]
      if (!row) return CARD_ESTIMATE_PX
      if (row.kind === 'group-header') return 32
      if (row.kind === 'divider') return 24
      return CARD_ESTIMATE_PX
    },
    overscan: 5,
    gap: 8,
  })
  const items = virtualizer.getVirtualItems()

  return (
    <div ref={parentRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-2">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${items[0]?.start ?? 0}px)` }}>
          {items.map(vItem => {
            const row = rows[vItem.index]
            if (!row) return null
            if (row.kind === 'group-header') {
              return (
                <div key={`gh-${row.groupId}`} data-index={vItem.index} ref={virtualizer.measureElement} className="mt-1 mb-0.5">
                  <button
                    type="button"
                    onClick={row.onToggle}
                    className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--theme-hover)] transition-colors group"
                  >
                    <span className="text-[10px] text-[var(--theme-muted)] transition-transform" style={{ display: 'inline-block', transform: row.collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▾</span>
                    <span className="flex-1 text-left text-[10px] font-semibold text-[var(--theme-text)] truncate">{row.label}</span>
                    <span className="text-[9px] text-[var(--theme-muted)] opacity-60 shrink-0">{row.count}</span>
                  </button>
                </div>
              )
            }
            if (row.kind === 'divider') {
              return (
                <div key={`div-${vItem.index}`} data-index={vItem.index} ref={virtualizer.measureElement} className="mt-2 mb-1">
                  <div className="flex items-center gap-2 px-1">
                    <div className="flex-1 h-px bg-[var(--theme-border)]" />
                    {row.label && <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--theme-muted)] opacity-50 whitespace-nowrap">{row.label}</span>}
                    <div className="flex-1 h-px bg-[var(--theme-border)]" />
                  </div>
                </div>
              )
            }
            return (
              <div key={row.task.id} data-index={vItem.index} ref={virtualizer.measureElement} className={vItem.index > 0 ? 'mt-2' : ''}>
                {renderCard(row.task)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function RunningTaskRow({ task, onOpen }: { task: ClaudeTask; onOpen: () => void }) {
  const fullLog = useTaskExecLog(task.id)
  const log = fullLog.split('\n').slice(-4).join('\n')

  return (
    <div className="px-3 py-2 flex gap-3 items-start">
      <div className="flex-1 min-w-0">
        <button type="button" onClick={onOpen} className="text-[10px] font-medium text-violet-300 hover:text-violet-200 truncate max-w-full text-left transition-colors">
          {task.title.slice(0, 70)}
        </button>
        {log && (
          <pre className="mt-0.5 text-[9px] text-[var(--theme-muted)] font-mono leading-relaxed whitespace-pre-wrap break-all line-clamp-3 opacity-70">
            {log.split('\n').slice(-3).join('\n')}
          </pre>
        )}
      </div>
      <span className="shrink-0 text-[9px] text-violet-500 opacity-60 capitalize">{task.assignee ?? 'astra'}</span>
    </div>
  )
}
