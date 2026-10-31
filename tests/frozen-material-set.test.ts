import { describe, expect, it } from 'vitest'
import { FrozenMaterialSet, type FreezableMaterial } from '../src/game/frozen-material-set'
import { StaticSceneGate, FRAMES_BEFORE_REFREEZE, type StaticSceneGateHost } from '../src/core/static-scene-gate'

function makeMaterial(name: string, log: string[] = []): FreezableMaterial & { lights: number } {
  const m = {
    name,
    isFrozen: false,
    lights: 4,
    get maxSimultaneousLights() {
      return m.lights
    },
    set maxSimultaneousLights(v: number) {
      m.lights = v
    },
    freeze() {
      m.isFrozen = true
      log.push(`freeze:${name}`)
    },
    unfreeze() {
      m.isFrozen = false
      log.push(`unfreeze:${name}`)
    },
  }
  return m
}

const REASON = 'unlit, never written'
const withMaterials = { reason: 'x', materials: true, shadows: false }
const withoutMaterials = { reason: 'x', materials: false, shadows: false }

describe('FrozenMaterialSet', () => {
  it('freezes every member on refreeze, and records why each is safe', () => {
    const set = new FrozenMaterialSet()
    const [a, b] = [makeMaterial('a'), makeMaterial('b')]
    set.add(a, 'reason a')
    set.add(b, 'reason b')
    expect(set.describe()).toEqual([['a', 'reason a'], ['b', 'reason b']])
    expect(set.isFrozen).toBe(false)

    set.refreeze()

    expect([a.isFrozen, b.isFrozen]).toEqual([true, true])
    expect(set.isFrozen).toBe(true)
  })

  it('does not add the same material twice', () => {
    const set = new FrozenMaterialSet()
    const a = makeMaterial('a')
    set.add(a, REASON)
    set.add(a, REASON)
    expect(set.size).toBe(1)
  })

  it('thaws only for invalidations that touch materials', () => {
    const set = new FrozenMaterialSet()
    const a = makeMaterial('a')
    set.add(a, REASON)
    set.refreeze()

    set.thaw(withoutMaterials) // a ball spawn
    expect(a.isFrozen).toBe(true)

    set.thaw(withMaterials) // a tier change / glTF load
    expect(a.isFrozen).toBe(false)
    expect(set.isFrozen).toBe(false)
  })

  it('re-runs the light clamp over the members BEFORE freezing them (WebGL2 ordering)', () => {
    const log: string[] = []
    const a = makeMaterial('a', log)
    const set = new FrozenMaterialSet({
      clampLights: (materials) => {
        log.push(`clamp:${materials.map((m) => m.name).join(',')}`)
        for (const m of materials) m.maxSimultaneousLights = 4
      },
    })
    set.add(a, REASON)
    set.refreeze()
    set.thaw(withMaterials)
    a.maxSimultaneousLights = 26 // what the glTF loader does to every material
    log.length = 0

    set.refreeze()

    expect(log).toEqual(['clamp:a', 'freeze:a'])
    expect(a.lights).toBe(4)
  })

  it('freezes (after clamping) a member added while the set is already frozen', () => {
    const log: string[] = []
    const set = new FrozenMaterialSet({ clampLights: (m) => { if (m.length > 0) log.push(`clamp:${m.map((x) => x.name).join(',')}`) } })
    set.refreeze()
    set.add(makeMaterial('late', log), REASON)
    expect(log).toEqual(['clamp:late', 'freeze:late'])
  })

  it('refreeze is idempotent while frozen and clear forgets the members', () => {
    const log: string[] = []
    const set = new FrozenMaterialSet()
    set.add(makeMaterial('a', log), REASON)
    set.refreeze()
    set.refreeze()
    expect(log).toEqual(['freeze:a'])
    set.clear()
    expect(set.size).toBe(0)
    expect(set.isFrozen).toBe(false)
  })

  describe('behind a StaticSceneGate', () => {
    function makeGate() {
      const observers: Array<() => void> = []
      const scene: StaticSceneGateHost = {
        onAfterRenderObservable: {
          add: (cb) => { observers.push(cb); return cb },
          remove: (o) => { observers.splice(observers.indexOf(o as () => void), 1) },
        },
      }
      const gate = new StaticSceneGate(scene, { watchMeshes: false })
      return { gate, frames: (n: number) => { for (let i = 0; i < n; i++) [...observers].forEach((cb) => cb()) } }
    }

    it('unfreezes, lets the mutation land, and refreezes after the compile frames', () => {
      const { gate, frames } = makeGate()
      const set = new FrozenMaterialSet()
      const a = makeMaterial('a')
      set.add(a, REASON)
      gate.registerTarget(set)
      gate.invalidate('boot', { materials: true })
      frames(FRAMES_BEFORE_REFREEZE)
      expect(a.isFrozen).toBe(true)

      gate.invalidate('quality-tier', { materials: true })
      expect(a.isFrozen).toBe(false) // thawed before the caller mutates anything
      frames(FRAMES_BEFORE_REFREEZE - 1)
      expect(a.isFrozen).toBe(false) // a compile frame runs unfrozen
      frames(1)
      expect(a.isFrozen).toBe(true)
    })

    it('leaves frozen materials alone for a ball spawn', () => {
      const { gate, frames } = makeGate()
      const set = new FrozenMaterialSet()
      const a = makeMaterial('a')
      set.add(a, REASON)
      gate.registerTarget(set)
      gate.invalidate('boot', { materials: true })
      frames(FRAMES_BEFORE_REFREEZE)

      gate.invalidate('ball:spawn')
      expect(a.isFrozen).toBe(true)
      frames(FRAMES_BEFORE_REFREEZE)
      expect(a.isFrozen).toBe(true)
    })

    it('stays thawed across a held cabinet load', () => {
      const { gate, frames } = makeGate()
      const set = new FrozenMaterialSet()
      const a = makeMaterial('a')
      set.add(a, REASON)
      gate.registerTarget(set)
      gate.invalidate('boot', { materials: true })
      frames(FRAMES_BEFORE_REFREEZE)

      const release = gate.hold('cabinet:load', { materials: true, shadows: true })
      frames(30)
      expect(a.isFrozen).toBe(false)
      release()
      frames(FRAMES_BEFORE_REFREEZE)
      expect(a.isFrozen).toBe(true)
    })
  })
})
