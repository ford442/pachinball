/**
 * Console diagnostic for "the scene renders black / empty" reports.
 * Exposed as `window.runVisibilityDiagnostic()` by main.ts; reads the live Game on demand.
 */
import type { Camera } from '@babylonjs/core/Cameras/camera'
import type { Game } from '../game'

/** Orbit-camera fields that the base Camera type does not declare. */
interface OrbitCameraFields {
  target?: { asArray?: () => number[] }
  alpha?: number
  beta?: number
  radius?: number
}

export function runVisibilityDiagnostic(game: Game | undefined): void {
  if (!game) {
    console.error('Game not loaded')
    return
  }
  const scene = game.scene
  const engine = game.engine
  if (!scene) {
    console.error('Scene not ready')
    return
  }
  const cam = scene.activeCamera as (Camera & OrbitCameraFields) | null
  if (!cam) {
    console.error('No active camera')
    return
  }
  console.log('=== CAMERA ===')
  console.log('position:', cam.position?.asArray?.() || cam.position)
  console.log('target:', cam.target?.asArray?.() || cam.target)
  console.log('alpha/beta/radius:', cam.alpha, cam.beta, cam.radius)
  console.log('fov:', cam.fov, 'minZ:', cam.minZ, 'maxZ:', cam.maxZ)
  console.log('viewport:', cam.viewport)
  console.log('activeCameras:', scene.activeCameras?.map((c) => c.name))

  console.log('=== MESHES (count:', scene.meshes.length, ') ===')
  const interesting = scene.meshes.filter((m) =>
    /flipper|ball|bumper|wall|pin|playfield|lcd|cabinet/i.test(m.name),
  )
  console.table(
    interesting.map((m) => ({
      name: m.name,
      enabled: m.isEnabled(),
      visible: m.isVisible,
      visibility: m.visibility,
      inFrustum: cam.isInFrustum(m),
      x: m.position.x.toFixed(2),
      y: m.position.y.toFixed(2),
      z: m.position.z.toFixed(2),
      material: m.material?.name || '(none)',
      alpha: m.material?.alpha,
      parent: m.parent?.name || '(none)',
    })),
  )

  console.log('=== LIGHTS ===')
  console.table(
    scene.lights.map((l) => ({
      name: l.name,
      type: l.getClassName(),
      intensity: l.intensity,
      enabled: l.isEnabled(),
    })),
  )

  console.log('=== RENDER STATS ===')
  console.log('engine fps:', engine.getFps().toFixed(1))
  console.log('render width × height:', engine.getRenderWidth(), '×', engine.getRenderHeight())
  console.log('hardware scaling:', engine.getHardwareScalingLevel())
  console.log(
    'canvas client:',
    engine.getRenderingCanvas()?.clientWidth,
    '×',
    engine.getRenderingCanvas()?.clientHeight,
  )
  console.log('=== DIAGNOSTIC COMPLETE ===')
}
