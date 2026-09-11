import { describe, expect, it } from 'vitest'
import { connectionStatusResponse } from './connection-status'

describe('/api/connection-status cache policy', () => {
  it('marks capability responses private and varies them by cookie', () => {
    const response = connectionStatusResponse({ error: 'Unauthorized' }, 401)

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe(
      'no-store, no-cache, must-revalidate, private',
    )
    expect(response.headers.get('vary')).toBe('Cookie')
  })
})
