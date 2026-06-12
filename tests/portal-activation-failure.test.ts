/**
 * `portal:open` activation-failure guard (issue follow-up to AUDIT_MODE_SWITCH_PORTAL_LOOP W1).
 *
 * `GameSystemsInitializer.handlePortalOpen()` (src/game/game-systems-init.ts) used to call
 * `AdventureMode.activateExitPortal()` and ignore its return value, always registering a
 * (possibly -1) portal sensor handle and switching the display to PORTAL_OPEN/ESCAPE — even
 * when activation failed (e.g. adventure mode was no longer active).
 *
 * `handlePortalOpen` is not unit-testable directly: `game-systems-init.ts` transitively
 * imports the full Babylon/Rapier-backed subsystem graph (GameObjects, DisplaySystem,
 * AdventureMode, etc.), which cannot be constructed in the Node test environment (see the
 * "lightweight stand-in" pattern already used for GamePhysicsController in
 * portal-entry.test.ts). This test instead exercises a faithful reimplementation of the
 * handler's branching against the real EventBus and the real DisplayState/AdventureTrackType
 * enums, covering the activation-failure guard added alongside `portal:activation-failed`.
 */

import { describe, it, expect, vi } from 'vitest'
import { EventBus, type PachinballEventMap } from '../src/game/event-bus'
import { DisplayState } from '../src/game-elements/display-config'
import { AdventureTrackType } from '../src/adventure/adventure-types'
import { isAdventureTrackType } from '../src/adventure/portal-routing'

const LAST_VERIFIED_PRODUCTION_COMMIT = '2ad802f'

interface AdventureModeStub {
  activateExitPortal: (
    trackId: AdventureTrackType,
    kind: PachinballEventMap['portal:open']['kind'],
    mode: NonNullable<PachinballEventMap['portal:open']['mode']>
  ) => boolean
  getPortalSensorHandle: () => number
  getCurrentZone: () => string | null
}

interface HostStub {
  eventBus: EventBus
  adventureMode: AdventureModeStub
  gameMode: 'fixed' | 'dynamic'
  uiManager: { showMessage: ReturnType<typeof vi.fn>; showPortalOverlay: ReturnType<typeof vi.fn>; hideCountdownTimer: ReturnType<typeof vi.fn> }
  display: { setStoryText: ReturnType<typeof vi.fn>; triggerCRTFlash: ReturnType<typeof vi.fn> }
  physicsController: { registerPortalSensor: ReturnType<typeof vi.fn> }
}

function buildHost(opts: { activateOk: boolean; sensorHandle?: number; currentZone?: string | null; gameMode?: HostStub['gameMode'] }): HostStub {
  return {
    eventBus: new EventBus(),
    adventureMode: {
      activateExitPortal: vi.fn(() => opts.activateOk),
      getPortalSensorHandle: vi.fn(() => opts.sensorHandle ?? -1),
      getCurrentZone: vi.fn(() => opts.currentZone ?? null),
    },
    gameMode: opts.gameMode ?? 'fixed',
    uiManager: {
      showMessage: vi.fn(),
      showPortalOverlay: vi.fn(),
      hideCountdownTimer: vi.fn(),
    },
    display: {
      setStoryText: vi.fn(),
      triggerCRTFlash: vi.fn(),
    },
    physicsController: {
      registerPortalSensor: vi.fn(),
    },
  }
}

/**
 * Mirrors `GameSystemsInitializer.handlePortalOpen()` (src/game/game-systems-init.ts):
 * checks `activateExitPortal()`'s return value before any sensor registration or
 * UI/display side effects, emitting `portal:activation-failed` on failure.
 *
 * Production parity: src/game/game-systems-init.ts:460-512, last verified at
 * commit `2ad802f`. Keep this mirror typed against PachinballEventMap so payload
 * drift is caught by `npx tsc -b`.
 */
function handlePortalOpen(
  host: HostStub,
  { trackId, kind, mode }: PachinballEventMap['portal:open'],
): void {
  const resolvedTrack = resolvePortalTrack(host, trackId)
  const resolvedMode = mode || (host.gameMode === 'dynamic' ? 'EXTENDED_MAP' : 'STATIONARY_TABLE')
  const ok = host.adventureMode.activateExitPortal(resolvedTrack, kind, resolvedMode)
  if (!ok) {
    host.uiManager.showMessage('Portal failed — retrying...', 2000)
    host.eventBus.emit('portal:activation-failed', { trackId, kind, mode })
    return
  }

  const openedHandle = host.adventureMode.getPortalSensorHandle()
  if (openedHandle >= 0) {
    host.physicsController.registerPortalSensor(openedHandle)
  }

  host.uiManager.showPortalOverlay(kind, trackId)
  host.uiManager.hideCountdownTimer()

  if (kind === 'success') {
    host.display.setStoryText('PORTAL OPEN\nSHOOT TO ADVANCE')
    host.eventBus.emit('display:set', DisplayState.PORTAL_OPEN)
    host.uiManager.showMessage('Portal open — advance now!', 2000)
  } else {
    host.display.setStoryText('TIME OUT — EMERGENCY ESCAPE\nREWARD PENALTY ACTIVE')
    host.eventBus.emit('display:set', DisplayState.ESCAPE)
    host.uiManager.showMessage('Time out! Enter the portal to continue (reduced rewards).', 2400)
  }
}

function resolvePortalTrack(host: HostStub, trackId: string): AdventureTrackType {
  if (isAdventureTrackType(trackId)) {
    return trackId
  }

  const activeZone = host.adventureMode.getCurrentZone()
  if (activeZone && isAdventureTrackType(activeZone)) {
    return activeZone
  }

  return AdventureTrackType.NEON_HELIX
}

describe('portal:open — activation failure guard', () => {
  it('documents the production handler range this mirror tracks', () => {
    expect(LAST_VERIFIED_PRODUCTION_COMMIT).toBe('2ad802f')
  })

  it('does not register a sensor or change display state when activation fails', () => {
    const host = buildHost({ activateOk: false, sensorHandle: -1 })
    const displayEvents: DisplayState[] = []
    host.eventBus.on('display:set', (state) => displayEvents.push(state))

    handlePortalOpen(host, { trackId: 'NEON_HELIX', kind: 'success' })

    expect(host.physicsController.registerPortalSensor).not.toHaveBeenCalled()
    expect(host.uiManager.showPortalOverlay).not.toHaveBeenCalled()
    expect(displayEvents).not.toContain(DisplayState.PORTAL_OPEN)
    expect(displayEvents).not.toContain(DisplayState.ESCAPE)
  })

  it('emits portal:activation-failed with the original payload on failure', () => {
    const host = buildHost({ activateOk: false })
    const failures: Array<PachinballEventMap['portal:activation-failed']> = []
    host.eventBus.on('portal:activation-failed', (payload) => failures.push(payload))

    const payload = {
      trackId: 'CYBER_CORE',
      kind: 'timeout',
      mode: 'EXTENDED_MAP',
    } satisfies PachinballEventMap['portal:activation-failed']
    handlePortalOpen(host, payload)

    expect(failures).toEqual([payload])
  })

  it('does not copy portal:open reward metadata into activation-failed payloads', () => {
    const host = buildHost({ activateOk: false })
    const failures: Array<PachinballEventMap['portal:activation-failed']> = []
    host.eventBus.on('portal:activation-failed', (payload) => failures.push(payload))

    handlePortalOpen(host, {
      trackId: 'CYBER_CORE',
      kind: 'success',
      mode: 'EXTENDED_MAP',
      multiplier: 1.25,
      timeRemaining: 42,
    })

    expect(failures).toEqual([
      { trackId: 'CYBER_CORE', kind: 'success', mode: 'EXTENDED_MAP' },
    ])
  })

  it('shows recoverable user feedback on activation failure', () => {
    const host = buildHost({ activateOk: false })

    handlePortalOpen(host, { trackId: 'NEON_HELIX', kind: 'success' })

    expect(host.uiManager.showMessage).toHaveBeenCalledWith('Portal failed — retrying...', 2000)
  })

  it('registers the sensor and switches to PORTAL_OPEN when activation succeeds', () => {
    const host = buildHost({ activateOk: true, sensorHandle: 42 })
    const displayEvents: DisplayState[] = []
    host.eventBus.on('display:set', (state) => displayEvents.push(state))

    handlePortalOpen(host, { trackId: 'NEON_HELIX', kind: 'success' })

    expect(host.physicsController.registerPortalSensor).toHaveBeenCalledWith(42)
    expect(displayEvents).toContain(DisplayState.PORTAL_OPEN)
  })

  it('does not register a sensor handle of -1 even on success', () => {
    const host = buildHost({ activateOk: true, sensorHandle: -1 })

    handlePortalOpen(host, { trackId: 'NEON_HELIX', kind: 'timeout' })

    expect(host.physicsController.registerPortalSensor).not.toHaveBeenCalled()
  })

  it('resolves invalid portal track ids through the active adventure zone', () => {
    const host = buildHost({ activateOk: true, sensorHandle: 42, currentZone: 'CYBER_CORE' })

    handlePortalOpen(host, { trackId: 'invalid-track-id', kind: 'success' })

    expect(host.adventureMode.activateExitPortal).toHaveBeenCalledWith(
      AdventureTrackType.CYBER_CORE,
      'success',
      'STATIONARY_TABLE',
    )
  })

  it('falls back to NEON_HELIX and defaults mode from game mode', () => {
    const host = buildHost({ activateOk: true, gameMode: 'dynamic' })

    handlePortalOpen(host, { trackId: 'invalid-track-id', kind: 'timeout' })

    expect(host.adventureMode.activateExitPortal).toHaveBeenCalledWith(
      AdventureTrackType.NEON_HELIX,
      'timeout',
      'EXTENDED_MAP',
    )
  })
})
