import { Scene, Vector3, MeshBuilder, Mesh, StandardMaterial, PBRMaterial, Color3 } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { getMaterialLibrary } from '../materials'
import type { PhysicsBinding, BumperVisual } from '../game-elements/types'
import { INTENSITY, STATE_PROFILES, PALETTE, color, emissive, stateEmissive } from '../game-elements/visual-language'

export class BumperBuilder {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER
  private matLib: ReturnType<typeof getMaterialLibrary>

  constructor(
    scene: Scene,
    world: RAPIER.World,
    rapier: typeof RAPIER,
  ) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
    this.matLib = getMaterialLibrary(scene)
  }

  createBumpers(): {
    bumpers: Map<string, Mesh>
    bindings: PhysicsBinding[]
    bumperBodies: RAPIER.RigidBody[]
    bumperVisuals: BumperVisual[]
    meshes: Mesh[]
  } {
    const bumpers = new Map<string, Mesh>()
    const bindings: PhysicsBinding[] = []
    const bumperBodies: RAPIER.RigidBody[] = []
    const bumperVisuals: BumperVisual[] = []
    const meshes: Mesh[] = []

    const make = (x: number, z: number, colorHex: string, scale: number = 1.0) => {
      // ================================================================
      // ORGANIC BUMPER BODY - Flattened sphere with LOD
      // ================================================================
      const bumperHigh = MeshBuilder.CreateSphere('bump_high', { diameter: 0.9 * scale, segments: 32 }, this.scene) as Mesh
      bumperHigh.position.set(x, 0.5, z)
      bumperHigh.scaling = new Vector3(1, 0.7, 1)

      const bumperMedium = MeshBuilder.CreateSphere('bump_med', { diameter: 0.9 * scale, segments: 16 }, this.scene) as Mesh
      bumperMedium.scaling = new Vector3(1, 0.7, 1)

      const bumperLow = MeshBuilder.CreateSphere('bump_low', { diameter: 0.9 * scale, segments: 8 }, this.scene) as Mesh
      bumperLow.scaling = new Vector3(1, 0.7, 1)

      bumperHigh.addLODLevel(15, bumperMedium)
      bumperHigh.addLODLevel(30, bumperLow)
      bumperHigh.addLODLevel(50, null)

      const bumper = bumperHigh

      // Use enhanced bumper materials with map-reactive glow
      const bodyMat = this.matLib.getEnhancedBumperBodyMaterial(colorHex)
      bumper.material = bodyMat

      // ================================================================
      // BUMPER CAP - Subtle beveled top
      // ================================================================
      const bumperCap = MeshBuilder.CreateSphere('bump_cap', { diameter: 0.55 * scale, segments: 16 }, this.scene) as Mesh
      bumperCap.position.set(x, 0.5 + 0.22 * scale, z)
      bumperCap.scaling = new Vector3(1, 0.35, 1)
      bumperCap.material = bodyMat

      // ================================================================
      // DEEP EMISSIVE RING - Torus around equator
      // ================================================================
      const bumperRing = MeshBuilder.CreateTorus('bump_ring', {
        diameter: 0.78 * scale,
        thickness: 0.055 * scale,
        tessellation: 48
      }, this.scene) as Mesh
      bumperRing.position.set(x, 0.38 * scale, z)
      bumperRing.rotation.x = Math.PI / 2

      // Use enhanced ring material with deeper emissive
      const ringMat = this.matLib.getEnhancedBumperRingMaterial(colorHex)
      bumperRing.material = ringMat

      // --- REFINED HOLOGRAM PILLAR (tapered for organic look) ---
      const holoInner = MeshBuilder.CreateCylinder('holoInner', { diameterTop: 0.35, diameterBottom: 0.65, height: 2.5, tessellation: 24 }, this.scene)
      holoInner.position.set(x, 1.8, z)

      const innerMat = this.matLib.getHologramMaterial(colorHex, true)
      holoInner.material = innerMat

      const holoOuter = MeshBuilder.CreateCylinder('holoOuter', { diameterTop: 0.9, diameterBottom: 1.4, height: 4.0, tessellation: 24 }, this.scene)
      holoOuter.position.set(x, 2.0, z)

      const outerMat = this.matLib.getHologramMaterial('#FFFFFF', true)
      outerMat.alpha = 0.25
      holoOuter.material = outerMat
      holoOuter.parent = holoInner

      // Thin wireframe hologram ring floating above bumper
      const wireframeRing = MeshBuilder.CreateTorus('bump_wireframe', {
        diameter: 0.6 * scale,
        thickness: 0.008 * scale,
        tessellation: 32
      }, this.scene) as Mesh
      wireframeRing.position.set(x, 0.9 * scale, z)
      wireframeRing.rotation.x = Math.PI / 2

      const wfMat = new StandardMaterial('bumpWireframeMat', this.scene)
      wfMat.emissiveColor = Color3.FromHexString(colorHex)
      wfMat.disableLighting = true
      wfMat.wireframe = true
      wireframeRing.material = wfMat

      const body = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed().setTranslation(x, 0.5, z)
      )

      this.world.createCollider(
        this.rapier.ColliderDesc.ball(0.4 * scale)
          .setRestitution(0.85)
          .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
        body
      )

      this.world.createCollider(
        this.rapier.ColliderDesc.cylinder(1.5, 0.5)
          .setSensor(true)
          .setTranslation(0, 2.0, 0)
          .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
        body
      )

      bindings.push({ mesh: bumper, rigidBody: body })
      bumperBodies.push(body)
      const initialEmissive = emissive(colorHex, INTENSITY.ACTIVE)

      bumperVisuals.push({
        mesh: bumper,
        body: body,
        hologram: holoInner,
        hitTime: 0,
        sweep: Math.random(),
        targetEmissive: initialEmissive.clone(),
        currentEmissive: initialEmissive.clone(),
        flashTimer: 0,
        color: colorHex,
        wireframeRing: wireframeRing,
      })
      meshes.push(bumper, bumperCap, bumperRing, holoInner, holoOuter, wireframeRing)
    }

    // Main center bumper (larger)
    make(0, 8, '#ff00aa', 1.2)
    // Upper side bumpers
    make(-4, 4, '#00aaff', 1.0)
    make(4, 4, '#00aaff', 1.0)
    // Lower bumpers - funnel toward flippers
    make(-3, 0, '#ffaa00', 0.9)
    make(3, 0, '#ffaa00', 0.9)
    // Far upper bumper
    make(0, 14, '#00ff88', 0.85)
    // Side deflector bumper
    make(-6, 10, '#ff4400', 1.0)

    return {
      bumpers,
      bindings,
      bumperBodies,
      bumperVisuals,
      meshes
    }
  }

  updateBumpers(dt: number, bumperVisuals: BumperVisual[]): void {
    const time = performance.now() * 0.001

    bumperVisuals.forEach((vis) => {
      const mat = vis.mesh.material as PBRMaterial

      // ---- Smooth emissive interpolation (lerp toward target) ----
      if (vis.currentEmissive && vis.targetEmissive) {
        Color3.LerpToRef(vis.currentEmissive, vis.targetEmissive, dt * 5, vis.currentEmissive)

        // State entry flash - brief white flash on state transition
        if (vis.flashTimer && vis.flashTimer > 0) {
          vis.flashTimer -= dt
          const flashIntensity = vis.flashTimer / 0.1
          const flashColor = vis.currentEmissive.add(color(PALETTE.WHITE).scale(flashIntensity * INTENSITY.BURST))
          mat.emissiveColor = flashColor
        } else {
          mat.emissiveColor = vis.currentEmissive
        }
      }

      // Rotate the inner hologram
      if (vis.hologram) {
        vis.hologram.rotation.y += dt * 1.5
        vis.hologram.position.y = 1.8 + Math.sin(time * 2 + vis.sweep * 10) * 0.1

        // Rotate child (Outer) in opposite direction if it exists
        const child = vis.hologram.getChildren()[0] as Mesh
        if (child) {
          child.rotation.y -= dt * 3.0
        }

        // Hologram state sync - sync hologram emissive with bumper target
        if (vis.targetEmissive && vis.hologram.material) {
          const holoMat = vis.hologram.material as PBRMaterial
          Color3.LerpToRef(
            holoMat.emissiveColor,
            vis.targetEmissive.scale(1.2),
            dt * 8,
            holoMat.emissiveColor
          )
        }
      }

      // Rotate wireframe ring slowly
      if (vis.wireframeRing) {
        vis.wireframeRing.rotation.z += dt * 0.8
      }

      if (vis.hitTime > 0) {
        vis.hitTime -= dt
        // Elastic bounce instead of linear
        const bouncePhase = Math.sin((1 - vis.hitTime / 0.2) * Math.PI)
        const s = 1 + bouncePhase * 0.4 // Peak at 1.4x scale
        vis.mesh.scaling.set(s, s, s)

        // Add slight squash in Y during peak stretch
        if (vis.hitTime > 0.1) {
          vis.mesh.scaling.y = 1 - bouncePhase * 0.2
        }

        // Hit energy pulse - brief white flash on impact
        if (vis.currentEmissive) {
          const flashIntensity = INTENSITY.BURST * (vis.hitTime / 0.2)
          mat.emissiveColor = vis.currentEmissive.add(color(PALETTE.WHITE).scale(flashIntensity))
        }

        if (vis.hologram) {
          // Hologram counter-pulse
          const holoS = 1 + (0.2 - vis.hitTime) * 2 // Inverse timing
          vis.hologram.scaling.set(1, 1 + holoS * 0.3, 1)
          vis.hologram.material!.alpha = 0.8 + bouncePhase * 0.2
        }
      } else {
        vis.mesh.scaling.set(1, 1, 1)
        if (vis.hologram) {
          vis.hologram.scaling.set(1, 1, 1)
          vis.hologram.material!.alpha = 0.5
        }
      }
    })
  }

  setBumperState(state: 'IDLE' | 'REACH' | 'FEVER' | 'JACKPOT' | 'ADVENTURE', bumperVisuals: BumperVisual[]): void {
    const targetColor = stateEmissive(state, INTENSITY.ACTIVE)
    const profile = STATE_PROFILES[state]

    bumperVisuals.forEach(vis => {
      vis.targetEmissive = targetColor.clone()
      vis.flashTimer = 0.1 // Trigger state entry flash

      // Apply state-specific surface properties
      const mat = vis.mesh.material as PBRMaterial
      if (profile) {
        mat.roughness = profile.roughness
        mat.metallic = profile.metallic
      }

      // Update wireframe ring color to match state
      if (vis.wireframeRing?.material) {
        (vis.wireframeRing.material as StandardMaterial).emissiveColor = targetColor
      }
    })
  }

  /**
   * Update bumper wireframe ring colors to match the current map theme.
   */
  updateBumperColors(mapColorHex: string, bumperVisuals: BumperVisual[]): void {
    const col = Color3.FromHexString(mapColorHex)
    bumperVisuals.forEach(vis => {
      if (vis.wireframeRing?.material) {
        (vis.wireframeRing.material as StandardMaterial).emissiveColor = col
      }
      vis.color = mapColorHex
    })
  }

  dispose(): void {
    // Nothing to dispose — particles are now managed by EffectsSystem pool
  }
}
