import { useMemo, useState } from 'react'
import {
  
  deleteTemplate,
  getAllTemplates
} from '../lib/workflow-templates'
import type {WorkflowTemplate} from '../lib/workflow-templates';
import { cn } from '@/lib/utils'

type TemplatePickerProps = {
  onSelect: (template: WorkflowTemplate) => void
  onClose: () => void
}

const DEMO_TEMPLATES: Array<WorkflowTemplate> = [
  {
    id: 'tpl-code-review',
    name: 'Code Review',
    description: 'Review codebase for bugs, performance issues, and code quality',
    icon: '🔍',
    goal: 'Review the codebase for bugs, performance issues, and code quality',
    tasks: [
      { title: 'Analyze architecture and key code paths' },
      { title: 'Identify defects and performance bottlenecks' },
      { title: 'Summarize prioritized findings' },
    ],
    createdAt: 0,
    updatedAt: 0,
    isBuiltIn: true,
  },
  {
    id: 'tpl-feature-build',
    name: 'Feature Build',
    description: 'Plan and implement a new feature end-to-end',
    icon: '🏗️',
    goal: 'Plan, implement, test, and document the new feature',
    tasks: [
      { title: 'Break the feature into implementation steps' },
      { title: 'Build and integrate the feature' },
      { title: 'Validate behavior and document changes' },
    ],
    createdAt: 0,
    updatedAt: 0,
    isBuiltIn: true,
  },
  {
    id: 'tpl-audit',
    name: 'Security Audit',
    description: 'Audit codebase for security risks and mitigations',
    icon: '🛡️',
    goal: 'Perform a security audit: check dependencies, secrets exposure, input validation',
    tasks: [
      { title: 'Audit dependencies and known vulnerabilities' },
      { title: 'Scan for exposed secrets and credentials' },
      { title: 'Review input validation and sanitization paths' },
    ],
    createdAt: 0,
    updatedAt: 0,
    isBuiltIn: true,
  },
]

export function TemplatePicker({ onSelect, onClose }: TemplatePickerProps) {
  const [search, setSearch] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const templates = useMemo(() => {
    void refreshKey // Force re-read on delete
    const allTemplates = [...DEMO_TEMPLATES, ...getAllTemplates()]
    return allTemplates.filter((template, index, list) => (
      list.findIndex((candidate) => candidate.id === template.id) === index
    ))
  }, [refreshKey])

  const filtered = useMemo(() => {
    if (!search) return templates
    const q = search.toLowerCase()
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.goal.toLowerCase().includes(q),
    )
  }, [templates, search])

  const builtIn = filtered.filter((t) => t.isBuiltIn)
  const custom = filtered.filter((t) => !t.isBuiltIn)

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-5 py-4">
          <h2 className="text-base font-semibold text-[var(--theme-text)] dark:text-white">
            Mission Templates
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--theme-muted)] transition-colors hover:bg-[var(--theme-card2)] hover:text-[var(--theme-muted)]"
          >
            ✕
          </button>
        </div>

        <div className="px-5 pt-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates..."
            className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] placeholder:text-[var(--theme-muted)] focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:text-white"
            autoFocus
          />
        </div>

        <div className="max-h-[400px] overflow-y-auto px-5 py-4">
          {builtIn.length > 0 && (
            <>
              <p className="mb-2 micro-label">
                Built-in
              </p>
              <div className="grid gap-2">
                {builtIn.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </>
          )}

          {custom.length > 0 && (
            <>
              <p className="mb-2 mt-4 micro-label">
                Custom
              </p>
              <div className="grid gap-2">
                {custom.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    onSelect={onSelect}
                    onDelete={() => {
                      deleteTemplate(template.id)
                      setRefreshKey((k) => k + 1)
                    }}
                  />
                ))}
              </div>
            </>
          )}

          {filtered.length === 0 && (
            <p className="py-8 text-center text-sm text-[var(--theme-muted)]">
              No templates found
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function TemplateCard({
  template,
  onSelect,
  onDelete,
}: {
  template: WorkflowTemplate
  onSelect: (t: WorkflowTemplate) => void
  onDelete?: () => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(template)}
      className={cn(
        'group w-full rounded-xl border p-3 text-left transition-all',
        'border-[var(--theme-border)] bg-[var(--theme-card)] hover:border-sky-400/60 hover:bg-[var(--theme-card2)]',
        'hover:border-sky-500 hover:bg-sky-500/10',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 text-xl">{template.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--theme-text)] dark:text-white">
              {template.name}
            </span>
            {template.tasks.length > 0 && (
              <span className="rounded-full bg-[var(--theme-card2)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--theme-muted)]">
                {template.tasks.length} tasks
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-[var(--theme-muted)]">
            {template.description}
          </p>
        </div>
        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="shrink-0 rounded p-2.5 sm:p-1 text-xs touch-manipulation text-[var(--theme-muted)] opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100 [@media(hover:none)]:opacity-80"
          >
            🗑
          </button>
        )}
      </div>
    </button>
  )
}
