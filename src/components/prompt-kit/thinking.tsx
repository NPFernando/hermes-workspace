'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

export type ThinkingProps = {
  content: string
}

function Thinking({ content }: ThinkingProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="inline-flex flex-col">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              className="h-auto gap-1.5 px-2 py-2 sm:px-1.5 sm:py-0.5 -mx-2 touch-manipulation"
            />
          }
        >
          <span className="text-sm font-medium text-[var(--theme-text)]">Thinking</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={14}
            strokeWidth={1.5}
            className="text-[var(--theme-text)] transition-transform duration-150 group-data-panel-open:rotate-180"
          />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="pt-1 mb-3">
            <p className="text-sm text-[var(--theme-muted)] whitespace-pre-wrap">
              {content}
            </p>
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  )
}

export { Thinking }
