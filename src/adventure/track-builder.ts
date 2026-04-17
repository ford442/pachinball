/**
 * Track Builder Base Class
 * 
 * Provides the foundation for building adventure mode tracks with physics and visuals.
 */

import {
  MeshBuilder,
  Vector3,
  Scene,
  StandardMaterial,
  PBRMaterial,
  Color3,
  Quaternion,
  Mesh,
} from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import type {
  AdventureCallback,
  GravityWell,
  DampingZone,
  KinematicBinding,
  AnimatedObstacle,
  ConveyorZone,
  ChromaGate,
} from './adventure-types'
import {
  GROUP_UNIVERSAL,
  MASK_RED,
  MASK_GREEN,
  MASK_BLUE,
} from './adventure-types'

export abstract class TrackBuilder {
  protected scene: Scene
  protected world: RAPIER.World
  protected rapier: typeof RAPIER

  // State Management
  protected adventureTrack: Mesh[] = []
  protected materials: (StandardMaterial | PBRMaterial)[] = []
  protected adventureBodies: RAPIER.RigidBody[] = []
  protected kinematicBindings: KinematicBinding[] = []
  protected animatedObstacles: AnimatedObstacle[] = []
  protected conveyorZones: ConveyorZone[] = []
  protected gravityWells: GravityWell[] = []
  protected dampingZones: DampingZone[] = []
  protected chromaGates: ChromaGate[] = []
  protected adventureSensor: RAPIER.RigidBody | null = null
  protected resetSensors: RAPIER.RigidBody[] = []
  protected adventureActive = false
  protected currentStartPos: Vector3 = Vector3.Zero()
  protected timeAccumulator = 0
  protected currentBallMesh: Mesh | null = null

  // Communication
  protected onEvent: AdventureCallback | null = null

  constructor(scene: Scene, world: RAPIER.World, rapier: typeof RAPIER) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
  }

  /**
   * Registers a callback listener to handle story events in the main Game class.
   */
  setEventListener(callback: AdventureCallback): void {
    this.onEvent = callback
  }

  /**
   * Get sensor body for goal detection
   */
  getSensor(): RAPIER.RigidBody | null {
    return this.adventureSensor
  }

  /**
   * Get reset sensors for penalty zones
   */
  getResetSensors(): RAPIER.RigidBody[] {
    return this.resetSensors
  }

  /**
   * Check if adventure mode is currently active
   */
  isActive(): boolean {
    return this.adventureActive
  }

  /**
   * Get the current start position
   */
  getStartPos(): Vector3 {
    return this.currentStartPos
  }

  // --- Shared Helper for Materials ---
  protected getTrackMaterial(colorHex: string): StandardMaterial {
    const mat = new StandardMaterial("trackMat", this.scene)
    mat.emissiveColor = Color3.FromHexString(colorHex)
    mat.diffuseColor = Color3.Black()
    mat.alpha = 0.6
    mat.wireframe = true
    this.materials.push(mat)
    return mat
  }

  /**
   * Get a PBR track material with emissive glow and clear coat.
   * Use this for tracks that should look more physically realistic.
   */
  protected getTrackPBRMaterial(colorHex: string): PBRMaterial {
    const mat = new PBRMaterial("trackPBRMat", this.scene)
    mat.albedoColor = Color3.Black()
    mat.emissiveColor = Color3.FromHexString(colorHex)
    mat.emissiveIntensity = 1.2
    mat.metallic = 0.8
    mat.roughness = 0.2
    mat.alpha = 0.85
    mat.wireframe = true
    mat.clearCoat.isEnabled = true
    mat.clearCoat.intensity = 0.4
    mat.clearCoat.roughness = 0.2
    this.materials.push(mat)
    return mat
  }

  // --- Primitive Builders ---

  /**
   * Creates a straight ramp segment.
   * @param startPos Start position (top center of the start edge)
   * @param heading Y Rotation (direction)
   * @param width Width of the ramp
   * @param length Length of the mesh (Hypotenuse)
   * @param inclineRad Angle of slope in radians (Positive = Downward slope)
   * @param material Material
   * @param wallHeight Height of walls (0 for no walls)
   * @param friction Surface friction
   * @returns End position of the segment
   */
  protected addStraightRamp(
    startPos: Vector3,
    heading: number,
    width: number,
    length: number,
    inclineRad: number,
    material: StandardMaterial | PBRMaterial,
    wallHeight: number = 0,
    friction: number = 0.5
  ): Vector3 {
    if (!this.world) return startPos

    const box = MeshBuilder.CreateBox("straightRamp", { width, height: 0.5, depth: length }, this.scene)

    // Calculate Horizontal and Vertical components
    const hLen = length * Math.cos(inclineRad)
    const vDrop = length * Math.sin(inclineRad)

    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))

    // Center of the box
    const center = startPos.add(forward.scale(hLen / 2))
    center.y -= vDrop / 2

    box.position.copyFrom(center)
    box.rotation.y = heading
    box.rotation.x = inclineRad

    box.material = material
    this.adventureTrack.push(box)

    // Physics
    const q = Quaternion.FromEulerAngles(box.rotation.x, box.rotation.y, 0)
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed()
        .setTranslation(center.x, center.y, center.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(width / 2, 0.25, length / 2).setFriction(friction),
      body
    )
    this.adventureBodies.push(body)

    if (wallHeight > 0) {
      this.createWall(center, heading, length, width, wallHeight, inclineRad, material, friction)
    }

    // Return End Position
    const endPos = startPos.add(forward.scale(hLen))
    endPos.y -= vDrop
    return endPos
  }

  /**
   * Creates a curved ramp segment.
   */
  protected addCurvedRamp(
    startPos: Vector3,
    startHeading: number,
    radius: number,
    totalAngle: number,
    inclineRad: number,
    width: number,
    wallHeight: number,
    material: StandardMaterial | PBRMaterial,
    segments: number = 48,
    bankingAngle: number = 0,
    friction: number = 0.5
  ): Vector3 {
    if (!this.world) return startPos

    const segmentAngle = totalAngle / segments
    const arcLength = radius * Math.abs(segmentAngle)
    const chordLen = 2 * radius * Math.sin(Math.abs(segmentAngle) / 2)
    const segmentDrop = arcLength * Math.sin(inclineRad)

    let currentHeading = startHeading
    let currentP = startPos.clone()

    for (let i = 0; i < Math.abs(segments); i++) {
      currentHeading += (segmentAngle / 2)

      const forward = new Vector3(Math.sin(currentHeading), 0, Math.cos(currentHeading))
      const center = currentP.add(forward.scale(chordLen / 2))
      center.y -= segmentDrop / 2

      const box = MeshBuilder.CreateBox("curveSeg", { width, height: 0.5, depth: chordLen }, this.scene)
      box.position.copyFrom(center)

      box.rotation.x = inclineRad
      box.rotation.y = currentHeading
      box.rotation.z = bankingAngle

      box.material = material
      this.adventureTrack.push(box)

      const q = Quaternion.FromEulerAngles(box.rotation.x, box.rotation.y, box.rotation.z)
      const body = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed()
          .setTranslation(center.x, center.y, center.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      )
      this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(width / 2, 0.25, chordLen / 2).setFriction(friction),
        body
      )
      this.adventureBodies.push(body)

      if (wallHeight > 0) {
        this.createWall(center, currentHeading, chordLen, width, wallHeight, inclineRad, material, friction)
      }

      currentP = currentP.add(forward.scale(chordLen))
      currentP.y -= segmentDrop

      currentHeading += (segmentAngle / 2)
    }

    return currentP
  }

  /**
   * Creates walls alongside a track segment.
   */
  protected createWall(
    center: Vector3,
    heading: number,
    length: number,
    trackWidth: number,
    height: number,
    inclineRad: number,
    mat: StandardMaterial | PBRMaterial,
    friction: number = 0.5
  ) {
    if (!this.world) return

    const offsets = [trackWidth / 2 + 0.25, -trackWidth / 2 - 0.25]

    offsets.forEach(offset => {
      const wall = MeshBuilder.CreateBox("wall", { width: 0.5, height: height, depth: length }, this.scene)

      const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))
      const wallPos = center.add(right.scale(offset))
      wallPos.y += height / 2

      wall.position.copyFrom(wallPos)
      wall.rotation.y = heading
      wall.rotation.x = inclineRad
      wall.material = mat
      this.adventureTrack.push(wall)

      const q = Quaternion.FromEulerAngles(wall.rotation.x, wall.rotation.y, 0)
      const body = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed()
          .setTranslation(wallPos.x, wallPos.y, wallPos.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      )
      this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(0.25, height / 2, length / 2).setFriction(friction),
        body
      )
      this.adventureBodies.push(body)
    })
  }

  /**
   * Creates a rotating platform.
   */
  protected createRotatingPlatform(
    center: Vector3,
    radius: number,
    angVelY: number,
    material: StandardMaterial | PBRMaterial,
    hasTeeth: boolean = false
  ): void {
    if (!this.world) return

    const thickness = 0.5
    const cylinder = MeshBuilder.CreateCylinder("gear", { diameter: radius * 2, height: thickness, tessellation: 32 }, this.scene)
    cylinder.position.copyFrom(center)
    cylinder.material = material
    this.adventureTrack.push(cylinder)

    const bodyDesc = this.rapier.RigidBodyDesc.kinematicVelocityBased()
      .setTranslation(center.x, center.y, center.z)

    const body = this.world.createRigidBody(bodyDesc)
    body.setAngvel({ x: 0, y: angVelY, z: 0 }, true)

    const colliderDesc = this.rapier.ColliderDesc.cylinder(thickness / 2, radius)
      .setFriction(1.0)

    this.world.createCollider(colliderDesc, body)
    this.adventureBodies.push(body)

    this.kinematicBindings.push({ body, mesh: cylinder })

    if (hasTeeth) {
      const toothCount = 12
      const angleStep = (2 * Math.PI) / toothCount

      for (let i = 0; i < toothCount; i++) {
        if (i % 2 !== 0) continue

        const angle = i * angleStep
        const tx = Math.sin(angle) * (radius - 0.25)
        const tz = Math.cos(angle) * (radius - 0.25)

        const toothCollider = this.rapier.ColliderDesc.cuboid(0.5, 0.5, 1.0)
          .setTranslation(tx, 0.5 + 0.25, tz)
          .setRotation({ w: Math.cos(angle / 2), x: 0, y: Math.sin(angle / 2), z: 0 })

        this.world.createCollider(toothCollider, body)

        const tooth = MeshBuilder.CreateBox("tooth", { width: 1, height: 1, depth: 2 }, this.scene)
        tooth.parent = cylinder
        tooth.position.set(tx, 0.5 + 0.25, tz)
        tooth.rotation.y = angle
        tooth.material = material
      }
    }
  }

  /**
   * Creates a goal basin at the specified position.
   */
  protected createBasin(pos: Vector3, material: StandardMaterial): void {
    if (!this.world) return

    const basin = MeshBuilder.CreateBox("basin", { width: 8, height: 1, depth: 8 }, this.scene)
    basin.position.set(pos.x, pos.y - 1, pos.z)
    basin.material = material
    this.adventureTrack.push(basin)

    const bBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y - 1, pos.z)
    )
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(4, 0.5, 4), bBody)
    this.adventureBodies.push(bBody)

    // Exit Sensor
    const sensorY = pos.y - 0.5
    const sensor = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, sensorY, pos.z)
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(2, 1, 1)
        .setSensor(true)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
      sensor
    )
    this.adventureSensor = sensor
  }

  /**
   * Creates a static cylinder obstacle.
   */
  protected createStaticCylinder(pos: Vector3, diameter: number, height: number, material: StandardMaterial): void {
    if (!this.world) return

    const mesh = MeshBuilder.CreateCylinder("staticPillar", { diameter, height }, this.scene)
    mesh.position.copyFrom(pos)
    mesh.position.y += height / 2
    mesh.material = material
    this.adventureTrack.push(mesh)

    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cylinder(height / 2, diameter / 2),
      body
    )
    this.adventureBodies.push(body)
  }

  /**
   * Creates a dynamic physics block.
   */
  protected createDynamicBlock(pos: Vector3, size: number, mass: number, material: StandardMaterial): void {
    if (!this.world) return

    const box = MeshBuilder.CreateBox("dynBlock", { size }, this.scene)
    box.position.copyFrom(pos)
    box.material = material
    this.adventureTrack.push(box)

    const bodyDesc = this.rapier.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)

    const body = this.world.createRigidBody(bodyDesc)

    const volume = size * size * size
    const density = mass / volume

    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(size / 2, size / 2, size / 2)
        .setDensity(density)
        .setFriction(0.5)
        .setRestitution(0.2),
      body
    )
    this.adventureBodies.push(body)
    this.kinematicBindings.push({ body, mesh: box })
  }

  /**
   * Creates a chroma gate that changes ball color state.
   */
  protected createChromaGate(pos: Vector3, color: 'RED' | 'GREEN' | 'BLUE'): void {
    if (!this.world) return

    const gateMat = this.getTrackMaterial(color === 'RED' ? "#FF0000" : color === 'GREEN' ? "#00FF00" : "#0000FF")
    const gate = MeshBuilder.CreateTorus("gate", { diameter: 4, thickness: 0.2 }, this.scene)
    gate.position.copyFrom(pos)
    gate.rotation.x = Math.PI / 2
    gate.material = gateMat
    this.adventureTrack.push(gate)

    const sensor = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cylinder(0.5, 2.0).setSensor(true),
      sensor
    )

    this.chromaGates.push({ sensor, colorType: color })
  }

  /**
   * Creates an arc pylon with repulsive gravity well.
   */
  protected createArcPylon(pos: Vector3, mat: StandardMaterial): void {
    if (!this.world) return

    const pylon = MeshBuilder.CreateCylinder("pylon", { diameter: 1.0, height: 3.0 }, this.scene)
    pylon.position.copyFrom(pos)
    pylon.position.y += 1.5
    pylon.material = mat
    this.adventureTrack.push(pylon)

    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y + 1.5, pos.z)
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cylinder(1.5, 0.5),
      body
    )
    this.adventureBodies.push(body)

    // Repulsive Gravity Well
    const sensor = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y + 1.5, pos.z)
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.ball(3.0).setSensor(true),
      sensor
    )

    this.gravityWells.push({
      sensor,
      center: pos,
      strength: -50.0 // Repel
    })
  }

  /**
   * Sets ball color state for collision filtering.
   */
  protected setBallColorState(ball: RAPIER.RigidBody, color: 'RED' | 'GREEN' | 'BLUE'): void {
    const collider = ball.collider(0)
    if (!collider) return

    let groups = 0

    switch (color) {
      case 'RED':
        groups = (GROUP_UNIVERSAL << 16) | MASK_RED
        break
      case 'GREEN':
        groups = (GROUP_UNIVERSAL << 16) | MASK_GREEN
        break
      case 'BLUE':
        groups = (GROUP_UNIVERSAL << 16) | MASK_BLUE
        break
    }

    collider.setCollisionGroups(groups)

    if (this.currentBallMesh) {
      const mat = this.currentBallMesh.material as StandardMaterial | PBRMaterial
      if (mat) {
        const matColor = color === 'RED' ? Color3.Red() : color === 'GREEN' ? Color3.Green() : Color3.Blue()
        mat.emissiveColor = matColor
        if ('diffuseColor' in mat) {
          mat.diffuseColor = matColor
        } else if ('albedoColor' in mat) {
          mat.albedoColor = matColor
        }
      }
    }
  }
}
