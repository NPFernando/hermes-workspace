// @vitest-environment jsdom
/**
 * Route Combos editor — patch-body contract.
 *
 * Replaces e2e/harp-combos.spec.ts: that Playwright spec can't run (the repo
 * has no @playwright/test dependency and no playwright.config), so the same
 * three assertions — Add combo, Add step, and the Enabled toggle each fire the
 * right PATCH body — live here in the vitest suite that CI actually runs.
 *
 * Renders CombosSection directly with a spy `patch`, so there's no react-query
 * or fetch to mock. React.act + createRoot (not @testing-library/react) to
 * dodge the vitest ESM/CJS dual-React issue, matching the other .test.tsx here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'

import { CombosSection, LearnedCapabilitiesPanel } from './harp-config-screen'
import type { HarpCombosView } from '@/server/harp-config-store'
import type {
  HarpLearnedCapability,
  HarpObservabilityView,
} from '@/server/harp-observability'

async function renderInto(element: React.ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await React.act(async () => {
    root.render(element)
  })
  return {
    container,
    rerender: async (next: React.ReactElement) => {
      await React.act(async () => {
        root.render(next)
      })
    },
    unmount: async () => {
      await React.act(async () => {
        root.unmount()
      })
      document.body.removeChild(container)
    },
  }
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent.includes(text),
  )
  if (!btn) throw new Error(`no button containing text: ${text}`)
  return btn
}

function inputByPlaceholder(
  container: HTMLElement,
  fragment: string,
): HTMLInputElement {
  const el = Array.from(container.querySelectorAll('input')).find((i) =>
    (i.getAttribute('placeholder') ?? '').includes(fragment),
  )
  if (!el) throw new Error(`no input with placeholder containing: ${fragment}`)
  return el
}

/** Set a controlled input's value so React's onChange fires in jsdom. */
async function type(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set
  setter?.call(el, value)
  await React.act(async () => {
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function click(el: Element) {
  await React.act(async () => {
    ;(el as HTMLElement).click()
  })
}

const EMPTY: HarpCombosView = { enabled: false, enforce: false, entries: [] }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CombosSection — patch bodies', () => {
  it('Add combo -> {action: add-combo, name}', async () => {
    const patch = vi.fn()
    const { container, unmount } = await renderInto(
      <CombosSection combos={EMPTY} patch={patch} />,
    )

    await click(buttonByText(container, 'Add combo'))
    await type(inputByPlaceholder(container, 'combo name'), 'cr')
    await click(buttonByText(container, 'Create'))

    expect(patch).toHaveBeenCalledWith({ action: 'add-combo', name: 'cr' })
    await unmount()
  })

  it('Add step -> {action: add-combo-step, name, step}', async () => {
    const patch = vi.fn()
    const withCombo: HarpCombosView = {
      enabled: false,
      enforce: false,
      entries: [{ name: 'cr', steps: [] }],
    }
    const { container, unmount } = await renderInto(
      <CombosSection combos={withCombo} patch={patch} />,
    )

    await type(
      inputByPlaceholder(container, 'provider/model-id'),
      'openrouter/deepseek/deepseek-v4-flash',
    )
    await click(buttonByText(container, 'Add step'))

    expect(patch).toHaveBeenCalledWith({
      action: 'add-combo-step',
      name: 'cr',
      step: 'openrouter/deepseek/deepseek-v4-flash',
    })
    await unmount()
  })

  it('Enabled toggle -> {action: set-combos-global, field: enabled, value: true}', async () => {
    const patch = vi.fn()
    const { container, unmount } = await renderInto(
      <CombosSection combos={EMPTY} patch={patch} />,
    )

    await click(buttonByText(container, 'Combos enabled'))

    expect(patch).toHaveBeenCalledWith({
      action: 'set-combos-global',
      field: 'enabled',
      value: true,
    })
    await unmount()
  })

  it('Enforce toggle -> {action: set-combos-global, field: enforce, value: true}', async () => {
    const patch = vi.fn()
    const { container, unmount } = await renderInto(
      <CombosSection combos={EMPTY} patch={patch} />,
    )

    await click(buttonByText(container, 'Enforce'))

    expect(patch).toHaveBeenCalledWith({
      action: 'set-combos-global',
      field: 'enforce',
      value: true,
    })
    await unmount()
  })

  it('blank combo name does not fire a patch', async () => {
    const patch = vi.fn()
    const { container, unmount } = await renderInto(
      <CombosSection combos={EMPTY} patch={patch} />,
    )

    await click(buttonByText(container, 'Add combo'))
    // "Create" is disabled with an empty field; clicking is a no-op
    await click(buttonByText(container, 'Create'))

    expect(patch).not.toHaveBeenCalled()
    await unmount()
  })
})

describe('LearnedCapabilitiesPanel', () => {
  function view(caps: Array<HarpLearnedCapability>) {
    return { learnedCapabilities: caps } as unknown as HarpObservabilityView
  }
  const base = {
    learnedAt: '2026-10-01T12:00:00Z',
    lastSeenAt: '2026-10-01T12:00:00Z',
    count: 1,
    source: 'paperclip:run:abc',
    signature: null,
    expiresAt: null,
    ttlDays: null,
    active: true,
  }

  it('labels unusable models, rejected options and expired blocks', async () => {
    const r = await renderInto(
      <LearnedCapabilitiesPanel
        view={view([
          {
            ...base,
            model: 'gpt-6-sol',
            option: 'model',
            expiresAt: '2026-10-08T12:00:00Z',
            ttlDays: 7,
          },
          { ...base, model: 'claude-haiku-4-5', option: 'effort' },
          {
            ...base,
            model: 'old-model',
            option: 'model',
            active: false,
            expiresAt: '2026-09-01T00:00:00Z',
          },
        ])}
      />,
    )
    const rows = r.container.querySelectorAll(
      '[data-testid="learned-capability"]',
    )
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain('unusable')
    expect(rows[0].textContent).toContain('(7d)')
    expect(rows[1].textContent).toContain('rejects option')
    expect(rows[1].textContent).toContain('claude-haiku-4-5 · effort')
    expect(rows[2].textContent).toContain('expired')
    expect(r.container.textContent).toContain('2 active · 1 expired')
    await r.unmount()
  })

  it('explains the empty state', async () => {
    const r = await renderInto(<LearnedCapabilitiesPanel view={view([])} />)
    expect(r.container.textContent).toContain('Nothing learned yet')
    await r.unmount()
  })
})
