import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Quaternion, type Vector3 } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { Scene } from '@babylonjs/core/scene'
import type { ShardParticle } from '../game-elements/types'
import { color, INTENSITY, PALETTE } from '../game-elements/visual-language'
import { TransientField } from './transient-field'

/** Shards alive at once (8 per burst). A burst that would not fit is skipped. */
const SHARD_CAPACITY = 256
const SHARDS_PER_BURST = 8

const SHARD_GRAVITY = 9.8
const SHARD_DRAG = 0.98
const SHARD_LIFE = 1.0
const SHARD_ALPHA = 0.8

/** The old `Animation` ran the ring's scale and fade over 20 frames at 60 fps. */
const RING_DURATION = 20 / 60
const RING_ALPHA = 0.8
const RING_END_SCALE_XY = 5

interface ImpactRing {
  x: number
  y: number
  z: number
  qx: number
  qy: number
  qz: number
  qw: number
  r: number
  g: number
  b: number
  age: number
}

function newShard(): ShardParticle {
  return {
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    rx: 0, ry: 0, rz: 0,
    rvx: 0, rvy: 0, rvz: 0,
    life: 0, maxLife: SHARD_LIFE, initialScale: 1,
    r: 0, g: 0, b: 0,
  }
}

/**
 * Shard bursts and impact rings. Both are thin-instance fields on the shared transient material
 * (`TransientField`): spawning a burst writes numbers into a pre-sized pool and creates no mesh
 * and no material.
 */
export class ShardEffects {
  private readonly shardField: TransientField
  private readonly ringField: TransientField
  /** Dense: [0, shardCount) are alive. */
  private readonly shards: ShardParticle[] = []
  private shardCount = 0
  private readonly rings: ImpactRing[] = []
  private activeImpactRings = 0
  private readonly maxImpactRings: number
  private readonly scratchQuat = new Quaternion()

  constructor(scene: Scene, maxImpactRings = 5) {
    this.maxImpactRings = maxImpactRings
    for (let i = 0; i < SHARD_CAPACITY; i++) this.shards.push(newShard())
    this.shardField = new TransientField(
      scene,
      () => MeshBuilder.CreateBox('shardField', { size: 0.15 }, scene),
      SHARD_CAPACITY,
    )
    this.ringField = new TransientField(
      scene,
      () => MeshBuilder.CreateTorus('impactRingField', { diameter: 0.5, thickness: 0.05, tessellation: 32 }, scene),
      Math.max(1, maxImpactRings),
    )
  }

  spawnShardBurst(pos: Vector3, colorHex?: string): void {
    if (this.shardCount + SHARDS_PER_BURST > SHARD_CAPACITY) return
    // Same colour as the emissive material this replaced: the hex scaled by the flash intensity;
    // the field clamps it to the LDR range the material's clamp gave.
    const tint = color(colorHex || PALETTE.CYAN).scale(INTENSITY.FLASH)
    for (let i = 0; i < SHARDS_PER_BURST; i++) {
      const s = this.shards[this.shardCount++]!
      s.x = pos.x
      s.y = pos.y
      s.z = pos.z
      s.vx = (Math.random() - 0.5) * 5
      s.vy = (Math.random() + 1) * 5
      s.vz = (Math.random() - 0.5) * 5
      s.rx = 0
      s.ry = 0
      s.rz = 0
      s.rvx = (Math.random() - 0.5) * 10
      s.rvy = (Math.random() - 0.5) * 10
      s.rvz = (Math.random() - 0.5) * 10
      s.life = SHARD_LIFE
      s.maxLife = SHARD_LIFE
      s.initialScale = 0.8 + Math.random() * 0.4
      s.r = tint.r
      s.g = tint.g
      s.b = tint.b
    }
  }

  updateShards(dt: number): void {
    const hadAny = this.shardCount > 0 || this.rings.length > 0
    this.stepShards(dt)
    this.stepRings(dt)
    // Nothing alive before or after: neither field has anything to draw or to hide.
    if (hadAny) {
      this.flushShards()
      this.flushRings()
    }
  }

  private stepShards(dt: number): void {
    for (let i = this.shardCount - 1; i >= 0; i--) {
      const s = this.shards[i]!
      s.life -= dt
      if (s.life <= 0) {
        // Swap-remove: the dead one goes to the tail (kept in the pool), the last live takes its slot.
        const last = --this.shardCount
        this.shards[i] = this.shards[last]!
        this.shards[last] = s
        continue
      }
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.z += s.vz * dt
      s.vy -= SHARD_GRAVITY * dt
      s.vx *= SHARD_DRAG
      s.vy *= SHARD_DRAG
      s.vz *= SHARD_DRAG
      s.rx += s.rvx * dt
      s.ry += s.rvy * dt
      s.rz += s.rvz * dt
    }
  }

  private flushShards(): void {
    const field = this.shardField
    const q = this.scratchQuat
    field.begin()
    for (let i = 0; i < this.shardCount; i++) {
      const s = this.shards[i]!
      const lifeNorm = s.life / s.maxLife
      const scale = s.initialScale * (0.3 + lifeNorm * 0.7)
      // Babylon's `rotation` (x pitch, y yaw, z roll) -> quaternion.
      Quaternion.RotationYawPitchRollToRef(s.ry, s.rx, s.rz, q)
      field.push(s.x, s.y, s.z, q.x, q.y, q.z, q.w, scale, scale, scale, s.r, s.g, s.b, lifeNorm * SHARD_ALPHA)
    }
    field.end()
  }

  spawnImpactRing(position: Vector3, normal: Vector3, colorHex: string): void {
    if (this.activeImpactRings >= this.maxImpactRings) return
    this.activeImpactRings++

    // `ring.lookAt(position + normal)`: AbstractMesh.setDirection with the normal as the direction.
    const yaw = -Math.atan2(normal.z, normal.x) + Math.PI / 2
    const pitch = -Math.atan2(normal.y, Math.sqrt(normal.x * normal.x + normal.z * normal.z))
    const q = this.scratchQuat
    Quaternion.RotationYawPitchRollToRef(yaw, pitch, 0, q)

    const tint = Color3.FromHexString(colorHex)
    this.rings.push({
      x: position.x, y: position.y, z: position.z,
      qx: q.x, qy: q.y, qz: q.z, qw: q.w,
      r: tint.r, g: tint.g, b: tint.b,
      age: 0,
    })
  }

  private stepRings(dt: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i]!
      ring.age += dt
      if (ring.age >= RING_DURATION) {
        this.rings.splice(i, 1)
        this.activeImpactRings--
      }
    }
  }

  private flushRings(): void {
    const field = this.ringField
    field.begin()
    for (const ring of this.rings) {
      const t = ring.age / RING_DURATION
      // (1, 1, 1) -> (5, 5, 1) and alpha 0.8 -> 0: the keys of the Animation this replaced.
      const xy = 1 + (RING_END_SCALE_XY - 1) * t
      field.push(ring.x, ring.y, ring.z, ring.qx, ring.qy, ring.qz, ring.qw, xy, xy, 1, ring.r, ring.g, ring.b, RING_ALPHA * (1 - t))
    }
    field.end()
  }

  getActiveImpactCount(): number {
    return this.activeImpactRings
  }

  dispose(): void {
    this.shardCount = 0
    this.rings.length = 0
    this.activeImpactRings = 0
    this.shardField.dispose()
    this.ringField.dispose()
  }
}
