/**
 * Game Debug — Debug HUD instrumentation and snapshot building.
 */

import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation'
import { EngineInstrumentation } from '@babylonjs/core/Instrumentation/engineInstrumentation'
import type { Scene } from '@babylonjs/core'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import type { PhysicsSystem } from '../game-elements/physics'
import type { EffectsSystem } from '../effects'
import type { DisplaySystem } from '../display'
import type { AdventureMode } from '../adventure'
import type { ZoneTriggerSystem } from '../game-elements/zone-trigger-system'
import type { GameStateManager } from './game-state'
import type { DebugSnapshot } from '../game-elements'
import { GameState } from '../game-elements'

export interface DebugHost {
  readonly engine: Engine | WebGPUEngine
  readonly scene: Scene | null
  readonly stateManager: GameStateManager
  readonly display: DisplaySystem | null
  readonly physics: PhysicsSystem
  readonly effects: EffectsSystem | null
  readonly adventureMode: AdventureMode | null
  readonly zoneTriggerSystem: ZoneTriggerSystem | null
  readonly dynamicWorld: ReturnType<typeof import('../game-elements/dynamic-world').getDynamicWorld> | null

  readonly debugHUDQueryEnabled: boolean
  comboCount: number
  adventureModeStartMs: number | null

  sceneInstrumentation: SceneInstrumentation | null
  engineInstrumentation: EngineInstrumentation | null
}

export class GameDebug {
  private readonly host: DebugHost

  constructor(host: DebugHost) {
    this.host = host
  }

  isDebugHUDAvailable(): boolean {
    return import.meta.env.DEV || this.host.debugHUDQueryEnabled
  }

  isDebugHUDKeyboardEnabled(): boolean {
    return this.isDebugHUDAvailable()
  }

  handleDebugHUDVisibilityChange(visible: boolean): void {
    if (visible) {
      this.initializeDebugInstrumentation()
      return
    }
    this.disposeDebugInstrumentation()
  }

  initializeDebugInstrumentation(): void {
    const { scene, engine } = this.host
    if (!scene) return
    if (!this.host.sceneInstrumentation) {
      this.host.sceneInstrumentation = new SceneInstrumentation(scene)
      this.host.sceneInstrumentation.captureActiveMeshesEvaluationTime = false
      this.host.sceneInstrumentation.captureRenderTargetsRenderTime = false
      this.host.sceneInstrumentation.captureFrameTime = true
      this.host.sceneInstrumentation.captureInterFrameTime = false
    }
    if (!this.host.engineInstrumentation) {
      this.host.engineInstrumentation = new EngineInstrumentation(engine)
      this.host.engineInstrumentation.captureGPUFrameTime = false
      this.host.engineInstrumentation.captureShaderCompilationTime = false
    }
  }

  disposeDebugInstrumentation(): void {
    this.host.sceneInstrumentation?.dispose()
    this.host.sceneInstrumentation = null
    this.host.engineInstrumentation?.dispose()
    this.host.engineInstrumentation = null
  }

  buildDebugSnapshot(rawDt: number): DebugSnapshot {
    const gameState = GameState[this.host.stateManager.getState()] ?? 'UNKNOWN'
    const displayState = this.host.display?.getDisplayState() ?? 'none'
    const drawCallsCounter = (this.host.engine as unknown as { _drawCalls?: { current?: number } })._drawCalls
    const adventureTrack = this.host.adventureMode?.getCurrentZone()
    const activeZoneId = this.host.zoneTriggerSystem?.getCurrentZoneId()
    const dynamicZoneLabel = activeZoneId ?? this.host.dynamicWorld?.getCurrentZoneInfo()?.name ?? null
    const multiplier = Math.floor(this.host.comboCount / 3) + 1
    const isAdventureActive = this.host.adventureMode?.isActive() ?? false
    const adventureTimeMs = isAdventureActive && this.host.adventureModeStartMs !== null
      ? performance.now() - this.host.adventureModeStartMs
      : null

    return {
      gameState,
      displayState,
      score: 0, // filled by caller
      multiplier,
      lives: 0, // filled by caller
      adventureTrack: adventureTrack ? adventureTrack.replace(/_/g, ' ') : null,
      fps: this.host.scene?.getEngine().getFps() ?? 0,
      drawCalls: drawCallsCounter?.current ?? 0,
      frameTimeMs: rawDt * 1000,
      activeBodies: this.host.physics.getWorld()?.bodies.len() ?? 0,
      physicsStepMs: rawDt * 1000,
      adventureTimeMs,
      dynamicZoneState: dynamicZoneLabel,
      performanceTier: this.host.effects?.getRuntimePerformanceTier() || 'high',
    }
  }

  updateDeveloperSettingsVisibility(): void {
    const developerSection = document.getElementById('developer-settings')
    if (!developerSection) return
    developerSection.classList.toggle('hidden', !this.isDebugHUDAvailable())
  }
}
