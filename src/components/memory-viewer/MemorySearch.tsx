import { HugeiconsIcon } from '@hugeicons/react'
import { Search01Icon } from '@hugeicons/core-free-icons'
import type { MemorySearchResult } from './memory-types'
import { cn } from '@/lib/utils'

type MemorySearchProps = {
  query: string
  searching: boolean
  results: Array<MemorySearchResult>
  onQueryChange: (query: string) => void
  onSelectResult: (result: MemorySearchResult) => void
}

function MemorySearch({
  query,
  searching,
  results,
  onQueryChange,
  onSelectResult,
}: MemorySearchProps) {
  return (
    <section className="border-b border-[var(--theme-border)] bg-[var(--theme-hover)]/40 px-3 py-2">
      <label className="relative block">
        <HugeiconsIcon
          icon={Search01Icon}
          size={20}
          strokeWidth={1.5}
          className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[var(--theme-muted)]"
        />
        <input
          value={query}
          onChange={function onChangeQuery(event) {
            onQueryChange(event.target.value)
          }}
          placeholder="Search across MEMORY.md and memory/*.md"
          className="h-9 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] pr-3 pl-9 text-sm text-[var(--theme-text)] outline-none focus:border-accent-500/40"
        />
      </label>
      {query.trim() ? (
        <div className="mt-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-panel)] px-2 py-1.5">
          {searching ? (
            <p className="text-xs text-[var(--theme-muted)] text-pretty">
              Searching memory files...
            </p>
          ) : results.length === 0 ? (
            <p className="text-xs text-[var(--theme-muted)] text-pretty">
              No matches found.
            </p>
          ) : (
            <div className="max-h-44 space-y-1 overflow-y-auto">
              {results.slice(0, 20).map(function renderResult(result) {
                return (
                  <button
                    key={`${result.path}:${result.line}:${result.snippet}`}
                    type="button"
                    onClick={function onClickResult() {
                      onSelectResult(result)
                    }}
                    className={cn(
                      'w-full rounded-md border border-[var(--theme-border)] px-2 py-2 sm:py-1.5 text-left touch-manipulation',
                      'hover:bg-[var(--theme-hover)]',
                    )}
                  >
                    <p className="truncate text-xs font-medium text-[var(--theme-text)] tabular-nums">
                      {result.path}:{result.line}
                    </p>
                    <p className="line-clamp-2 text-xs text-[var(--theme-muted)] text-pretty">
                      {result.snippet}
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}

export { MemorySearch }
