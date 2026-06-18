import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { writeTextToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

type DiffLineType = 'add' | 'remove' | 'hunk' | 'file' | 'normal'

function classifyLine(line: string): DiffLineType {
  if (line.startsWith('+++') || line.startsWith('---')) return 'file'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'remove'
  return 'normal'
}

const LINE_STYLES: Record<DiffLineType, string> = {
  add: 'bg-green-50 text-green-900 dark:bg-green-950/40 dark:text-green-200',
  remove: 'bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200',
  hunk: 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300 font-medium',
  file: 'text-primary-500 font-semibold',
  normal: 'text-primary-800 dark:text-primary-200',
}

const LINE_PREFIX_STYLES: Record<DiffLineType, string> = {
  add: 'text-green-600 dark:text-green-400 select-none w-5 shrink-0 text-center',
  remove: 'text-red-500 dark:text-red-400 select-none w-5 shrink-0 text-center',
  hunk: 'w-5 shrink-0',
  file: 'w-5 shrink-0',
  normal: 'text-primary-400 select-none w-5 shrink-0 text-center',
}

export function DiffBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  const lines = code.split('\n')

  async function handleCopy() {
    try {
      await writeTextToClipboard(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div
      className="my-2 overflow-hidden rounded-lg border text-xs font-mono"
      style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-bg)' }}
    >
      {/* Header bar */}
      <div
        className="flex items-center justify-between border-b px-3 py-1.5"
        style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-card2)' }}
      >
        <span className="text-[10px] uppercase tracking-wider text-primary-400 font-medium">diff</span>
        <button
          type="button"
          onClick={() => { handleCopy().catch(() => {}) }}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-primary-500 hover:bg-primary-100 dark:hover:bg-primary-800 transition-colors"
        >
          <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={12} strokeWidth={1.6} />
          <span className="text-[10px]">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>

      {/* Lines */}
      <div className="overflow-x-auto">
        <div className="min-w-0 py-1">
          {lines.map((line, i) => {
            const type = classifyLine(line)
            return (
              <div
                key={i}
                className={cn('flex items-start gap-1 px-2 py-px leading-5', LINE_STYLES[type])}
              >
                <span className={LINE_PREFIX_STYLES[type]}>
                  {type === 'add' ? '+' : type === 'remove' ? '−' : ''}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre">{type === 'add' || type === 'remove' ? line.slice(1) : line}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
