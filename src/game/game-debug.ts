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
import type { GameObjects } from '../objects'
import type { GamePhysicsController } from './game-physics-controller'
import type { GameStateManager } from './game-state'
import type { DebugSnapshot, PerformanceMonitor } from '../game-elements'
import { GameState } from '../game-elements'
import type { AdventureProgressionSupervisor } from '../game-elements/adventure-progression-supervisor'
import type { AdventureTrackProgression } from '../game-elements/adventure-track-progression'
import { TRACK_CATALOG } from '../game-elements/adventure-track-progression'

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
  readonly gameObjects: GameObjects | null
  readonly physicsController: GamePhysicsController
  readonly adventureProgressionSupervisor: AdventureProgressionSupervisor | null
  readonly adventureTrackProgression: AdventureTrackProgression | null
  readonly performanceMonitor: PerformanceMonitor

  readonly debugHUDQueryEnabled: boolean
  comboCount: number
  adventureModeStartMs: number | null
  score: number

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

  handleDebugHUDVisibilityChange(visible: boolean, onVisible?: () => void, onHidden?: () => void): void {
    if (visible) {
      this.initializeDebugInstrumentation()
      onVisible?.()
      return
    }
    onHidden?.()
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

  buildDebugSnapshot(rawDt: number, lives: number): DebugSnapshot {
    const gameState = GameState[this.host.stateManager.getState()] ?? 'UNKNOWN'
    const displayState = this.host.display?.getDisplayState() ?? 'none'
    const drawCallsCounter = (this.host.engine as unknown as { _drawCalls?: { current?: number } })._drawCalls
    const adventureTrack = this.host.adventureMode?.getCurrentZone()
    const campaignTrackId = this.host.adventureTrackProgression?.getCurrentTrack() ?? null
    const trackInfo = campaignTrackId ? TRACK_CATALOG[campaignTrackId] : null
    const activeZoneId = this.host.zoneTriggerSystem?.getCurrentZoneId()
    const dynamicZoneLabel = activeZoneId ?? this.host.dynamicWorld?.getCurrentZoneInfo()?.name ?? null
    const multiplier = Math.floor(this.host.comboCount / 3) + 1
    const isAdventureActive = this.host.adventureMode?.isActive() ?? false
    const supervisor = this.host.adventureProgressionSupervisor
    const adventureTimeMs = supervisor && supervisor.getTimeRemaining() > 0
      ? Math.round(supervisor.getTimeRemaining() * 1000)
      : null
    const portalOpen = supervisor?.isPortalOpen() ?? false
    const portalKind = supervisor?.getPortalKind() ?? null
    const perfMetrics = this.host.performanceMonitor.getMetrics()
    const teardown = this.host.adventureMode?.getLastTeardownStats()

    return {
      gameState,
      displayState,
      score: this.host.score,
      multiplier,
      lives,
      adventureTrack: adventureTrack ? adventureTrack.replace(/_/g, ' ') : campaignTrackId,
      trackName: trackInfo?.name ?? (campaignTrackId?.replace(/_/g, ' ') ?? null),
      goalProgressPct: supervisor?.getGoalProgressPercent(this.host.score) ?? 0,
      portalState: portalOpen ? 'open' : 'closed',
      portalKind,
      fps: this.host.scene?.getEngine().getFps() ?? perfMetrics.fps,
      drawCalls: drawCallsCounter?.current ?? perfMetrics.drawCalls,
      frameTimeMs: perfMetrics.frameTimeMs > 0 ? perfMetrics.frameTimeMs : rawDt * 1000,
      activeBodies: this.host.physics.getActiveBodyCount(),
      colliderCount: this.host.physics.getColliderCount(),
      physicsMemoryKb: this.host.physics.getEstimatedMemoryKb(),
      physicsStepMs: perfMetrics.physicsStepMs > 0 ? perfMetrics.physicsStepMs : rawDt * 1000,
      adventureTimeMs,
      dynamicZoneState: dynamicZoneLabel,
      performanceTier: this.host.effects?.getRuntimePerformanceTier() || 'high',
      rendererBackend: perfMetrics.rendererBackend,
      activeParticles: perfMetrics.activeParticles,
      goldBallsInPlay: perfMetrics.goldBallsInPlay,
      lastTrackSwitchMs: perfMetrics.lastTrackSwitchMs,
      adventureActive: isAdventureActive,
      portalSensorHandle: this.host.adventureMode?.getPortalSensorHandle() ?? -1,
      portalHandleSetSize: this.host.physicsController.getPortalSensorHandleSetSize(),
      tablePhysicsEnabled: this.host.gameObjects?.areTableBodiesEnabled() ?? true,
      activeCameraType: this.host.scene?.activeCamera?.getClassName() ?? 'n/a',
      teardownMeshes: teardown?.meshesDisposed ?? 0,
      teardownBodies: teardown?.bodiesRemoved ?? 0,
      teardownLingering: teardown?.lingeringBodies ?? 0,
      bumperHitsThisBall: this.host.physicsController.getBumperHitsThisBall?.() ?? 0,
      pointsThisBall: this.host.physicsController.getPointsThisBall?.() ?? 0,
      zoneEntriesThisBall: this.host.zoneTriggerSystem?.getZoneEntriesThisBall?.() ?? 0,
      rawCollisionEvents: this.host.physicsController.getRawCollisionEvents?.() ?? 0,
      knownObstacleMatches: this.host.physicsController.getKnownObstacleMatches?.() ?? 0,
      bumperMatches: this.host.physicsController.getBumperMatches?.() ?? 0,
      awardScoreCalls: this.host.physicsController.getAwardScoreCalls?.() ?? 0,
    }
  }

  updateDeveloperSettingsVisibility(): void {
    const developerSection = document.getElementById('developer-settings')
    if (!developerSection) return
    developerSection.classList.toggle('hidden', !this.isDebugHUDAvailable())
  }
}
