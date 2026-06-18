import { useEffect, useId, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { CodeBlock } from './code-block'
import type { Mermaid } from 'mermaid'
import { writeTextToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

let mermaidReady: Promise<Mermaid> | null = null

function getMermaid() {
  if (!mermaidReady) {
    mermaidReady = import('mermaid').then((mod) => {
      mod.default.initialize({
        startOnLoad: false,
        theme: 'neutral',
        securityLevel: 'loose',
      })
      return mod.default
    })
  }
  return mermaidReady
}

export function MermaidBlock({ code }: { code: string }) {
  const uid = useId().replace(/:/g, '')
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let active = true
    setSvg(null)
    setError(null)

    getMermaid()
      .then((m) => m.render(`mermaid-${uid}`, code.trim()))
      .then(({ svg: rendered }) => {
        if (active) setSvg(rendered)
      })
      .catch((e: unknown) => {
        if (active) setError(String(e))
      })

    return () => {
      active = false
    }
  }, [code, uid])

  async function handleCopy() {
    try {
      await writeTextToClipboard(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  if (error) {
    return <CodeBlock content={code} language="text" className="w-full my-2" />
  }

  if (!svg) {
    return (
      <div className="my-2 rounded-lg border border-primary-200 bg-primary-50 px-4 py-8 text-center text-xs text-primary-400 animate-pulse">
        Rendering diagram…
      </div>
    )
  }

  return (
    <div className="my-2 rounded-lg border border-primary-200 overflow-hidden">
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{ background: 'var(--theme-card2, #f8f8f8)' }}
      >
        <span className="rounded border border-primary-200 bg-primary-100/80 px-2 py-0.5 text-xs font-medium text-primary-700">
          Diagram
        </span>
        <button
          type="button"
          onClick={() => { handleCopy().catch(() => {}) }}
          className={cn(
            'inline-flex items-center gap-1 text-xs text-primary-500 hover:text-primary-800 transition-colors',
          )}
        >
          <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={14} strokeWidth={1.5} />
          {copied ? 'Copied' : 'Copy source'}
        </button>
      </div>
      <div
        className="flex items-center justify-center p-4 bg-white overflow-x-auto"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  )
}
