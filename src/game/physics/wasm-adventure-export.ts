/**
 * Export a Rapier adventure-track body into the WASM world.
 *
 * The table path (`wasm-static-export.ts`) only ever sees balls, cuboids and
 * capsules, and silently drops anything else. Adventure tracks add cylinders
 * (pins, pylons, mills), sensors (goals, portals, chroma gates), kinematic
 * rotators and dynamic crates, so they get their own exporter rather than
 * widening the table one with adventure-only concerns.
 *
 * Like the table exporter, Rapier's `ShapeType` values are re-declared here
 * instead of imported so Vitest stays node-safe.
 *
 * Anything this cannot represent is *reported*, never dropped quietly — see
 * `AdventureExportResult.unsupported`. A track with unsupported geometry must
 * keep a stepping Rapier world, and the caller needs to know that.
 */

import type * as RAPIER from '@dimforge/rapier3d-compat'

import type { WasmDebugCollider } from '../../game-elements/wasm-debug-geometry'
import { WasmVolumeShape } from '../../wasm/PhysicsModule'
import type { WasmSimEngine } from '../../wasm/wasm-sim-engine'

/** Mirrors Rapier's `ShapeType` without importing Rapier values. */
const RapierShapeType = {
  Ball: 0,
  Cuboid: 1,
  Capsule: 2,
  TriMesh: 6,
  HeightField: 7,
  ConvexPolyhedron: 9,
  Cylinder: 10,
  Cone: 11,
} as const

const IDENTITY_Q = { x: 0, y: 0, z: 0, w: 1 } as const

export interface AdventureExportOptions {
  /** Collision-group membership applied to every exported collider. */
  membership?: number
  /** Collision-group filter applied to every exported collider. */
  filter?: number
  defaultRestitution?: number
  defaultFriction?: number
  /**
   * Route fixed cuboids through the triangle-mesh path instead of the
   * analytic `addStaticBox`.
   *
   * Off by default, and deliberately so: an oriented box is exactly
   * representable analytically, and a tessellated box is strictly worse for
   * it on two counts. It registers twelve broadphase entries instead of one,
   * and because mesh triangles are one-sided a ball that ever does get inside
   * a thin wall is trapped there, where the analytic path's deep-contact
   * fallback pushes it back out through the shallowest face. Turn it on to
   * exercise the mesh path against real track geometry.
   */
  tessellateCuboids?: boolean
}

/**
 * A kinematic rotator or piston, plus the pose we advance for it.
 *
 * Once Rapier stops stepping, its kinematic bodies stop moving: a
 * velocity-based platter never integrates its `angvel`, and a
 * `setNextKinematicTranslation` target is never committed to the body's
 * actual transform. So the pose is tracked here instead, seeded from the
 * body's initial transform and advanced each frame.
 */
export interface AdventureMover {
  moverId: number
  body: RAPIER.RigidBody
  colliderIndex: number
  /** Collider offset within the body, captured at export time. */
  localOffset: { x: number; y: number; z: number }
  localRotation: { x: number; y: number; z: number; w: number }
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number; w: number }
  /** True when the body is velocity-based and we must integrate it ourselves. */
  velocityDriven: boolean
}

/** One collider the WASM world cannot represent, and why. */
export interface UnsupportedCollider {
  shapeType: number
  reason: string
}

export interface AdventureExportResult {
  /** Negative collider handles (and body handles for dynamic crates). */
  handles: number[]
  /** Kinematic movers, paired with the Rapier body driving each one. */
  movers: AdventureMover[]
  /** Sensor volumes, paired with the Rapier body they were exported from. */
  sensors: Array<{ handle: number; body: RAPIER.RigidBody }>
  debug: WasmDebugCollider[]
  unsupported: UnsupportedCollider[]
}

function emptyResult(): AdventureExportResult {
  return { handles: [], movers: [], sensors: [], debug: [], unsupported: [] }
}

/**
 * Triangulate an oriented box into 12 world-space triangles, wound CCW as
 * seen from outside so every face's front side points away from the centre.
 */
export function tessellateBox(
  center: { x: number; y: number; z: number },
  halfExtents: { x: number; y: number; z: number },
  rotation: { x: number; y: number; z: number; w: number }
): { vertices: Float32Array; indices: Uint32Array } {
  const signs: Array<[number, number, number]> = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ]

  const vertices = new Float32Array(signs.length * 3)
  signs.forEach(([sx, sy, sz], i) => {
    const lx = sx * halfExtents.x
    const ly = sy * halfExtents.y
    const lz = sz * halfExtents.z
    // Quaternion rotation of (lx, ly, lz), then translate.
    const { x: qx, y: qy, z: qz, w: qw } = rotation
    const ux = qy * lz - qz * ly
    const uy = qz * lx - qx * lz
    const uz = qx * ly - qy * lx
    const vx = qy * uz - qz * uy
    const vy = qz * ux - qx * uz
    const vz = qx * uy - qy * ux
    vertices[i * 3] = center.x + lx + 2 * (qw * ux + vx)
    vertices[i * 3 + 1] = center.y + ly + 2 * (qw * uy + vy)
    vertices[i * 3 + 2] = center.z + lz + 2 * (qw * uz + vz)
  })

  // Faces wound CCW viewed from outside the box.
  const indices = new Uint32Array([
    4, 5, 6, 4, 6, 7, // +z
    1, 0, 3, 1, 3, 2, // -z
    5, 1, 2, 5, 2, 6, // +x
    0, 4, 7, 0, 7, 3, // -x
    3, 7, 6, 3, 6, 2, // +y
    0, 1, 5, 0, 5, 4, // -y
  ])

  return { vertices, indices }
}

/**
 * Export every collider on one adventure-track Rapier body into `engine`.
 *
 * Fixed bodies become static geometry, `kinematicVelocityBased` bodies become
 * kinematic movers (driven afterwards via `driveAdventureMovers`), and dynamic
 * bodies become box crates. Sensor colliders always export as sensor volumes —
 * unlike the table path, adventure sensors are load-bearing gameplay.
 */
export function exportAdventureBodyToWasm(
  body: RAPIER.RigidBody,
  engine: WasmSimEngine,
  options: AdventureExportOptions = {}
): AdventureExportResult {
  const result = emptyResult()

  const defaultRestitution = options.defaultRestitution ?? 0.4
  const defaultFriction = options.defaultFriction ?? 0.2
  const isFixed = body.isFixed()
  const isKinematic = body.isKinematic()
  const isDynamic = !isFixed && !isKinematic

  const applyGroups = (handle: number) => {
    if (handle === -1) return
    result.handles.push(handle)
    if (options.membership !== undefined && options.filter !== undefined) {
      engine.setCollisionGroups?.(handle, options.membership, options.filter)
    }
  }

  const bodyPos = body.translation()
  const bodyRot = body.rotation()

  for (let i = 0; i < body.numColliders(); i++) {
    const collider = body.collider(i)
    const shapeType = collider.shapeType()

    const pos = collider.translation()
    const rot = collider.rotation()
    const center = { x: pos.x, y: pos.y, z: pos.z }
    const rotation = { x: rot.x, y: rot.y, z: rot.z, w: rot.w }
    const restitution = collider.restitution() ?? defaultRestitution
    const friction = typeof collider.friction === 'function' ? collider.friction() : defaultFriction

    // ---- Sensors ---------------------------------------------------------
    if (collider.isSensor()) {
      let volumeShape: WasmVolumeShape = WasmVolumeShape.Box
      let halfExtents = { x: 0.5, y: 0.5, z: 0.5 }
      let debugShape: 'box' | 'cylinder' | 'sphere' = 'box'

      if (shapeType === RapierShapeType.Cuboid) {
        const half = collider.halfExtents()
        halfExtents = { x: half.x, y: half.y, z: half.z }
      } else if (shapeType === RapierShapeType.Cylinder) {
        const radius = collider.radius()
        halfExtents = { x: radius, y: collider.halfHeight(), z: radius }
        volumeShape = WasmVolumeShape.Cylinder
        debugShape = 'cylinder'
      } else if (shapeType === RapierShapeType.Ball) {
        const radius = collider.radius()
        halfExtents = { x: radius, y: radius, z: radius }
        volumeShape = WasmVolumeShape.Sphere
        debugShape = 'sphere'
      } else {
        result.unsupported.push({ shapeType, reason: 'sensor shape has no volume equivalent' })
        continue
      }

      if (!engine.addSensorVolume) {
        result.unsupported.push({ shapeType, reason: 'engine exposes no sensor volumes' })
        continue
      }
      const sensorHandle = engine.addSensorVolume(center, halfExtents, rotation, volumeShape)
      applyGroups(sensorHandle)
      if (sensorHandle !== -1) result.sensors.push({ handle: sensorHandle, body })
      result.debug.push({ kind: 'sensor', center, halfExtents, rotation, volumeShape: debugShape })
      continue
    }

    // ---- Kinematic rotators ---------------------------------------------
    if (isKinematic) {
      let halfExtents: { x: number; y: number; z: number }
      let volumeShape: WasmVolumeShape
      if (shapeType === RapierShapeType.Cylinder) {
        const radius = collider.radius()
        halfExtents = { x: radius, y: collider.halfHeight(), z: radius }
        volumeShape = WasmVolumeShape.Cylinder
      } else if (shapeType === RapierShapeType.Cuboid) {
        const half = collider.halfExtents()
        halfExtents = { x: half.x, y: half.y, z: half.z }
        volumeShape = WasmVolumeShape.Box
      } else {
        result.unsupported.push({ shapeType, reason: 'kinematic movers are box or cylinder only' })
        continue
      }

      if (!engine.addKinematicMover) {
        result.unsupported.push({ shapeType, reason: 'engine exposes no kinematic movers' })
        continue
      }
      const moverId = engine.addKinematicMover(
        center, halfExtents, rotation, restitution, friction, volumeShape
      )
      applyGroups(moverId)
      if (moverId !== -1) {
        const angvel = body.angvel()
        const linvel = body.linvel()
        const velocityDriven =
          angvel.x !== 0 || angvel.y !== 0 || angvel.z !== 0 ||
          linvel.x !== 0 || linvel.y !== 0 || linvel.z !== 0
        // Collider pose is already in world space; recover its offset from the
        // body so a body-level pose update can be reapplied to the collider.
        const invBody = conjugate({ x: bodyRot.x, y: bodyRot.y, z: bodyRot.z, w: bodyRot.w })
        result.movers.push({
          moverId,
          body,
          colliderIndex: i,
          localOffset: rotatePoint(
            invBody, center.x - bodyPos.x, center.y - bodyPos.y, center.z - bodyPos.z
          ),
          localRotation: quatMultiply(invBody, rotation),
          position: { ...center },
          rotation: { ...rotation },
          velocityDriven,
        })
      }
      result.debug.push(
        volumeShape === WasmVolumeShape.Cylinder
          ? { kind: 'cylinder', center, radius: halfExtents.x, halfHeight: halfExtents.y, rotation }
          : { kind: 'box', center, halfExtents, rotation }
      )
      continue
    }

    // ---- Dynamic crates --------------------------------------------------
    if (isDynamic) {
      if (shapeType !== RapierShapeType.Cuboid) {
        result.unsupported.push({ shapeType, reason: 'dynamic adventure bodies must be cuboids' })
        continue
      }
      if (!engine.createBoxBody) {
        result.unsupported.push({ shapeType, reason: 'engine exposes no dynamic box bodies' })
        continue
      }
      const half = collider.halfExtents()
      const vel = body.linvel()
      const handle = engine.createBoxBody({
        position: { x: bodyPos.x, y: bodyPos.y, z: bodyPos.z },
        velocity: { x: vel.x, y: vel.y, z: vel.z },
        halfExtents: { x: half.x, y: half.y, z: half.z },
        mass: body.mass() || 1,
        restitution,
        friction,
      })
      applyGroups(handle)
      result.debug.push({
        kind: 'box',
        center: { x: bodyPos.x, y: bodyPos.y, z: bodyPos.z },
        halfExtents: { x: half.x, y: half.y, z: half.z },
        rotation: { x: bodyRot.x, y: bodyRot.y, z: bodyRot.z, w: bodyRot.w },
      })
      continue
    }

    // ---- Fixed geometry --------------------------------------------------
    switch (shapeType) {
      case RapierShapeType.Cuboid: {
        const half = collider.halfExtents()
        const halfExtents = { x: half.x, y: half.y, z: half.z }
        if (options.tessellateCuboids && engine.addStaticTriangleMesh) {
          const { vertices, indices } = tessellateBox(center, halfExtents, rotation)
          applyGroups(engine.addStaticTriangleMesh(vertices, indices, restitution, friction, false))
          result.debug.push({ kind: 'mesh', center, triangleCount: indices.length / 3 })
        } else {
          applyGroups(engine.addStaticBox(center, halfExtents, rotation, restitution, friction))
          result.debug.push({ kind: 'box', center, halfExtents, rotation })
        }
        break
      }

      case RapierShapeType.Cylinder: {
        if (!engine.addStaticCylinder) {
          result.unsupported.push({ shapeType, reason: 'engine exposes no static cylinders' })
          break
        }
        const radius = collider.radius()
        const halfHeight = collider.halfHeight()
        applyGroups(engine.addStaticCylinder(center, radius, halfHeight, rotation, restitution, friction))
        result.debug.push({ kind: 'cylinder', center, radius, halfHeight, rotation })
        break
      }

      case RapierShapeType.Capsule: {
        const radius = collider.radius()
        const halfHeight = collider.halfHeight()
        applyGroups(engine.addStaticCapsule(center, radius, halfHeight, rotation, restitution, friction))
        result.debug.push({ kind: 'capsule', center, radius, halfHeight, rotation })
        break
      }

      case RapierShapeType.Ball: {
        const radius = collider.radius()
        applyGroups(engine.createBody({
          position: center,
          velocity: { x: 0, y: 0, z: 0 },
          mass: 0,
          radius,
          restitution,
          friction,
          linearDamping: 0,
          bodyType: 1,
        }))
        result.debug.push({ kind: 'sphere', center, radius })
        break
      }

      case RapierShapeType.TriMesh:
      case RapierShapeType.ConvexPolyhedron: {
        const verts = collider.vertices()
        const idx = collider.indices()
        if (!engine.addStaticTriangleMesh || !verts || !idx) {
          result.unsupported.push({ shapeType, reason: 'engine exposes no triangle meshes' })
          break
        }
        // Rapier reports collider-local vertices; the C++ soup is world space.
        const world = new Float32Array(verts.length)
        for (let v = 0; v + 2 < verts.length; v += 3) {
          const p = rotatePoint(rotation, verts[v], verts[v + 1], verts[v + 2])
          world[v] = center.x + p.x
          world[v + 1] = center.y + p.y
          world[v + 2] = center.z + p.z
        }
        applyGroups(engine.addStaticTriangleMesh(
          world, Uint32Array.from(idx), restitution, friction, false
        ))
        result.debug.push({ kind: 'mesh', center, triangleCount: idx.length / 3 })
        break
      }

      default:
        result.unsupported.push({ shapeType, reason: 'no WASM equivalent' })
        break
    }
  }

  return result
}

function conjugate(q: { x: number; y: number; z: number; w: number }) {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w }
}

function quatMultiply(
  a: { x: number; y: number; z: number; w: number },
  b: { x: number; y: number; z: number; w: number }
) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  }
}

function normalizeQuat(q: { x: number; y: number; z: number; w: number }) {
  const len = Math.hypot(q.x, q.y, q.z, q.w)
  if (len < 1e-9) return { x: 0, y: 0, z: 0, w: 1 }
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len }
}

function rotatePoint(
  q: { x: number; y: number; z: number; w: number },
  x: number, y: number, z: number
): { x: number; y: number; z: number } {
  const ux = q.y * z - q.z * y
  const uy = q.z * x - q.x * z
  const uz = q.x * y - q.y * x
  const vx = q.y * uz - q.z * uy
  const vy = q.z * ux - q.x * uz
  const vz = q.x * uy - q.y * ux
  return {
    x: x + 2 * (q.w * ux + vx),
    y: y + 2 * (q.w * uy + vy),
    z: z + 2 * (q.w * uz + vz),
  }
}

/**
 * Advance each kinematic mover and push its new pose into the WASM world.
 * Call once per frame, before `step()`: the C++ side derives linear and
 * angular velocity from the pose delta, which is what makes a spinning
 * platter drag a ball around rather than teleport through it.
 *
 * Poses are advanced here rather than read back from Rapier, because under
 * `wasm-owner` the Rapier world is no longer stepped:
 *
 *  - velocity-driven bodies (rotating platforms, mills) are integrated from
 *    their `angvel`/`linvel`, which Rapier would otherwise never apply;
 *  - pose-driven bodies (pistons, oscillators) use the target queued by
 *    `setNextKinematicTranslation`/`Rotation`, which Rapier would otherwise
 *    never commit.
 */
export function driveAdventureMovers(
  movers: AdventureMover[],
  engine: WasmSimEngine,
  dt: number
): void {
  if (!engine.setNextKinematicTransform) return
  const clamped = Math.min(Math.max(dt, 0), 1 / 30)

  for (const mover of movers) {
    if (mover.velocityDriven) {
      const w = mover.body.angvel()
      const v = mover.body.linvel()
      // ω as a small-angle quaternion delta, applied in world space.
      const half = clamped * 0.5
      const spin = quatMultiply(
        { x: w.x * half, y: w.y * half, z: w.z * half, w: 0 },
        mover.rotation
      )
      mover.rotation = normalizeQuat({
        x: mover.rotation.x + spin.x,
        y: mover.rotation.y + spin.y,
        z: mover.rotation.z + spin.z,
        w: mover.rotation.w + spin.w,
      })
      mover.position = {
        x: mover.position.x + v.x * clamped,
        y: mover.position.y + v.y * clamped,
        z: mover.position.z + v.z * clamped,
      }
    } else {
      // Pose-driven: read the queued kinematic target, falling back to the
      // body's committed transform when nothing is queued this frame.
      const nextT = mover.body.nextTranslation?.() ?? mover.body.translation()
      const nextR = mover.body.nextRotation?.() ?? mover.body.rotation()
      const bodyRot = { x: nextR.x, y: nextR.y, z: nextR.z, w: nextR.w }
      const offset = rotatePoint(
        bodyRot, mover.localOffset.x, mover.localOffset.y, mover.localOffset.z
      )
      mover.position = { x: nextT.x + offset.x, y: nextT.y + offset.y, z: nextT.z + offset.z }
      mover.rotation = quatMultiply(bodyRot, mover.localRotation)
    }

    engine.setNextKinematicTransform(mover.moverId, mover.position, mover.rotation)
  }
}

export { IDENTITY_Q }
