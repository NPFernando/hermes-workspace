import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon, Copy01Icon, DownloadIcon, PencilEdit01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import type { InlineArtifact } from './message-item'
import { CodeBlock } from '@/components/prompt-kit/code-block'
import { Markdown } from '@/components/prompt-kit/markdown'
import { writeTextToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

function artifactLanguage(type: string): string {
  if (type === 'js' || type === 'javascript') return 'javascript'
  if (type === 'ts' || type === 'typescript') return 'typescript'
  if (type === 'md') return 'markdown'
  if (type === 'py') return 'python'
  return type
}

function inferDownloadFilename(title: string, type: string): string {
  const safe = title.replace(/[^a-z0-9_\-. ]/gi, '').trim().replace(/\s+/g, '-') || 'artifact'
  const extMap: Record<string, string> = {
    html: 'html', svg: 'svg', markdown: 'md', md: 'md',
    javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts',
    python: 'py', py: 'py', json: 'json', yaml: 'yaml', yml: 'yaml',
    css: 'css', sql: 'sql', bash: 'sh', sh: 'sh', dockerfile: 'dockerfile',
  }
  const ext = extMap[type.toLowerCase()] ?? 'txt'
  return `${safe}.${ext}`
}

function ArtifactBody({ artifact, showSource }: { artifact: InlineArtifact; showSource: boolean }) {
  if ((artifact.type === 'html' || artifact.type === 'svg') && !showSource) {
    return (
      <iframe
        title={artifact.title}
        sandbox="allow-scripts"
        srcDoc={artifact.content}
        className="h-full w-full border-0"
        style={{ background: 'white' }}
      />
    )
  }

  if ((artifact.type === 'markdown' || artifact.type === 'md') && !showSource) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <Markdown className="text-sm">{artifact.content}</Markdown>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-3">
      <CodeBlock
        content={artifact.content}
        language={artifactLanguage(artifact.type)}
        className="my-0 h-full"
      />
    </div>
  )
}

type ArtifactPanelProps = {
  artifacts: Array<InlineArtifact>
  activeIndex: number
  onTabChange: (index: number) => void
  onClose: () => void
}

export function ArtifactPanel({ artifacts, activeIndex, onTabChange, onClose }: ArtifactPanelProps) {
  const artifact = artifacts[activeIndex]
  const [showSource, setShowSource] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState('')

  useEffect(() => {
    setIsEditing(false)
    setEditedContent(artifact?.content ?? '')
  }, [artifact])

  if (!artifact) return null

  const canToggleSource = artifact.type === 'html' || artifact.type === 'svg' || artifact.type === 'markdown' || artifact.type === 'md'
  const activeContent = isEditing ? editedContent : artifact.content

  async function handleCopy() {
    try {
      await writeTextToClipboard(activeContent)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  function handleDownload() {
    const filename = inferDownloadFilename(artifact.title, artifact.type)
    const blob = new Blob([activeContent], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div
      className="flex h-full flex-col border-l"
      style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-bg)' }}
    >
      {/* Header */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={artifact.title}>
          {artifact.title}
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide shrink-0"
          style={{ background: 'var(--theme-card2)', color: 'var(--theme-muted)' }}
        >
          {artifact.type}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-1 shrink-0 rounded p-1 text-primary-400 hover:bg-primary-100 hover:text-primary-700 dark:hover:bg-primary-800 transition-colors"
          aria-label="Close artifact panel"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={1.6} />
        </button>
      </div>

      {/* Tab strip for multiple artifacts */}
      {artifacts.length > 1 && (
        <div
          className="flex shrink-0 gap-0.5 overflow-x-auto border-b px-2 py-1.5"
          style={{ borderColor: 'var(--theme-border)' }}
        >
          {artifacts.map((a, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onTabChange(i)}
              className={cn(
                'shrink-0 rounded px-2.5 py-1 text-xs transition-colors',
                i === activeIndex
                  ? 'bg-accent-500/10 text-accent-600 font-medium'
                  : 'text-primary-500 hover:bg-primary-100 dark:hover:bg-primary-800',
              )}
            >
              {a.title.length > 20 ? `${a.title.slice(0, 18)}…` : a.title}
            </button>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {isEditing ? (
          <textarea
            className="h-full w-full resize-none border-0 bg-transparent p-4 font-mono text-sm text-primary-900 dark:text-primary-100 outline-none focus:ring-0"
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        ) : (
          <ArtifactBody artifact={artifact} showSource={showSource} />
        )}
      </div>

      {/* Footer actions */}
      <div
        className="flex shrink-0 items-center gap-1.5 border-t px-3 py-2"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        {!isEditing && canToggleSource && (
          <button
            type="button"
            onClick={() => setShowSource((v) => !v)}
            className="rounded px-2 py-1 text-xs text-primary-500 hover:bg-primary-100 dark:hover:bg-primary-800 transition-colors"
          >
            {showSource ? 'Preview' : 'Source'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setIsEditing((v) => !v)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
            isEditing
              ? 'bg-accent-500/10 text-accent-600 font-medium'
              : 'text-primary-500 hover:bg-primary-100 dark:hover:bg-primary-800',
          )}
          title={isEditing ? 'Done editing' : 'Edit content'}
        >
          <HugeiconsIcon icon={PencilEdit01Icon} size={13} strokeWidth={1.6} />
          {isEditing ? 'Done' : 'Edit'}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => { handleCopy().catch(() => {}) }}
          className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-primary-500 hover:bg-primary-100 dark:hover:bg-primary-800 transition-colors"
        >
          <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={14} strokeWidth={1.6} />
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-primary-500 hover:bg-primary-100 dark:hover:bg-primary-800 transition-colors"
          title="Download file"
        >
          <HugeiconsIcon icon={DownloadIcon} size={14} strokeWidth={1.6} />
          Download
        </button>
      </div>
    </div>
  )
}
