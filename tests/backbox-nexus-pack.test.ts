/**
 * Nexus character pack asset contract (public/backbox/nexus): sizes, budgets,
 * and the transparent reel window on posters for states that keep the reels.
 * Regenerate with `npm run assets:nexus`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'

const DIR = join(__dirname, '../public/backbox/nexus')
const POSTERS = ['idle', 'reach', 'fever', 'jackpot'] as const
const REEL_STATES = new Set(['reach', 'fever'])
const W = 1000
const H = 600
const REEL_WINDOW = { x0: 0.08, x1: 0.92, y0: 0.18, y1: 0.7 }

const PNG_BUDGET = 350 * 1024
const LOOP_BUDGET = 500 * 1024
const PACK_BUDGET = 2 * 1024 * 1024

interface Rgba { width: number; height: number; colorType: number; bitDepth: number; pixels: Uint8Array }

/** Minimal decoder for 8-bit, non-interlaced PNGs (what Chromium screenshots emit). */
function decodePng(buf: Buffer): Rgba {
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  let off = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat: Buffer[] = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('latin1', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      expect(data[12]).toBe(0) // non-interlaced
    } else if (type === 'IDAT') {
      idat.push(data)
    }
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const bpp = colorType === 6 ? 4 : 3
  const stride = width * bpp
  const pixels = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = pixels.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0
      const b = prev ? prev[i] : 0
      const c = prev && i >= bpp ? prev[i - bpp] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out[i] = v & 0xff
    }
  }
  return { width, height, colorType, bitDepth, pixels }
}

describe('Nexus character pack', () => {
  for (const name of POSTERS) {
    it(`${name}.png is a ${W}×${H} RGBA poster within budget`, () => {
      const file = join(DIR, `${name}.png`)
      expect(statSync(file).size).toBeLessThanOrEqual(PNG_BUDGET)
      // Not a color-field placeholder.
      expect(statSync(file).size).toBeGreaterThan(20 * 1024)
      const png = decodePng(readFileSync(file))
      expect(png.width).toBe(W)
      expect(png.height).toBe(H)
      expect(png.colorType).toBe(6)
      expect(png.bitDepth).toBe(8)

      let opaque = 0
      for (let i = 3; i < png.pixels.length; i += 4) if (png.pixels[i] > 200) opaque++
      // A character take, not a full-frame fill and not empty.
      expect(opaque / (W * H)).toBeGreaterThan(0.02)
      if (name !== 'jackpot') expect(opaque / (W * H)).toBeLessThan(0.6)
    })
  }

  for (const name of REEL_STATES) {
    it(`${name}.png leaves the reel window transparent`, () => {
      const png = decodePng(readFileSync(join(DIR, `${name}.png`)))
      let maxAlpha = 0
      for (let y = Math.floor(H * REEL_WINDOW.y0); y < Math.ceil(H * REEL_WINDOW.y1); y++) {
        for (let x = Math.floor(W * REEL_WINDOW.x0); x < Math.ceil(W * REEL_WINDOW.x1); x++) {
          maxAlpha = Math.max(maxAlpha, png.pixels[(y * W + x) * 4 + 3])
        }
      }
      expect(maxAlpha).toBeLessThanOrEqual(8)
    })
  }

  it('idle.webm is a WebM loop within budget', () => {
    const buf = readFileSync(join(DIR, 'idle.webm'))
    expect(buf.subarray(0, 4).toString('hex')).toBe('1a45dfa3') // EBML magic
    expect(buf.includes(Buffer.from('webm'))).toBe(true)
    expect(buf.length).toBeLessThanOrEqual(LOOP_BUDGET)
  })

  it('the whole pack fits the budget', () => {
    const total = [...POSTERS.map((n) => `${n}.png`), 'idle.webm']
      .map((f) => statSync(join(DIR, f)).size)
      .reduce((a, b) => a + b, 0)
    expect(total).toBeLessThanOrEqual(PACK_BUDGET)
  })
})
