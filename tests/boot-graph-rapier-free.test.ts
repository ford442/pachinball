import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Rapier is a lazily loaded dev/degrade engine (`src/game-elements/rapier-loader.ts`).
 * The orchestrator must not even *name* it: `PhysicsSystem` is the opaque handle, and
 * `preloadPhysicsSystem()` is the only bootstrap code that decides whether to warm it.
 */
const bootGraphSources = ['src/main.ts', 'src/game.ts']

describe('boot graph stays Rapier-free', () => {
  it.each(bootGraphSources)('%s has no Rapier import, type or loader reference', (rel) => {
    const src = readFileSync(resolve(rel), 'utf8')
    expect(src, `${rel} must not mention @dimforge/rapier3d`).not.toMatch(/@dimforge\/rapier3d/)
    expect(src, `${rel} must not reference the RAPIER namespace`).not.toMatch(/\bRAPIER\b/)
    expect(src, `${rel} must not import rapier-loader`).not.toMatch(/rapier-loader/)
  })
})
