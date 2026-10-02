import { describe, it, expect } from 'vitest'
import { createCascadeShareUrl, parseCascadeParam } from '../src/cascade/cascade-url'

describe('parseCascadeParam', () => {
  it('reads daily', () => {
    expect(parseCascadeParam('?cascade=daily')).toEqual({ mode: 'daily' })
    expect(parseCascadeParam('?cascade=DAILY')).toEqual({ mode: 'daily' })
  })

  it('reads a hex seed, any case', () => {
    expect(parseCascadeParam('?cascade=1a2b3c4d')).toEqual({ mode: 'free', seed: 0x1a2b3c4d })
    expect(parseCascadeParam('?cascade=FF')).toEqual({ mode: 'free', seed: 255 })
    expect(parseCascadeParam('?cascade=ffffffff')).toEqual({ mode: 'free', seed: 0xffffffff })
  })

  it('ignores missing, oversized and non-hex values', () => {
    expect(parseCascadeParam('')).toBeNull()
    expect(parseCascadeParam('?seed=123')).toBeNull()
    expect(parseCascadeParam('?cascade=')).toBeNull()
    expect(parseCascadeParam('?cascade=123456789')).toBeNull()
    expect(parseCascadeParam('?cascade=zz')).toBeNull()
    expect(parseCascadeParam('?cascade=-1')).toBeNull()
  })

  it('coexists with challenge params', () => {
    expect(parseCascadeParam('?seed=123&cascade=ff&target=5000')).toEqual({ mode: 'free', seed: 255 })
  })
})

describe('createCascadeShareUrl', () => {
  it('round-trips the exact seed', () => {
    for (const seed of [0, 1, 0x1a2b3c4d, 0xffffffff]) {
      const url = createCascadeShareUrl(seed, 'https://example.test/')
      expect(parseCascadeParam(new URL(url).search)).toEqual({ mode: 'free', seed })
    }
  })
})
