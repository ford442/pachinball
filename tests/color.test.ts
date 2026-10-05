import { describe, expect, it } from 'vitest'
import { parseHexColor, parseHexColorUnit } from '../src/core/color'

describe('parseHexColor', () => {
  it('parses #rrggbb into 0-255 channels', () => {
    expect(parseHexColor('#00d9ff')).toEqual({ r: 0, g: 217, b: 255 })
  })

  it('tolerates a missing # and upper case', () => {
    expect(parseHexColor('FF00AA')).toEqual({ r: 255, g: 0, b: 170 })
  })

  it('expands #rgb shorthand', () => {
    expect(parseHexColor('#f0a')).toEqual({ r: 255, g: 0, b: 170 })
    expect(parseHexColor('fff')).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('turns unparseable channels into 0 instead of NaN', () => {
    expect(parseHexColor('')).toEqual({ r: 0, g: 0, b: 0 })
    expect(parseHexColor('#zzzzzz')).toEqual({ r: 0, g: 0, b: 0 })
    expect(parseHexColor('#ff')).toEqual({ r: 255, g: 0, b: 0 })
  })
})

describe('parseHexColorUnit', () => {
  it('normalises channels to 0-1', () => {
    const { r, g, b } = parseHexColorUnit('#ff8000')
    expect(r).toBe(1)
    expect(g).toBeCloseTo(128 / 255, 10)
    expect(b).toBe(0)
  })
})
