/**
 * Draws a rules program's presentation cues (#556): `rules:cue` on the EventBus → the effects
 * system, haptics and the HUD message. The rendered game's `GamePhysicsController` subscribes; the
 * sim (and the headless replay runner) never does, so a cue can never move a score or a ball.
 *
 * Lamp cues have no renderer yet: a program's lamps are state its conditions read (`lit`), and the
 * insert lamps that will draw them arrive with the playfield primitives (#556 Slice 2).
 */

import type { PachinballEventMap } from '../../core/event-bus'
import type { PhysicsHost } from './types'

export function presentRulesCue(host: Pick<PhysicsHost, 'effects' | 'hapticManager' | 'showMessage'>, cue: PachinballEventMap['rules:cue']): void {
  if ('lighting' in cue) host.effects?.setLightingMode(cue.lighting.mode, cue.lighting.seconds)
  else if ('atmosphere' in cue) host.effects?.setAtmosphereState(cue.atmosphere)
  else if ('beep' in cue) host.effects?.playBeep(cue.beep)
  else if ('bloom' in cue) host.effects?.setBloomEnergy(cue.bloom)
  else if ('goldPulse' in cue) host.effects?.startSolidGoldPulse()
  else if ('haptic' in cue) {
    if (cue.haptic === 'jackpot') host.hapticManager?.jackpot()
    else if (cue.haptic === 'ballLost') host.hapticManager?.ballLost()
    else host.hapticManager?.bumper(8)
  } else if ('message' in cue) host.showMessage(cue.message.text, cue.message.ms)
}
