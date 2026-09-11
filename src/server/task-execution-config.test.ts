import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_CONCURRENT_EXECUTIONS,
  MAX_ALLOWED_CONCURRENT_EXECUTIONS,
  parseMaxConcurrentExecutions,
} from './task-execution-config'

describe('parseMaxConcurrentExecutions', () => {
  it('uses the safe default for missing or invalid values', () => {
    expect(parseMaxConcurrentExecutions(undefined)).toBe(
      DEFAULT_MAX_CONCURRENT_EXECUTIONS,
    )
    expect(parseMaxConcurrentExecutions('')).toBe(
      DEFAULT_MAX_CONCURRENT_EXECUTIONS,
    )
    expect(parseMaxConcurrentExecutions('0')).toBe(
      DEFAULT_MAX_CONCURRENT_EXECUTIONS,
    )
    expect(parseMaxConcurrentExecutions('not-a-number')).toBe(
      DEFAULT_MAX_CONCURRENT_EXECUTIONS,
    )
  })

  it('preserves positive values and caps unsafe values', () => {
    expect(parseMaxConcurrentExecutions('3')).toBe(3)
    expect(parseMaxConcurrentExecutions(' 8 workers ')).toBe(8)
    expect(parseMaxConcurrentExecutions('999')).toBe(
      MAX_ALLOWED_CONCURRENT_EXECUTIONS,
    )
  })
})
