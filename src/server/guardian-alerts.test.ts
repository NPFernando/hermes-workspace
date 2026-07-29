import { describe, expect, it } from 'vitest'
import {
  guardianBlockAlertSeverity,
  shouldAlertGuardianBlock,
} from './demo-trading-engine'
import type { GuardianBlock } from './trading-guardian'

function block(rule: string): GuardianBlock {
  return { rule, detail: `${rule} triggered` }
}

describe('guardianBlockAlertSeverity', () => {
  it('is critical when a money-loss rule is present', () => {
    expect(guardianBlockAlertSeverity([block('daily_loss_halt')])).toBe(
      'critical',
    )
    expect(guardianBlockAlertSeverity([block('weekly_loss_halt')])).toBe(
      'critical',
    )
    expect(guardianBlockAlertSeverity([block('open_drawdown_halt')])).toBe(
      'critical',
    )
    expect(guardianBlockAlertSeverity([block('balance_floor')])).toBe(
      'critical',
    )
  })

  it('is critical when a critical rule is mixed with routine rules', () => {
    expect(
      guardianBlockAlertSeverity([
        block('position_cap'),
        block('daily_loss_halt'),
      ]),
    ).toBe('critical')
  })

  it('is warning for routine risk-management rules', () => {
    expect(guardianBlockAlertSeverity([block('position_cap')])).toBe(
      'warning',
    )
    expect(guardianBlockAlertSeverity([block('loss_streak_cooldown')])).toBe(
      'warning',
    )
    expect(guardianBlockAlertSeverity([block('bucket_exposure_cap')])).toBe(
      'warning',
    )
  })
})

describe('shouldAlertGuardianBlock', () => {
  it('alerts the first time a rule set is seen for a key', () => {
    const key = `test-first-${Math.random()}`
    expect(shouldAlertGuardianBlock(key, [block('position_cap')], 1000)).toBe(
      true,
    )
  })

  it('suppresses a repeat alert for the same rule set within the cooldown', () => {
    const key = `test-cooldown-${Math.random()}`
    expect(shouldAlertGuardianBlock(key, [block('position_cap')], 1000)).toBe(
      true,
    )
    expect(
      shouldAlertGuardianBlock(key, [block('position_cap')], 1000 + 60_000),
    ).toBe(false)
  })

  it('re-alerts once the cooldown window elapses for an unchanged rule set', () => {
    const key = `test-elapsed-${Math.random()}`
    expect(shouldAlertGuardianBlock(key, [block('position_cap')], 0)).toBe(
      true,
    )
    expect(
      shouldAlertGuardianBlock(key, [block('position_cap')], 30 * 60_000),
    ).toBe(true)
  })

  it('re-alerts immediately when the blocking rule set changes, ignoring cooldown', () => {
    const key = `test-change-${Math.random()}`
    expect(shouldAlertGuardianBlock(key, [block('position_cap')], 1000)).toBe(
      true,
    )
    expect(
      shouldAlertGuardianBlock(key, [block('daily_loss_halt')], 1500),
    ).toBe(true)
  })

  it('treats rule sets as unordered when comparing for change', () => {
    const key = `test-order-${Math.random()}`
    expect(
      shouldAlertGuardianBlock(
        key,
        [block('position_cap'), block('loss_streak_cooldown')],
        1000,
      ),
    ).toBe(true)
    expect(
      shouldAlertGuardianBlock(
        key,
        [block('loss_streak_cooldown'), block('position_cap')],
        1500,
      ),
    ).toBe(false)
  })
})
