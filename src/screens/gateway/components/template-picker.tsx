import { useEffect, useMemo, useRef, useState } from 'react'
import {
  deleteWorkflowTemplate,
  duplicateWorkflowTemplateRemote,
  exportCustomWorkflowTemplates,
  getAllTemplates,
  importWorkflowTemplatesFromJson,
  loadWorkflowTemplates,
  updateWorkflowTemplateRemote,
} from '../lib/workflow-templates'
import type { WorkflowTemplate } from '../lib/workflow-templates'
import { cn } from '@/lib/utils'

type TemplatePickerProps = {
  onSelect: (template: WorkflowTemplate) => void
  onClose: () => void
}

type TemplateEditDraft = {
  name: string
  description: string
  icon: string
  goal: string
  tags: string
  tasks: string
}

function taskLines(template: WorkflowTemplate): string {
  return template.tasks
    .map((task) =>
      task.description ? `${task.title} :: ${task.description}` : task.title,
    )
    .join('\n')
}

function parseTaskLines(value: string): WorkflowTemplate['tasks'] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [title, ...descriptionParts] = line.split('::')
      const cleanTitle = title.trim()
      const description = descriptionParts.join('::').trim()
      return description
        ? { title: cleanTitle, description }
        : { title: cleanTitle }
    })
}

export function TemplatePicker({ onSelect, onClose }: TemplatePickerProps) {
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [search, setSearch] = useState('')
  const [templates, setTemplates] = useState<Array<WorkflowTemplate>>(() =>
    getAllTemplates(),
  )
  const [templateTransferStatus, setTemplateTransferStatus] = useState<
    string | null
  >(null)
  const [editingTemplate, setEditingTemplate] =
    useState<WorkflowTemplate | null>(null)
  const [editDraft, setEditDraft] = useState<TemplateEditDraft | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)

  useEffect(() => {
    let cancelled = false

    const loadTemplates = async () => {
      const nextTemplates = await loadWorkflowTemplates()
      if (!cancelled) setTemplates(nextTemplates)
    }

    void loadTemplates()

    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    if (!search) return templates
    const q = search.toLowerCase()
    return templates.filter(
      (template) =>
        template.name.toLowerCase().includes(q) ||
        template.description.toLowerCase().includes(q) ||
        template.goal.toLowerCase().includes(q) ||
        template.tags?.some((tag) => tag.toLowerCase().includes(q)),
    )
  }, [templates, search])

  const builtIn = filtered.filter((template) => template.isBuiltIn)
  const custom = filtered.filter((template) => !template.isBuiltIn)
  const hasCustomTemplates = templates.some((template) => !template.isBuiltIn)

  const handleExportTemplates = () => {
    const payload = exportCustomWorkflowTemplates()
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `workflow-templates-${new Date().toISOString().slice(0, 10)}.json`
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    setTemplateTransferStatus('Exported custom workflow templates')
  }

  const handleImportTemplates = async (file: File | null) => {
    if (!file) return
    try {
      const result = await importWorkflowTemplatesFromJson(await file.text())
      setTemplates(result.templates)
      setTemplateTransferStatus(
        `Imported ${result.imported} template${result.imported === 1 ? '' : 's'}${result.skipped > 0 ? ` · skipped ${result.skipped}` : ''}`,
      )
    } catch (error) {
      setTemplateTransferStatus(
        error instanceof Error ? error.message : 'Template import failed',
      )
    } finally {
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  const handleDuplicateTemplate = async (template: WorkflowTemplate) => {
    try {
      const updatedTemplates = await duplicateWorkflowTemplateRemote(template)
      setTemplates(updatedTemplates)
      setTemplateTransferStatus(`Duplicated ${template.name}`)
    } catch (error) {
      setTemplateTransferStatus(
        error instanceof Error ? error.message : 'Template duplicate failed',
      )
    }
  }

  const openEditTemplate = (template: WorkflowTemplate) => {
    setEditingTemplate(template)
    setEditDraft({
      name: template.name,
      description: template.description,
      icon: template.icon,
      goal: template.goal,
      tags: template.tags?.join(', ') ?? '',
      tasks: taskLines(template),
    })
    setEditError(null)
  }

  const closeEditTemplate = () => {
    if (isSavingEdit) return
    setEditingTemplate(null)
    setEditDraft(null)
    setEditError(null)
  }

  const handleSaveEditedTemplate = async () => {
    if (!editingTemplate || !editDraft || isSavingEdit) return
    const name = editDraft.name.trim()
    const description = editDraft.description.trim()
    const goal = editDraft.goal.trim()
    const icon = editDraft.icon.trim() || '⚙️'
    const tasks = parseTaskLines(editDraft.tasks)

    if (!name || !description || !goal) {
      setEditError('Name, description, and goal are required')
      return
    }

    setIsSavingEdit(true)
    setEditError(null)
    try {
      const updatedTemplates = await updateWorkflowTemplateRemote({
        ...editingTemplate,
        name,
        description,
        icon,
        goal,
        tags: editDraft.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        tasks,
      })
      setTemplates(updatedTemplates)
      setTemplateTransferStatus(`Updated ${name}`)
      setEditingTemplate(null)
      setEditDraft(null)
      setEditError(null)
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : 'Template update failed',
      )
    } finally {
      setIsSavingEdit(false)
    }
  }

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
            aria-label="Close mission templates"
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
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] transition-colors hover:border-sky-400/60 hover:bg-[var(--theme-card2)]"
            >
              Import JSON
            </button>
            <button
              type="button"
              onClick={handleExportTemplates}
              disabled={!hasCustomTemplates}
              className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] transition-colors hover:border-sky-400/60 hover:bg-[var(--theme-card2)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Export Custom
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) =>
                void handleImportTemplates(
                  event.currentTarget.files?.[0] ?? null,
                )
              }
            />
            {templateTransferStatus ? (
              <p className="text-xs text-[var(--theme-muted)]">
                {templateTransferStatus}
              </p>
            ) : null}
          </div>
        </div>

        <div className="max-h-[400px] overflow-y-auto px-5 py-4">
          {builtIn.length > 0 && (
            <>
              <p className="mb-2 micro-label">Built-in</p>
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
              <p className="mb-2 mt-4 micro-label">Custom</p>
              <div className="grid gap-2">
                {custom.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    onSelect={onSelect}
                    onEdit={() => openEditTemplate(template)}
                    onDuplicate={() => void handleDuplicateTemplate(template)}
                    onDelete={() => {
                      setTemplates((current) =>
                        current.filter((item) => item.id !== template.id),
                      )
                      void deleteWorkflowTemplate(template.id)
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

        {editingTemplate && editDraft ? (
          <TemplateEditModal
            draft={editDraft}
            error={editError}
            isSaving={isSavingEdit}
            onChange={(patch) =>
              setEditDraft((current) =>
                current ? { ...current, ...patch } : current,
              )
            }
            onClose={closeEditTemplate}
            onSave={() => void handleSaveEditedTemplate()}
          />
        ) : null}
      </div>
    </div>
  )
}

function TemplateCard({
  template,
  onSelect,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  template: WorkflowTemplate
  onSelect: (template: WorkflowTemplate) => void
  onEdit?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
}) {
  return (
    <div
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
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={() => onSelect(template)}
            className="rounded px-2 py-1 text-xs font-medium text-[var(--theme-muted)] hover:bg-sky-500/10 hover:text-sky-400 focus:bg-sky-500/10 focus:text-sky-400 focus:outline-none"
            aria-label={`Use ${template.name} template`}
          >
            Select
          </button>
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="rounded p-1 text-xs text-[var(--theme-muted)] hover:text-sky-400 focus:text-sky-400 focus:outline-none"
              aria-label={`Edit ${template.name} template`}
            >
              ✎
            </button>
          ) : null}
          {onDuplicate ? (
            <button
              type="button"
              onClick={onDuplicate}
              className="rounded p-1 text-xs text-[var(--theme-muted)] hover:text-emerald-400 focus:text-emerald-400 focus:outline-none"
              aria-label={`Duplicate ${template.name} template`}
            >
              ⧉
            </button>
          ) : null}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="rounded p-1 text-xs text-[var(--theme-muted)] hover:text-red-400 focus:text-red-400 focus:outline-none"
              aria-label={`Delete ${template.name} template`}
            >
              🗑
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function TemplateEditModal({
  draft,
  error,
  isSaving,
  onChange,
  onClose,
  onSave,
}: {
  draft: TemplateEditDraft
  error: string | null
  isSaving: boolean
  onChange: (patch: Partial<TemplateEditDraft>) => void
  onClose: () => void
  onSave: () => void
}) {
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-[var(--theme-text)] dark:text-white">
              Edit custom template
            </h3>
            <p className="mt-1 text-xs text-[var(--theme-muted)]">
              Tasks use one line each. Add optional descriptions with “::”.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--theme-muted)] transition-colors hover:bg-[var(--theme-card2)] disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Close template editor"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 grid gap-3">
          <label className="grid gap-1 text-xs font-medium text-[var(--theme-muted)]">
            Name
            <input
              value={draft.name}
              onChange={(event) =>
                onChange({ name: event.currentTarget.value })
              }
              className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none focus:border-sky-500"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-[var(--theme-muted)]">
            Description
            <input
              value={draft.description}
              onChange={(event) =>
                onChange({ description: event.currentTarget.value })
              }
              className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none focus:border-sky-500"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-[96px_1fr]">
            <label className="grid gap-1 text-xs font-medium text-[var(--theme-muted)]">
              Icon
              <input
                value={draft.icon}
                onChange={(event) =>
                  onChange({ icon: event.currentTarget.value })
                }
                className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-[var(--theme-muted)]">
              Tags
              <input
                value={draft.tags}
                onChange={(event) =>
                  onChange({ tags: event.currentTarget.value })
                }
                placeholder="build, conductor, mission"
                className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none placeholder:text-[var(--theme-muted)] focus:border-sky-500"
              />
            </label>
          </div>
          <label className="grid gap-1 text-xs font-medium text-[var(--theme-muted)]">
            Goal
            <textarea
              value={draft.goal}
              onChange={(event) =>
                onChange({ goal: event.currentTarget.value })
              }
              rows={3}
              className="resize-none rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none focus:border-sky-500"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-[var(--theme-muted)]">
            Tasks
            <textarea
              value={draft.tasks}
              onChange={(event) =>
                onChange({ tasks: event.currentTarget.value })
              }
              rows={6}
              className="resize-none rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none focus:border-sky-500"
            />
          </label>
        </div>

        {error ? (
          <p className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-4 py-2 text-sm text-[var(--theme-text)] hover:bg-[var(--theme-card2)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
