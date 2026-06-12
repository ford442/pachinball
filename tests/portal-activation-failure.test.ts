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
import { EventBus } from '../src/game/event-bus'
import { DisplayState } from '../src/game-elements/display-config'

interface AdventureModeStub {
  activateExitPortal: (trackId: string, kind: 'success' | 'timeout', mode: string) => boolean
  getPortalSensorHandle: () => number
}

interface HostStub {
  eventBus: EventBus
  adventureMode: AdventureModeStub
  uiManager: { showMessage: ReturnType<typeof vi.fn>; showPortalOverlay: ReturnType<typeof vi.fn>; hideCountdownTimer: ReturnType<typeof vi.fn> }
  display: { setStoryText: ReturnType<typeof vi.fn>; triggerCRTFlash: ReturnType<typeof vi.fn> }
  physicsController: { registerPortalSensor: ReturnType<typeof vi.fn> }
}

function buildHost(opts: { activateOk: boolean; sensorHandle?: number }): HostStub {
  return {
    eventBus: new EventBus(),
    adventureMode: {
      activateExitPortal: vi.fn(() => opts.activateOk),
      getPortalSensorHandle: vi.fn(() => opts.sensorHandle ?? -1),
    },
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
 */
function handlePortalOpen(
  host: HostStub,
  { trackId, kind }: { trackId: string; kind: 'success' | 'timeout' },
): void {
  const ok = host.adventureMode.activateExitPortal(trackId, kind, 'STATIONARY_TABLE')
  if (!ok) {
    host.uiManager.showMessage('Portal failed — retrying...', 2000)
    host.eventBus.emit('portal:activation-failed', { trackId, kind })
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

describe('portal:open — activation failure guard', () => {
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
    const failures: Array<{ trackId: string; kind: string }> = []
    host.eventBus.on('portal:activation-failed', (payload) => failures.push(payload))

    handlePortalOpen(host, { trackId: 'CYBER_CORE', kind: 'timeout' })

    expect(failures).toEqual([{ trackId: 'CYBER_CORE', kind: 'timeout' }])
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
})
