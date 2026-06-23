import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowUp01Icon } from '@hugeicons/core-free-icons'
import type { FormEvent, KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type AgentChatInputProps = {
  disabled?: boolean
  isSending?: boolean
  onSend: (message: string) => Promise<void> | void
}

export function AgentChatInput({
  disabled = false,
  isSending = false,
  onSend,
}: AgentChatInputProps) {
  const [value, setValue] = useState('')

  async function submit() {
    const message = value.trim()
    if (!message || disabled || isSending) return
    setValue('')
    await onSend(message)
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submit()
  }

  function handleTextareaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <form
      onSubmit={handleFormSubmit}
      className="border-t border-[var(--theme-border)] bg-[var(--theme-hover)] p-3 backdrop-blur-sm"
    >
      <div className="flex items-end gap-2 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-2 shadow-sm">
        <textarea
          value={value}
          rows={1}
          placeholder="Message this agent..."
          disabled={disabled || isSending}
          onChange={function handleChange(event) {
            setValue(event.target.value)
          }}
          onKeyDown={handleTextareaKeyDown}
          className={cn(
            'max-h-36 min-h-9 sm:min-h-8 flex-1 resize-y bg-transparent px-2 py-2 sm:py-1 text-sm text-[var(--theme-text)] outline-none placeholder:text-[var(--theme-muted)]',
            disabled ? 'cursor-not-allowed opacity-60' : '',
          )}
        />
        <Button
          size="icon-sm"
          variant="default"
          type="submit"
          disabled={disabled || isSending || value.trim().length === 0}
          className="rounded-xl"
          aria-label="Send message"
        >
          <HugeiconsIcon icon={ArrowUp01Icon} size={20} strokeWidth={1.5} />
        </Button>
      </div>
      <p className="mt-1 px-2 text-[11px] text-[var(--theme-muted)] text-pretty tabular-nums">
        Enter to send · Shift+Enter for a new line
      </p>
    </form>
  )
}
