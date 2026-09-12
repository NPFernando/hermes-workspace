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

import { CombosSection } from './harp-config-screen'
import type { HarpCombosView } from '@/server/harp-config-store'

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
