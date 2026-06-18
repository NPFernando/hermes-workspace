'use client'

import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[colors,transform] focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0] select-none duration-150 active:scale-[0.97]',
  {
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
    variants: {
      size: {
        default: 'h-9 px-4',
        sm: 'h-8 px-3',
        lg: 'h-10 px-5',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-md': 'size-10',
        'icon-xl': 'size-11 [&_svg]:size-5',
      },
      variant: {
        default:
          'bg-[var(--theme-bg)] text-[var(--theme-text)] hover:bg-[var(--theme-bg)] shadow-sm outline outline-[var(--theme-border)]/20 shadow-2xs',
        secondary:
          'bg-[var(--theme-panel)] text-[var(--theme-text)] hover:bg-[var(--theme-hover)] outline outline-[var(--theme-border)]/20 shadow-2xs',
        outline:
          'border-[var(--theme-border)] bg-transparent text-[var(--theme-text)] hover:bg-[var(--theme-panel)] shadow-2xs outline outline-[var(--theme-border)]/20',
        ghost: 'text-[var(--theme-text)] hover:bg-[var(--theme-hover)] hover:text-[var(--theme-text)]',
        destructive: 'bg-red-600 text-[var(--theme-text)] hover:bg-red-700 shadow-sm',
      },
    },
  },
)

interface ButtonProps extends useRender.ComponentProps<'button'> {
  variant?: VariantProps<typeof buttonVariants>['variant']
  size?: VariantProps<typeof buttonVariants>['size']
}

function Button({ className, variant, size, render, ...props }: ButtonProps) {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>['type'] =
    render ? undefined : 'button'

  const defaultProps = {
    className: cn(buttonVariants({ className, size, variant })),
    'data-slot': 'button',
    type: typeValue,
  }

  return useRender({
    defaultTagName: 'button',
    props: mergeProps<'button'>(defaultProps, props),
    render,
  })
}

export { Button, buttonVariants }
