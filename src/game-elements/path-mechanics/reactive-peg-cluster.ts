import { PointLight } from '@babylonjs/core/Lights/pointLight'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Scalar } from '@babylonjs/core/Maths/math.scalar'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { PhysicsBody } from '../../core/physics-api'
import { distance3 } from '../../core/vec3-scalar'
import { getLayoutRng } from '../../core/seeded-rng'
import { getMaterialLibrary } from '../../materials'
import { color } from '../visual-language'
import type { ReactivePegClusterConfig } from './types'
import { PathMechanic } from './base'

/** Read-only source colour for the per-frame light writes; never assigned to a light. */
const GRAY = Color3.Gray()

export enum PegState {
  INACTIVE,
  ACTIVATING,
  ACTIVE,
  DEACTIVATING,
}

export class ReactivePegCluster extends PathMechanic {
  private pegs: Mesh[] = []
  private pegLights: PointLight[] = []
  private pegStates: PegState[] = []
  private pegHits: number[] = []
  private position = Vector3.Zero()
  private clusterRadius = 3
  private pegCount = 8
  // Score awarded when cluster fully activates
  private activationScoreValue = 1000
  private clusterActive = false
  private activationLevel = 0
  private pulseTime = 0
  /** `color(mapBaseColor)`, re-parsed only when the map colour changes (it was parsed per peg per frame). */
  private readonly baseColor = new Color3()
  private baseColorHex: string | null = null

  spawn(config: ReactivePegClusterConfig): void {
    if (this.isSpawned) return

    this.position = config.position.clone()
    this.clusterRadius = config.clusterRadius
    this.pegCount = config.pegCount
    this.activationScoreValue = config.activationScore

    this.setMapColors(config.mapBaseColor, config.mapAccentColor)
    this.createVisuals()

    this.isSpawned = true
    console.log(`[ReactivePegCluster] Spawned ${this.pegCount} pegs at ${this.position.toString()}`)
  }

  despawn(): void {
    if (!this.isSpawned) return

    this.pegs.forEach(p => p.dispose())
    this.pegLights.forEach(l => l.dispose())

    this.pegs = []
    this.pegLights = []
    this.pegStates = []
    this.pegHits = []
    this.isSpawned = false
  }

  private createVisuals(): void {
    const matLib = getMaterialLibrary(this.scene)

    // Pegs are colliders: the radius variance is seeded, keyed on where the
    // cluster sits so each cluster keeps its own layout whatever the build order.
    const p = this.position
    const layout = getLayoutRng(`peg-cluster:${p.x},${p.y},${p.z}`)
    for (let i = 0; i < this.pegCount; i++) {
      const angle = (i / this.pegCount) * Math.PI * 2
      const radius = this.clusterRadius * (0.5 + layout.next() * 0.5)
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius

      const pegPos = this.position.add(new Vector3(x, 0, z))

      // Peg mesh
      const peg = MeshBuilder.CreateCylinder(`reactivePeg${i}`, {
        diameter: 0.4,
        height: 1.5,
        tessellation: 8
      }, this.scene)
      peg.position = pegPos
      peg.material = matLib.getPinMaterial() // Start inactive
      peg.parent = this.rootNode
      this.pegs.push(peg)

      // Peg light
      const light = new PointLight(`pegLight${i}`, pegPos.add(new Vector3(0, 1, 0)), this.scene)
      light.intensity = 0.2
      light.range = 3
      light.diffuse = Color3.Gray()
      this.pegLights.push(light)

      this.pegStates.push(PegState.INACTIVE)
      this.pegHits.push(0)
    }
  }

  update(dt: number, ballBodies: PhysicsBody[]): void {
    if (!this.isSpawned) return

    this.pulseTime += dt * 4

    // Check for ball-peg collisions. Ball-major so each ball's translation() is read once per
    // frame rather than once per peg; hitPeg(i) only touches peg i, and each peg still sees
    // the balls in the same order, so the outcome is unchanged.
    for (const ball of ballBodies) {
      const pos = ball.translation()
      for (let i = 0; i < this.pegs.length; i++) {
        const pegPos = this.pegs[i].position
        const distance = distance3(pos, pegPos)

        // Collision detection
        if (distance < 0.6 && Math.abs(pos.y - pegPos.y) < 1) {
          this.hitPeg(i)
        }
      }
    }

    // Update peg visuals based on state
    this.updatePegVisuals(dt)

    // Check for full cluster activation
    let activeCount = 0
    for (const s of this.pegStates) if (s === PegState.ACTIVE) activeCount++
    this.activationLevel = activeCount / this.pegCount

    if (this.activationLevel >= 1 && !this.clusterActive) {
      this.activateCluster()
    }
  }

  private hitPeg(index: number): void {
    if (this.pegStates[index] === PegState.INACTIVE) {
      this.pegStates[index] = PegState.ACTIVATING
      this.pegHits[index] = 1
    } else if (this.pegStates[index] === PegState.ACTIVE) {
      this.pegHits[index]++
    }
  }

  private currentBaseColor(): Color3 {
    if (this.baseColorHex !== this.mapBaseColor) {
      this.baseColor.copyFrom(color(this.mapBaseColor))
      this.baseColorHex = this.mapBaseColor
    }
    return this.baseColor
  }

  /** Per frame: light colours are written into each light's own Color3, not reassigned. */
  private updatePegVisuals(dt: number): void {
    const matLib = getMaterialLibrary(this.scene)
    // Looked up once per frame (each lookup builds a factory closure), only if a peg needs it.
    let pinMaterial: ReturnType<typeof matLib.getPinMaterial> | null = null

    for (let i = 0; i < this.pegs.length; i++) {
      const state = this.pegStates[i]
      const peg = this.pegs[i]
      const light = this.pegLights[i]

      switch (state) {
        case PegState.INACTIVE:
          // Dim, gray
          light.intensity = 0.2 + Math.sin(this.pulseTime + i) * 0.1
          light.diffuse.copyFrom(GRAY)
          pinMaterial ??= matLib.getPinMaterial()
          peg.material = pinMaterial
          break

        case PegState.ACTIVATING:
          // Transition to active
          light.intensity = Scalar.Lerp(light.intensity, 2, dt * 5)
          Color3.LerpToRef(GRAY, this.currentBaseColor(), dt * 3, light.diffuse)

          if (light.intensity > 1.8) {
            this.pegStates[i] = PegState.ACTIVE
            peg.material = this.neonMaterial
          }
          break

        case PegState.ACTIVE: {
          // Glowing, pulsing
          const pulse = 2 + Math.sin(this.pulseTime * 2 + i) * 0.5
          light.intensity = pulse
          light.diffuse.copyFrom(this.currentBaseColor())

          // Scale bump on hit
          const targetScale = 1 + this.pegHits[i] * 0.1
          peg.scaling.y = Scalar.Lerp(peg.scaling.y, targetScale, dt * 10)
          break
        }
      }
    }
  }

  private activateCluster(): void {
    this.clusterActive = true
    console.log(`[ReactivePegCluster] FULL ACTIVATION! +${this.activationScoreValue} bonus points`)

    // All pegs flash bright
    for (let i = 0; i < this.pegs.length; i++) {
      const light = this.pegLights[i]
      light.intensity = 4
      light.diffuse = Color3.White()

      // Reset after flash
      setTimeout(() => {
        if (this.pegLights[i]) {
          light.diffuse = color(this.mapAccentColor)
        }
      }, 300)
    }

    // Reset cluster after delay
    setTimeout(() => {
      this.resetCluster()
    }, 3000)
  }

  private resetCluster(): void {
    this.clusterActive = false
    for (let i = 0; i < this.pegStates.length; i++) {
      this.pegStates[i] = PegState.INACTIVE
      this.pegHits[i] = 0
    }
    console.log('[ReactivePegCluster] Reset')
  }

  getActivationLevel(): number {
    return this.activationLevel
  }

  isFullyActive(): boolean {
    return this.clusterActive
  }

  protected updateVisualColors(): void {
    // Pegs will update on next hit/activation
    for (let i = 0; i < this.pegs.length; i++) {
      if (this.pegStates[i] === PegState.ACTIVE) {
        this.pegs[i].material = this.neonMaterial
      }
    }
  }
}
