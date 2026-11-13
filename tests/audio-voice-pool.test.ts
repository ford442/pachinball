import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MIN_AUDIBLE_IMPACT, panFromPlayfieldX, VOICE_POOL_SIZE, type VoiceHit } from '../src/audio/voice-hit'
import { VoicePool } from '../src/audio/voice-pool'

const ROOT = path.resolve(__dirname, '..')
const SAMPLE_RATE = 48_000
const QUANTUM = 128

function hit(impact: number, extra: Partial<VoiceHit> = {}): VoiceHit {
  return { velocity: impact, impact, metal: 0.55, spin: 0, fever: 0, pan: 0, ...extra }
}

function slotArrays(pool: VoicePool) {
  return [
    pool.samplesLeft, pool.total, pool.impact, pool.metal, pool.spin,
    pool.fever, pool.panL, pool.panR, pool.seed, pool.phase, pool.lp,
  ]
}

describe('VoicePool', () => {
  it('holds exactly VOICE_POOL_SIZE (24) slots', () => {
    expect(VOICE_POOL_SIZE).toBe(24)
    const pool = new VoicePool(SAMPLE_RATE)
    expect(pool.size).toBe(24)
    for (const a of slotArrays(pool)) expect(a.length).toBe(24)
  })

  it('a 500-hit burst keeps the live count at 24 and reuses the same slot arrays', () => {
    const pool = new VoicePool(SAMPLE_RATE)
    const arrays = slotArrays(pool)
    const left = new Float32Array(QUANTUM)
    const right = new Float32Array(QUANTUM)
    let maxLive = 0

    for (let n = 0; n < 500; n++) {
      pool.trigger(hit(0.3 + (n % 7) * 0.1))
      maxLive = Math.max(maxLive, pool.live)
      if (n % 20 === 0) pool.render(left, right)
    }
    expect(maxLive).toBe(24)
    expect(pool.live).toBe(24)
    for (let q = 0; q < 1000; q++) {
      pool.render(left, right)
      expect(pool.live).toBeLessThanOrEqual(24)
    }
    expect(pool.live).toBe(0)
    slotArrays(pool).forEach((a, i) => expect(a).toBe(arrays[i]))
  })

  it('steals the quietest voice, never a louder one', () => {
    const pool = new VoicePool(SAMPLE_RATE)
    // Slot i gets impact 0.30 + 0.02 i, so slot 0 is the quietest.
    for (let i = 0; i < 24; i++) expect(pool.trigger(hit(0.3 + i * 0.02))).toBe(i)
    expect(pool.live).toBe(24)

    expect(pool.trigger(hit(0.9))).toBe(0)
    // Slot 1 is now the quietest.
    expect(pool.trigger(hit(0.9))).toBe(1)
    const stolen = pool.impact[2]!
    expect(stolen).toBeCloseTo(0.34, 5)
    expect(pool.live).toBe(24)
  })

  it('judges quietness by the current envelope, not the starting impact', () => {
    const pool = new VoicePool(SAMPLE_RATE)
    const left = new Float32Array(16)
    const right = new Float32Array(16)
    // A loud voice that has almost decayed out is quieter than a soft fresh one.
    const old = pool.trigger(hit(0.5))
    const length = pool.total[old]!
    while (pool.samplesLeft[old]! > length * 0.1) pool.render(left, right)
    for (let i = 0; i < 23; i++) pool.trigger(hit(0.2))
    expect(pool.live).toBe(24)
    expect(pool.level(old)).toBeLessThan(pool.level((old + 1) % 24))
    expect(pool.trigger(hit(0.2))).toBe(old)
  })

  it('takes a free slot before stealing', () => {
    const pool = new VoicePool(SAMPLE_RATE)
    const a = pool.trigger(hit(0.5))
    const b = pool.trigger(hit(0.5))
    expect(a).not.toBe(b)
    expect(pool.live).toBe(2)
  })

  it('drops inaudible hits, including NaN', () => {
    const pool = new VoicePool(SAMPLE_RATE)
    expect(pool.trigger(hit(MIN_AUDIBLE_IMPACT / 2))).toBe(-1)
    expect(pool.trigger(hit(Number.NaN))).toBe(-1)
    expect(pool.live).toBe(0)
  })

  it('renders a bounded, non-silent signal and pans it', () => {
    const pool = new VoicePool(SAMPLE_RATE)
    pool.trigger(hit(0.8, { pan: 1 }))
    const left = new Float32Array(QUANTUM)
    const right = new Float32Array(QUANTUM)
    pool.render(left, right)
    let l = 0
    let r = 0
    for (let i = 0; i < QUANTUM; i++) {
      expect(Number.isFinite(left[i]!)).toBe(true)
      l += Math.abs(left[i]!)
      r += Math.abs(right[i]!)
    }
    expect(r).toBeGreaterThan(0)
    expect(l).toBe(0)
  })

  it('writes mono output once when both channels are the same buffer', () => {
    const pool = new VoicePool(SAMPLE_RATE)
    pool.trigger(hit(0.8))
    const mono = new Float32Array(QUANTUM)
    pool.render(mono, mono)
    expect(mono.some((v) => v !== 0)).toBe(true)
  })

  it('clears a voice at the end of its length and frees the slot', () => {
    const pool = new VoicePool(SAMPLE_RATE)
    pool.trigger(hit(1))
    const left = new Float32Array(QUANTUM)
    const right = new Float32Array(QUANTUM)
    for (let q = 0; q < 40; q++) pool.render(left, right)
    expect(pool.live).toBe(0)
    pool.render(left, right)
    expect(left.every((v) => v === 0)).toBe(true)
  })

  it('trigger() and render() contain no allocating constructs (structural)', () => {
    const src = readFileSync(path.join(ROOT, 'src/audio/voice-pool.ts'), 'utf8')
    for (const name of ['trigger', 'render']) {
      const start = src.indexOf(`  ${name}(`)
      expect(start, `${name} not found`).toBeGreaterThan(-1)
      const end = src.indexOf('\n  }\n', start)
      const body = src.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      // Drop the signature line (it names types), then look at the body.
      const code = body.slice(body.indexOf('{') + 1)
      expect(code).not.toMatch(/\bnew\s/)
      expect(code).not.toMatch(/=>|\bfunction\b/)
      expect(code).not.toMatch(/\.(push|splice|shift|unshift|slice|map|filter|concat)\(/)
      expect(code).not.toMatch(/(^|[=(,:\s])\[/m)
      expect(code).not.toMatch(/\{\s*\w+\s*:/)
      expect(code).not.toMatch(/`/)
    }
  })
})

describe('panFromPlayfieldX', () => {
  it('maps playfield x to [-1, 1]', () => {
    expect(panFromPlayfieldX(0)).toBe(0)
    expect(panFromPlayfieldX(6)).toBe(0.5)
    expect(panFromPlayfieldX(-6)).toBe(-0.5)
    expect(panFromPlayfieldX(50)).toBe(1)
    expect(panFromPlayfieldX(-50)).toBe(-1)
    expect(panFromPlayfieldX(Number.NaN)).toBe(0)
    expect(panFromPlayfieldX(8, 16)).toBe(0.5)
  })
})

describe('pachinko-voice-processor.ts', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('registers "pachinko-voice" and plays a posted VoiceHit as-is', async () => {
    class FakeProcessor {
      port: { onmessage: ((e: { data: VoiceHit }) => void) | null } = { onmessage: null }
    }
    const registered: Array<[string, new () => FakeProcessor & { process: (i: unknown, o: Float32Array[][]) => boolean }]> = []
    vi.stubGlobal('AudioWorkletProcessor', FakeProcessor)
    vi.stubGlobal('sampleRate', SAMPLE_RATE)
    vi.stubGlobal('registerProcessor', (name: string, ctor: never) => { registered.push([name, ctor]) })

    await import('../src/audio/pachinko-voice-processor')
    expect(registered).toHaveLength(1)
    const [name, Ctor] = registered[0]!
    expect(name).toBe('pachinko-voice')

    const proc = new Ctor()
    const out = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)]
    expect(proc.process([], [out])).toBe(true)
    expect(out[0]!.every((v) => v === 0)).toBe(true)

    const message = hit(0.9, { pan: -1 })
    for (let n = 0; n < 500; n++) proc.port.onmessage!({ data: message })
    expect(proc.process([], [out])).toBe(true)
    expect(out[0]!.some((v) => v !== 0)).toBe(true)
    expect(out[1]!.every((v) => v === 0)).toBe(true)
    for (let q = 0; q < 1000; q++) proc.process([], [out])
    expect(out[0]!.every((v) => v === 0)).toBe(true)

    // A degenerate output (no channels) must not throw.
    expect(proc.process([], [])).toBe(true)
  })
})

describe('generated worklet script', () => {
  it('is the only JavaScript under public/audio and carries the GENERATED banner', () => {
    const dir = path.join(ROOT, 'public/audio')
    const scripts = readdirSync(dir).filter((f) => /\.(m?js|cjs)$/.test(f))
    expect(scripts).toEqual(['pachinko-voice-processor.js'])
    const body = readFileSync(path.join(dir, scripts[0]!), 'utf8')
    expect(body.startsWith('// GENERATED from src/audio/pachinko-voice-processor.ts')).toBe(true)
    expect(body).not.toMatch(/^\s*(import|export)\s/m)
    expect(body).toContain("registerProcessor(\"pachinko-voice\"")
  })

  it('matches its TypeScript source (check:worklet)', () => {
    expect(() =>
      execFileSync(process.execPath, ['scripts/build-audio-worklet.mjs', '--check'], { cwd: ROOT, stdio: 'pipe' }),
    ).not.toThrow()
  })
})
