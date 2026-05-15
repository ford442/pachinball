/**
 * Obstacle EventBus Integration
 * Manages event emission for all obstacle systems (spinners, traps, launchers, gates, drop targets)
 */

import type { EventBus } from '../game/event-bus'

/**
 * Obstacle EventBus Manager
 * Provides methods to emit obstacle-related events through the EventBus
 */
export class ObstacleEventBusIntegration {
  private eventBus: EventBus

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus
  }

  // Spinner Bumper Events
  emitSpinnerHit(spinnerId: string, position: { x: number; y: number; z: number }, force: number): void {
    this.eventBus.emit('bumper:spinner:hit', { spinnerId, position, force })
  }

  emitSpinnerRotation(spinnerId: string, rotationSpeed: number, progress: number): void {
    this.eventBus.emit('bumper:spinner:rotation', { spinnerId, rotationSpeed, progress })
  }

  emitSpinnerFullRotation(spinnerId: string, completions: number): void {
    this.eventBus.emit('bumper:spinner:full-rotation', { spinnerId, completions })
  }

  // Ball Trap Events
  emitTrapBallCaptured(trapId: string, ballId: string, position: { x: number; y: number; z: number }): void {
    this.eventBus.emit('trap:ball:captured', { trapId, ballId, position })
  }

  emitTrapBallReleased(trapId: string, ballId: string, exitVelocity: { x: number; y: number; z: number }): void {
    this.eventBus.emit('trap:ball:released', { trapId, ballId, exitVelocity })
  }

  // Launcher Events
  emitLauncherCharged(launcherId: string, chargeLevel: number): void {
    this.eventBus.emit('launcher:charged', { launcherId, chargeLevel })
  }

  emitLauncherFired(launcherId: string, ballId: string, force: { x: number; y: number; z: number }, chargeRatio: number): void {
    this.eventBus.emit('launcher:fired', { launcherId, ballId, force, chargeRatio })
  }

  emitLauncherTriggered(launcherId: string, ballId: string): void {
    this.eventBus.emit('launcher:triggered', { launcherId, ballId })
  }

  // Moving Gate Events
  emitGateTriggered(gateId: string, position: { x: number; y: number; z: number }): void {
    this.eventBus.emit('gate:triggered', { gateId, position })
  }

  emitGateOpened(gateId: string, duration: number): void {
    this.eventBus.emit('gate:opened', { gateId, duration })
  }

  emitGateClosed(gateId: string): void {
    this.eventBus.emit('gate:closed', { gateId })
  }

  emitGateStateChanged(gateId: string, isOpen: boolean): void {
    this.eventBus.emit('gate:state-changed', { gateId, isOpen })
  }

  // Drop Target Events
  emitDropTargetHit(targetId: string, bankId: string, position: { x: number; y: number; z: number }): void {
    this.eventBus.emit('drop-target:hit', { targetId, bankId, position })
  }

  emitDropTargetBankComplete(bankId: string, targetCount: number): void {
    this.eventBus.emit('drop-target:bank-complete', { bankId, targetCount })
  }

  emitDropTargetBankReset(bankId: string): void {
    this.eventBus.emit('drop-target:bank-reset', { bankId })
  }

  // Scoring and Feedback Events
  emitPointsAwarded(amount: number, source: string, position?: { x: number; y: number; z: number }, multiplier?: number): void {
    this.eventBus.emit('points:awarded', { amount, source, position, multiplier })
  }

  emitComboStarted(comboCount: number): void {
    this.eventBus.emit('combo:started', { comboCount })
  }

  emitComboExtended(comboCount: number): void {
    this.eventBus.emit('combo:extended', { comboCount })
  }

  emitComboBroken(finalComboCount: number): void {
    this.eventBus.emit('combo:broken', { finalComboCount })
  }

  // Effect Events
  emitFlashEffect(intensity: number, color?: string, duration?: number): void {
    this.eventBus.emit('effect:flash', { color, intensity, duration: duration ?? 0.2 })
  }

  emitBloomEffect(intensity: number, duration?: number): void {
    this.eventBus.emit('effect:bloom', { intensity, duration })
  }

  emitShakeEffect(amount: number, duration?: number): void {
    this.eventBus.emit('effect:shake', { amount, duration: duration ?? 0.2 })
  }

  // Sound and Audio Events
  emitPlaySound(soundKey: string, volume?: number, pitch?: number): void {
    this.eventBus.emit('sound:play', { soundKey, volume, pitch })
  }

  emitMusicIntensity(intensity: number, duration?: number): void {
    this.eventBus.emit('music:intensity', { intensity, duration })
  }

  emitMusicTransition(fromIntensity: number, toIntensity: number, duration: number): void {
    this.eventBus.emit('music:transition', { fromIntensity, toIntensity, duration })
  }
}
