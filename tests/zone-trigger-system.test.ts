/**
 * ZoneTriggerSystem is zone policy fed by sensor contacts: callbacks, the
 * current/previous zone, and a boundary debounce counted in sim steps. It does
 * not poll a ball position (the physics engine sweeps the sensor volumes and
 * reports begin/end), and it never reads wall time.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  ZoneTriggerSystem,
  ZONE_DEBOUNCE_STEPS,
  createZoneBounds,
  type ZoneBounds,
  type ZoneSensorSink,
} from '../src/game-elements/zone-trigger-system'
import { getScenario } from '../src/game-elements/dynamic-scenarios'
import { installSimClock } from '../src/core/sim-clock'

const BOX: ZoneBounds = { minX: -1, maxX: 1, minZ: -1, maxZ: 1, minY: -1, maxY: 2 }
const BALL = 7

function fakeSensors() {
  const authored = new Map<string, ZoneBounds>()
  const adopted = new Map<string, number>()
  const sink: ZoneSensorSink = {
    author: vi.fn((id: string, bounds: ZoneBounds) => {
      authored.set(id, bounds)
    }),
    adopt: vi.fn((id: string, handle: number) => {
      adopted.set(id, handle)
    }),
    release: vi.fn((id: string) => {
      authored.delete(id)
      adopted.delete(id)
    }),
    zoneIdOf: (handle: number) => [...adopted].find(([, h]) => h === handle)?.[0] ?? null,
    bodies: () => [],
    dispose: vi.fn(),
  }
  return { sink, authored, adopted }
}

/** A system on a test-controlled step counter. */
function build(debug = false) {
  const clock = { step: 0 }
  const system = new ZoneTriggerSystem(debug, () => clock.step)
  const sensors = fakeSensors()
  system.setSensors(sensors.sink)
  const log: string[] = []
  system.setCallback({
    onZoneEnter: (zone, from, major) => log.push(`enter ${zone.id} from=${from?.id ?? '-'} ${major ? 'major' : 'minor'}`),
    onZoneExit: (zone, to) => log.push(`exit ${zone.id} to=${to?.id ?? '-'}`),
    onPortalContact: (id, kind) => log.push(`portal ${id} ${kind}`),
  })
  return { system, clock, sensors, log }
}

afterEach(() => {
  installSimClock(null)
  vi.restoreAllMocks()
})

describe('ZoneTriggerSystem — contact feed', () => {
  it('does not poll: there is no per-frame update() taking ball positions', () => {
    const { system } = build()
    expect('update' in system).toBe(false)
  })

  it('fires onZoneEnter with the zone metadata on a ball begin, with no scenario loaded', () => {
    const { system, log } = build()
    system.registerObstacleZone('my-obstacle-zone', BOX)

    system.contactBegin('my-obstacle-zone', BALL)

    expect(log).toEqual(['enter my-obstacle-zone from=- major'])
    expect(system.getCurrentZoneId()).toBe('my-obstacle-zone')
    expect(system.isInZone()).toBe(true)
    expect(system.getZoneEntriesThisBall()).toBe(1)
  })

  it('ignores contacts for a zone that was never registered or has been unregistered', () => {
    const { system, log } = build()
    system.contactBegin('nope', BALL)
    system.registerObstacleZone('removable-zone', BOX)
    system.unregisterObstacleZone('removable-zone')
    system.contactBegin('removable-zone', BALL)
    expect(log).toEqual([])
  })

  it('fires onPortalContact right after onZoneEnter for a portal zone, with its kind', () => {
    for (const kind of ['success', 'timeout'] as const) {
      const { system, log } = build()
      system.registerPortalZone('NEON_HELIX-exit-portal', BOX, kind)
      system.contactBegin('NEON_HELIX-exit-portal', BALL)
      expect(log).toEqual([
        'enter NEON_HELIX-exit-portal from=- major',
        `portal NEON_HELIX-exit-portal ${kind}`,
      ])
    }
  })

  it('does not fire onPortalContact for a non-portal zone, nor after unregisterPortalZone', () => {
    const { system, log } = build()
    system.registerObstacleZone('NEON_HELIX-bumper', BOX)
    system.contactBegin('NEON_HELIX-bumper', BALL)
    expect(log.some((l) => l.startsWith('portal'))).toBe(false)

    system.registerPortalZone('p', BOX, 'success')
    system.unregisterPortalZone('p')
    log.length = 0
    system.contactBegin('p', BALL)
    expect(log).toEqual([])
  })

  it('clears every zone and callback on dispose', () => {
    const { system, log, sensors } = build()
    system.registerPortalZone('p', BOX, 'success')
    system.dispose()
    system.setCallback({ onZoneEnter: (z) => log.push(`enter ${z.id}`), onPortalContact: () => log.push('portal') })
    system.contactBegin('p', BALL)
    expect(log).toEqual([])
    expect(sensors.sink.dispose).toHaveBeenCalledOnce()
  })

  it('addCallback listeners survive setCallback and stop when removed', () => {
    const { system } = build()
    system.registerPortalZone('p', BOX, 'success')
    const onPortalContact = vi.fn()
    const remove = system.addCallback({ onPortalContact })

    system.setCallback({ onZoneEnter: () => {} }) // a scenario replaces the primary callback
    system.contactBegin('p', BALL)
    expect(onPortalContact).toHaveBeenCalledExactlyOnceWith('p', 'success')

    remove()
    system.contactEnd('p', BALL)
    system.contactBegin('p', BALL + 1)
    expect(onPortalContact).toHaveBeenCalledOnce()
  })

  it('one callback throwing does not starve the others', () => {
    const { system } = build()
    system.registerObstacleZone('z', BOX)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const second = vi.fn()
    system.setCallback({ onZoneEnter: () => { throw new Error('boom') } })
    system.addCallback({ onZoneEnter: second })
    system.contactBegin('z', BALL)
    expect(second).toHaveBeenCalledOnce()
  })
})

describe('ZoneTriggerSystem — occupancy and transitions', () => {
  it('a zone with two balls is entered once and left by the last', () => {
    const { system, clock, log } = build()
    system.registerObstacleZone('z', BOX)

    system.contactBegin('z', 1)
    system.contactBegin('z', 2)
    clock.step += ZONE_DEBOUNCE_STEPS + 1
    system.contactEnd('z', 1)
    expect(log).toEqual(['enter z from=- major'])

    system.contactEnd('z', 2)
    expect(log).toEqual(['enter z from=- major', 'exit z to=-'])
  })

  it('moving between zones reports the exit to the next zone once, and the previous zone', () => {
    const { system, clock, log } = build()
    system.registerObstacleZone('a', BOX)
    system.registerObstacleZone('b', BOX)

    system.contactBegin('a', BALL)
    clock.step += 30
    system.contactBegin('b', BALL) // overlapping: b is entered before a is left
    clock.step += 30
    system.contactEnd('a', BALL)

    expect(log).toEqual([
      'enter a from=- major',
      'exit a to=b',
      'enter b from=a minor',
    ])
    expect(system.getCurrentZoneId()).toBe('b')
    expect(system.getPreviousZoneId()).toBe('a')
  })

  it('a different zone is never debounced: a thin zone crossed right after another still fires', () => {
    const { system, clock, log } = build()
    system.registerObstacleZone('a', BOX)
    system.registerObstacleZone('thin', BOX)

    system.contactBegin('a', BALL)
    clock.step += 1
    system.contactEnd('a', BALL)
    clock.step += 1
    system.contactBegin('thin', BALL) // two steps after entering a
    clock.step += 1
    system.contactEnd('thin', BALL)

    expect(log.filter((l) => l.startsWith('enter'))).toEqual(['enter a from=- major', 'enter thin from=a minor'])
  })

  it('a repeat begin for a ball already inside is not a second entry (ids shift on a re-export)', () => {
    const { system, log } = build()
    system.registerObstacleZone('z', BOX)
    system.contactBegin('z', BALL)
    system.contactBegin('z', BALL)
    expect(log).toEqual(['enter z from=- major'])
  })

  it('an end for a ball that was never inside is not an exit', () => {
    const { system, clock, log } = build()
    system.registerObstacleZone('z', BOX)
    system.registerObstacleZone('other', BOX)
    system.contactBegin('z', BALL)
    clock.step += ZONE_DEBOUNCE_STEPS + 1
    system.contactEnd('z', BALL + 1) // a stale pair for some other ball
    system.contactEnd('other', BALL)
    expect(log).toEqual(['enter z from=- major'])

    system.contactEnd('z', BALL) // the real exit, once
    system.contactEnd('z', BALL)
    expect(log).toEqual(['enter z from=- major', 'exit z to=-'])
  })

  it('leaving a zone keeps it current until another is entered', () => {
    const { system, clock } = build()
    system.registerObstacleZone('z', BOX)
    system.contactBegin('z', BALL)
    clock.step += ZONE_DEBOUNCE_STEPS + 5
    system.contactEnd('z', BALL)
    expect(system.getCurrentZoneId()).toBe('z')
  })
})

describe('ZoneTriggerSystem — debounce in sim steps', () => {
  it('is the former 200 ms window expressed in fixed steps', () => {
    expect(ZONE_DEBOUNCE_STEPS).toBe(12)
  })

  it('a ball jittering across a boundary inside the window is one visit', () => {
    const { system, clock, log } = build()
    system.registerObstacleZone('z', BOX)

    system.contactBegin('z', BALL)
    clock.step += 2
    system.contactEnd('z', BALL)
    clock.step += 2
    system.contactBegin('z', BALL)
    clock.step += 2
    system.contactEnd('z', BALL)
    clock.step += 2
    system.contactBegin('z', BALL)

    expect(log).toEqual(['enter z from=- major'])
  })

  it('a real exit is announced, then a re-entry after the window is a new entry', () => {
    const { system, clock, log } = build()
    system.registerObstacleZone('z', BOX)

    system.contactBegin('z', BALL)
    clock.step += ZONE_DEBOUNCE_STEPS + 1
    system.contactEnd('z', BALL)
    clock.step += ZONE_DEBOUNCE_STEPS + 1
    system.contactBegin('z', BALL)

    expect(log).toEqual(['enter z from=- major', 'exit z to=-', 'enter z from=z minor'])
    expect(system.getZoneEntriesThisBall()).toBe(2)
  })

  it('an exit held back by the window is confirmed by the next zone event, or by a late re-entry', () => {
    const { system, clock, log } = build()
    system.registerObstacleZone('a', BOX)
    system.registerObstacleZone('b', BOX)

    system.contactBegin('a', BALL)
    clock.step += 2
    system.contactEnd('a', BALL) // inside the window: held
    expect(log).toEqual(['enter a from=- major'])

    clock.step += ZONE_DEBOUNCE_STEPS // window now over
    system.contactBegin('b', 99) // any later zone event flushes the held exit
    expect(log[1]).toBe('exit a to=-')
  })

  it('counts sim steps only: wall-clock time cannot change what fires', () => {
    const run = (wall: () => number) => {
      vi.spyOn(performance, 'now').mockImplementation(wall)
      const { system, clock, log } = build()
      system.registerObstacleZone('z', BOX)
      system.contactBegin('z', BALL)
      clock.step += 3
      system.contactEnd('z', BALL)
      clock.step += 3
      system.contactBegin('z', BALL) // 6 steps later: still inside the window whatever the wall says
      clock.step += ZONE_DEBOUNCE_STEPS * 2
      system.contactEnd('z', BALL)
      vi.restoreAllMocks()
      return log
    }
    const frozen = run(() => 0)
    const racing = run(() => Math.random() * 1e9)
    expect(racing).toEqual(frozen)
    expect(frozen).toEqual(['enter z from=- major', 'exit z to=-'])
  })

  it('reads simClockSteps() by default', () => {
    let steps = 0
    installSimClock({ steps: () => steps, ms: () => steps * (1000 / 60) })
    const system = new ZoneTriggerSystem()
    system.setSensors(fakeSensors().sink)
    const onZoneEnter = vi.fn()
    system.setCallback({ onZoneEnter })
    system.registerObstacleZone('z', BOX)

    system.contactBegin('z', BALL)
    steps += 1
    system.contactEnd('z', BALL)
    steps += 1
    system.contactBegin('z', BALL) // 2 steps of sim time: flicker
    expect(onZoneEnter).toHaveBeenCalledOnce()
  })

  it('a clock that went backwards (a new game) never debounces', () => {
    const { system, clock, log } = build()
    system.registerObstacleZone('z', BOX)
    clock.step = 500
    system.contactBegin('z', BALL)
    clock.step = 10 // new GameSimClock
    system.contactEnd('z', BALL)
    system.contactBegin('z', BALL)
    expect(log).toEqual(['enter z from=- major', 'exit z to=-', 'enter z from=z minor'])
  })
})

describe('ZoneTriggerSystem — sensor registration', () => {
  it('authors a sensor per registered zone and releases it on unregister', () => {
    const { system, sensors } = build()
    system.registerObstacleZone('o', BOX)
    system.registerPortalZone('p', BOX, 'timeout')
    expect(sensors.authored.get('o')).toEqual(BOX)
    expect(sensors.authored.has('p')).toBe(true)

    system.unregisterObstacleZone('o')
    system.unregisterPortalZone('p')
    expect(sensors.authored.size).toBe(0)
  })

  it('adopts an existing body for a portal instead of authoring a second volume', () => {
    const { system, sensors } = build()
    system.registerPortalBody('NEON_HELIX-exit-portal', 41, 'success')
    expect(sensors.sink.author).not.toHaveBeenCalled()
    expect(system.zoneIdOfBody(41)).toBe('NEON_HELIX-exit-portal')

    system.unregisterPortalZone('NEON_HELIX-exit-portal')
    expect(system.zoneIdOfBody(41)).toBeNull()
  })

  it('loadScenario authors every scenario zone over the table height and replaces the previous scenario', () => {
    const { system, sensors } = build()
    const samurai = getScenario('samurai-realm')!
    system.registerObstacleZone('launcher-zone', BOX)

    system.loadScenario(samurai)
    for (const zone of samurai.zones) {
      expect(sensors.authored.get(zone.id)).toEqual(createZoneBounds(zone))
    }
    expect(system.getAllZones()).toEqual(samurai.zones)

    const noir = getScenario('cyber-noir')!
    system.loadScenario(noir)
    expect(sensors.authored.has(samurai.zones[0]!.id)).toBe(false)
    expect(sensors.authored.has(noir.zones[0]!.id)).toBe(true)
    // Ad hoc obstacle zones are not scenario zones: they survive a scenario switch.
    expect(sensors.authored.has('launcher-zone')).toBe(true)
  })

  it('unloadScenario drops the scenario zones and callback but keeps obstacle zones', () => {
    const { system, sensors, log } = build()
    system.registerObstacleZone('keep', BOX)
    system.loadScenario(getScenario('samurai-realm')!)
    system.unloadScenario()

    expect([...sensors.authored.keys()]).toEqual(['keep'])
    expect(system.getAllZones()).toEqual([])
    system.contactBegin('keep', BALL)
    expect(log).toEqual([]) // the scenario callback went with the scenario
  })

  it('clearObstacleZones removes ad hoc zones (and their sensors) but not scenario zones', () => {
    const { system, sensors } = build()
    const samurai = getScenario('samurai-realm')!
    system.loadScenario(samurai)
    system.registerObstacleZone('o', BOX)
    system.registerPortalZone('p', BOX, 'success')

    system.clearObstacleZones()
    expect(sensors.authored.has('o')).toBe(false)
    expect(sensors.authored.has('p')).toBe(false)
    expect(sensors.authored.size).toBe(samurai.zones.length)
  })

  it('works without a sensor registry (zones simply have no volume)', () => {
    const system = new ZoneTriggerSystem(false, () => 0)
    const onZoneEnter = vi.fn()
    system.setCallback({ onZoneEnter })
    system.registerObstacleZone('z', BOX)
    system.contactBegin('z', BALL)
    expect(onZoneEnter).toHaveBeenCalledOnce()
    expect(system.getSensorBodies()).toEqual([])
  })
})
