// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountsPanel } from './accounts-panel'
import { FixedDepositsPanel } from './fixed-deposits-panel'
import type { PersonalFinancePayload } from '../types'

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }))

vi.mock('../../finance/hooks/use-finance-action', () => ({
  useFinanceAction: () => ({
    run: runMock,
    busy: null,
    error: null,
    setError: vi.fn(),
  }),
}))

const payload = {
  ok: true,
  checkedAt: Date.now(),
  baseCurrency: 'LKR',
  fxToBase: 1,
  data: {
    financial_institutions: [
      { id: 'bank-1', name: 'Sampath Bank', normalizedName: 'sampath bank' },
    ],
    financial_branches: [
      { id: 'branch-1', institutionId: 'bank-1', name: 'Colombo 03' },
    ],
    finance_accounts: [],
    fixed_deposits: [],
  },
} as unknown as PersonalFinancePayload

let root: Root

async function changeInput(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(selector)
  if (!input) throw new Error(`Missing input: ${selector}`)
  await act(async () => fireEvent.change(input, { target: { value } }))
}

async function render(node: React.ReactNode) {
  await act(async () => root.render(node))
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  runMock.mockReset().mockResolvedValue(payload)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.replaceChildren()
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
})

describe('reusable institution and branch suggestions', () => {
  it('offers catalog bank/branch values and submits them for a new account', async () => {
    await render(<AccountsPanel payload={payload} onPayload={vi.fn()} />)

    expect(document.querySelector('#finance-institution-options option[value="Sampath Bank"]')).not.toBeNull()
    await changeInput('input[placeholder="Institution / platform (optional)"]', 'Sampath Bank')
    expect(document.querySelector('#finance-account-branch-options option[value="Colombo 03"]')).not.toBeNull()
    await changeInput('input[placeholder="Account name"]', 'Everyday account')
    await changeInput('input[placeholder="Current balance"]', '1000')
    await changeInput('input[placeholder="Branch (optional)"]', 'Colombo 03')

    const addButton = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Add account'))
    if (!addButton) throw new Error('Missing Add account button')
    await act(async () => addButton.click())

    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'add_record',
        kind: 'account',
        payload: expect.objectContaining({
          name: 'Everyday account',
          platform: 'Sampath Bank',
          branchName: 'Colombo 03',
        }),
      }),
      'account',
    )
  })

  it('offers the same institution/branch values and submits them for a fixed deposit', async () => {
    await render(<FixedDepositsPanel payload={payload} onPayload={vi.fn()} />)

    expect(document.querySelector('#finance-fd-institution-options option[value="Sampath Bank"]')).not.toBeNull()
    await changeInput('input[placeholder="Bank name"]', 'Sampath Bank')
    expect(document.querySelector('#finance-fd-branch-options option[value="Colombo 03"]')).not.toBeNull()
    await changeInput('input[placeholder="Branch (optional)"]', 'Colombo 03')
    await changeInput('input[placeholder="Principal"]', '50000')
    await changeInput('input[title="Maturity date"]', '2027-01-01')

    const addButton = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Add fixed deposit'))
    if (!addButton) throw new Error('Missing Add fixed deposit button')
    await act(async () => addButton.click())

    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'add_record',
        kind: 'fixed_deposit',
        payload: expect.objectContaining({
          bankName: 'Sampath Bank',
          branchName: 'Colombo 03',
          principal: 50000,
          maturityDate: '2027-01-01',
        }),
      }),
      'fd',
    )
  })
})
