import { useEffect, useMemo, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowExpandDiagonalIcon, Copy01Icon, DownloadIcon, Tick02Icon } from '@hugeicons/core-free-icons'
import { createHighlighterCore } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import { LANG_LOADERS, formatLanguageName, normalizeLanguage, resolveLanguage } from './utils'
import type { HighlighterCore } from 'shiki/core'
import { useResolvedTheme } from '@/hooks/use-chat-settings'
import { writeTextToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type CodeBlockProps = {
  content: string
  ariaLabel?: string
  language?: string
  className?: string
  /** When provided, shows an expand icon button that calls this callback */
  onExpand?: () => void
}

const LANG_FILENAME_MAP: Record<string, string> = {
  bash: 'script.sh', sh: 'script.sh',
  python: 'script.py', py: 'script.py',
  javascript: 'script.js', js: 'script.js',
  typescript: 'script.ts', ts: 'script.ts',
  json: 'data.json',
  yaml: 'config.yaml', yml: 'config.yaml',
  html: 'page.html',
  css: 'styles.css',
  sql: 'query.sql',
  dockerfile: 'Dockerfile',
  powershell: 'script.ps1', ps1: 'script.ps1',
  kotlin: 'Script.kt',
  java: 'Script.java',
  xml: 'data.xml',
  markdown: 'document.md', md: 'document.md',
  toml: 'config.toml', ini: 'config.ini',
  rust: 'main.rs', go: 'main.go', cpp: 'main.cpp', c: 'main.c',
}

function inferDownloadFilename(lang: string): string {
  return LANG_FILENAME_MAP[lang.toLowerCase()] ?? 'code.txt'
}

let highlighterPromise: Promise<HighlighterCore> | null = null

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [
        import('shiki/themes/vitesse-light.mjs'),
        import('shiki/themes/vitesse-dark.mjs'),
      ],
      langs: [],
      engine: createOnigurumaEngine(import('shiki/wasm')),
    })
  }
  return highlighterPromise
}

export function CodeBlock({
  content,
  ariaLabel,
  language = 'text',
  className,
  onExpand,
}: CodeBlockProps) {
  const resolvedTheme = useResolvedTheme()
  const [copied, setCopied] = useState(false)
  const [showLineNumbers, setShowLineNumbers] = useState(false)
  const [html, setHtml] = useState<string | null>(null)
  const [resolvedLanguage, setResolvedLanguage] = useState('text')
  const [headerBg, setHeaderBg] = useState<string | undefined>()

  const fallback = useMemo(() => {
    return content
  }, [content])

  const normalizedLanguage = normalizeLanguage(language || 'text')
  const themeName = resolvedTheme === 'dark' ? 'vitesse-dark' : 'vitesse-light'
  const lineCount = useMemo(
    () => Math.max(1, content.split('\n').length),
    [content],
  )
  const canShowLineNumbers = lineCount > 1

  useEffect(() => {
    let active = true
    getHighlighter()
      .then(async (highlighter) => {
        let lang = resolveLanguage(normalizedLanguage)
        if (lang !== 'text') {
          try {
            const loader = LANG_LOADERS[lang]
            if (loader) await highlighter.loadLanguage(await loader())
          } catch {
            lang = 'text'
          }
        }
        const highlighted = highlighter.codeToHtml(content, {
          lang,
          theme: themeName,
        })
        if (active) {
          setResolvedLanguage(lang)
          setHtml(highlighted)
          const theme = highlighter.getTheme(themeName)
          setHeaderBg(theme.bg)
        }
      })
      .catch(() => {
        if (active) setHtml(null)
      })
    return () => {
      active = false
    }
  }, [content, normalizedLanguage, themeName])

  async function handleCopy() {
    try {
      await writeTextToClipboard(content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  function handleDownload() {
    const filename = inferDownloadFilename(resolvedLanguage || language)
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const isSingleLine = content.split('\n').length === 1
  const displayLanguage = formatLanguageName(resolvedLanguage)

  return (
    <div
      className={cn(
        'group relative min-w-0 overflow-hidden rounded-lg border border-primary-200',
        className,
      )}
    >
      <div
        className={cn('flex items-center justify-between gap-2 px-3 pt-2')}
        style={{ backgroundColor: headerBg }}
      >
        <span className="rounded border border-primary-200 bg-primary-100/80 px-2 py-0.5 text-xs font-medium text-primary-700">
          {displayLanguage}
        </span>
        <div className="flex items-center gap-2">
          {canShowLineNumbers ? (
            <Button
              variant="ghost"
              className="h-auto px-0 text-xs font-medium text-primary-500 hover:text-primary-800 hover:bg-transparent"
              onClick={() => {
                setShowLineNumbers((current) => !current)
              }}
            >
              {showLineNumbers ? 'Hide lines' : 'Show lines'}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            aria-label="Download file"
            title="Download file"
            className="h-auto px-0 text-xs font-medium text-primary-500 hover:text-primary-800 hover:bg-transparent"
            onClick={handleDownload}
          >
            <HugeiconsIcon icon={DownloadIcon} size={16} strokeWidth={1.5} />
          </Button>
          <Button
            variant="ghost"
            aria-label={ariaLabel ?? 'Copy code'}
            className="h-auto px-0 text-xs font-medium text-primary-500 hover:text-primary-800 hover:bg-transparent"
            onClick={() => {
              handleCopy().catch(() => {})
            }}
          >
            <HugeiconsIcon
              icon={copied ? Tick02Icon : Copy01Icon}
              size={20}
              strokeWidth={1.5}
            />
            {copied ? 'Copied' : 'Copy'}
          </Button>
          {onExpand ? (
            <Button
              variant="ghost"
              aria-label="Open in workspace"
              title="Open in workspace"
              className="h-auto px-0 text-xs font-medium text-primary-500 hover:text-primary-800 hover:bg-transparent"
              onClick={onExpand}
            >
              <HugeiconsIcon icon={ArrowExpandDiagonalIcon} size={16} strokeWidth={1.5} />
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex min-w-0 overflow-x-auto">
        {showLineNumbers ? (
          <ol className="sticky left-0 z-10 select-none border-r border-primary-200 bg-primary-100/60 px-2 py-3 text-right text-xs text-primary-600 tabular-nums">
            {Array.from({ length: lineCount }, (_, index) => (
              <li key={`line-${index + 1}`} className="leading-6">
                {index + 1}
              </li>
            ))}
          </ol>
        ) : null}
        <div className="min-w-0 flex-1">
          {html ? (
            <div
              className={cn(
                'text-sm text-primary-900 [&>pre]:m-0 [&>pre]:overflow-visible [&>pre]:leading-6',
                isSingleLine
                  ? '[&>pre]:whitespace-pre [&>pre]:px-3 [&>pre]:py-2'
                  : '[&>pre]:px-3 [&>pre]:py-3',
              )}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <pre
              className={cn(
                'text-sm leading-6 text-primary-900',
                isSingleLine ? 'whitespace-pre px-3 py-2' : 'px-3 py-3',
              )}
            >
              <code>{fallback}</code>
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
