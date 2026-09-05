'use client'

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'

import { cn } from '@/lib/utils'

type TabsVariant = 'default' | 'underline'

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      className={cn(
        'flex flex-col gap-2 data-[orientation=vertical]:flex-row',
        className,
      )}
      data-slot="tabs"
      {...props}
    />
  )
}

function TabsList({
  variant = 'default',
  className,
  children,
  ...props
}: TabsPrimitive.List.Props & {
  variant?: TabsVariant
}) {
  return (
    <TabsPrimitive.List
      className={cn(
        'relative z-0 flex w-fit items-center justify-center gap-x-0.5 text-[var(--theme-muted)]',
        'data-[orientation=vertical]:flex-col',
        variant === 'default'
          ? 'p-0.5 text-[var(--theme-muted)]/80'
          : 'data-[orientation=vertical]:px-1 data-[orientation=horizontal]:py-1',
        className,
      )}
      data-slot="tabs-list"
      {...props}
    >
      {children}
      <TabsPrimitive.Indicator
        className={cn(
          '-translate-y-(--active-tab-bottom) absolute bottom-0 left-0 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) transition-[width,translate] duration-200 ease-in-out',
          variant === 'underline'
            ? 'data-[orientation=vertical]:-translate-x-px z-10 bg-[var(--theme-bg)] data-[orientation=horizontal]:h-0.5 data-[orientation=vertical]:w-0.5 data-[orientation=horizontal]:translate-y-px'
            : 'z-0 rounded-md bg-[var(--theme-hover)]',
        )}
        data-slot="tab-indicator"
      />
    </TabsPrimitive.List>
  )
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      className={cn(
        '[&_svg]:-mx-0.5 relative z-10 flex h-8 shrink-0 grow cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium outline-none transition-[color,background-color,box-shadow] hover:text-[var(--theme-text)] focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] data-disabled:pointer-events-none data-[orientation=vertical]:w-full data-[orientation=vertical]:justify-start data-active:bg-[var(--theme-accent-subtle)] data-active:text-[var(--theme-accent)] data-active:font-semibold data-disabled:opacity-64 [&_svg:not([class*="size-"])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0',
        className,
      )}
      data-slot="tabs-tab"
      {...props}
    />
  )
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      className={cn('flex-1 outline-none', className)}
      data-slot="tabs-content"
      {...props}
    />
  )
}

export {
  Tabs,
  TabsList,
  TabsTab,
  TabsTab as TabsTrigger,
  TabsPanel,
  TabsPanel as TabsContent,
}
