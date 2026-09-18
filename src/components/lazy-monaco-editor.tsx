import { Suspense, lazy } from 'react'

type MonacoEditorOptions = Record<string, unknown>

export type LazyMonacoEditorProps = {
  height: string | number
  theme?: string
  language?: string
  path?: string
  value?: string
  onChange?: (value: string | undefined) => void
  options?: MonacoEditorOptions
}

const MonacoEditor = lazy(() =>
  import('@monaco-editor/react').then(({ Editor }) => ({
    default: Editor,
  })),
)

export function LazyMonacoEditor(props: LazyMonacoEditorProps) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-sm text-[var(--theme-muted)]">
          Loading editor…
        </div>
      }
    >
      <MonacoEditor {...props} />
    </Suspense>
  )
}
