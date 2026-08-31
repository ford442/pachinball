import { describe, expect, it } from 'vitest'

import { isRemoteApiBase } from '../src/config/api'

describe('isRemoteApiBase', () => {
  it('accepts absolute http(s) backends', () => {
    expect(isRemoteApiBase('https://storage.noahcohn.com/api')).toBe(true)
    expect(isRemoteApiBase('http://localhost:8000/api')).toBe(true)
  })

  it('rejects same-origin /api stubs used on static hosts', () => {
    expect(isRemoteApiBase('/api')).toBe(false)
    expect(isRemoteApiBase('')).toBe(false)
  })
})
