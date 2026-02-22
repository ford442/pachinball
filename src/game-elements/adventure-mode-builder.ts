import {
  MeshBuilder,
  Vector3,
  Scene,
  StandardMaterial,
  Color3,
  Quaternion,
  ArcRotateCamera,
  Mesh,
} from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'

// Event callback signature for communicating with Game.ts
export type AdventureCallback = (event: string, data?: unknown) => void

export enum AdventureTrackType {
  NEON_HELIX = 'NEON_HELIX',
  CYBER_CORE = 'CYBER_CORE',
  QUANTUM_GRID = 'QUANTUM_GRID',
  SINGULARITY_WELL = 'SINGULARITY_WELL',
  GLITCH_SPIRE = 'GLITCH_SPIRE',
  RETRO_WAVE_HILLS = 'RETRO_WAVE_HILLS',
  CHRONO_CORE = 'CHRONO_CORE',
  HYPER_DRIFT = 'HYPER_DRIFT',
  PACHINKO_SPIRE = 'PACHINKO_SPIRE',
  ORBITAL_JUNKYARD = 'ORBITAL_JUNKYARD',
  FIREWALL_BREACH = 'FIREWALL_BREACH',
  CPU_CORE = 'CPU_CORE',
  CRYO_CHAMBER = 'CRYO_CHAMBER',
  BIO_HAZARD_LAB = 'BIO_HAZARD_LAB',
  GRAVITY_FORGE = 'GRAVITY_FORGE',
  TIDAL_NEXUS = 'TIDAL_NEXUS',
  DIGITAL_ZEN_GARDEN = 'DIGITAL_ZEN_GARDEN',
  SYNTHWAVE_SURF = 'SYNTHWAVE_SURF',
  SOLAR_FLARE = 'SOLAR_FLARE',
  PRISM_PATHWAY = 'PRISM_PATHWAY',
  MAGNETIC_STORAGE = 'MAGNETIC_STORAGE',
  NEURAL_NETWORK = 'NEURAL_NETWORK',
  NEON_STRONGHOLD = 'NEON_STRONGHOLD',
  CASINO_HEIST = 'CASINO_HEIST',
  TESLA_TOWER = 'TESLA_TOWER',
  NEON_SKYLINE = 'NEON_SKYLINE',
  POLYCHROME_VOID = 'POLYCHROME_VOID',
}

export const GROUP_UNIVERSAL = 0x0001
export const GROUP_RED = 0x0002
export const GROUP_GREEN = 0x0004
export const GROUP_BLUE = 0x0008

export const MASK_ALL = 0xFFFF
export const MASK_RED = GROUP_UNIVERSAL | GROUP_RED
export const MASK_GREEN = GROUP_UNIVERSAL | GROUP_GREEN
export const MASK_BLUE = GROUP_UNIVERSAL | GROUP_BLUE

interface GravityWell {
  sensor: RAPIER.RigidBody
  center: Vector3
  strength: number
}

interface DampingZone {
  sensor: RAPIER.RigidBody
  damping: number
}

interface KinematicBinding {
  body: RAPIER.RigidBody
  mesh: Mesh
}

interface AnimatedObstacle extends KinematicBinding {
  type: 'PISTON' | 'OSCILLATOR' | 'ROTATING_OSCILLATOR'
  basePos: Vector3
  baseRot?: Quaternion
  frequency: number
  amplitude: number
  phase: number
  axis?: Vector3
}

interface ConveyorZone {
  sensor: RAPIER.RigidBody
  force: Vector3
}

interface ChromaGate {
  sensor: RAPIER.RigidBody
  colorType: 'RED' | 'GREEN' | 'BLUE'
}


export abstract class AdventureModeBuilder {
  protected scene: Scene
  protected world: RAPIER.World
  protected rapier: typeof RAPIER

  // State Management
  protected adventureTrack: Mesh[] = []
  protected materials: StandardMaterial[] = []
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

  // Camera Management
  protected tableCamera: ArcRotateCamera | null = null
  protected followCamera: ArcRotateCamera | null = null

  // Communication
  protected onEvent: AdventureCallback | null = null

  constructor(scene: Scene, world: RAPIER.World, rapier: typeof RAPIER) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
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


  // --- Track: The Neon Helix (Original) ---
  protected createHelixTrack(): void {
    const holoMat = this.getTrackMaterial("#00ffff")
    let currentPos = this.currentStartPos.clone()
    let heading = Math.PI

    const addRamp = (width: number, length: number, drop: number, rotY: number) => {
       const incline = Math.atan2(drop, length)
       const meshLen = Math.sqrt(length * length + drop * drop)
       this.addStraightRamp(currentPos, rotY, width, meshLen, incline, holoMat)
       const forward = new Vector3(Math.sin(rotY), 0, Math.cos(rotY))
       currentPos = currentPos.add(forward.scale(length))
       currentPos.y -= drop
    }

    addRamp(6, 10, 4, heading)
    heading += Math.PI / 2
    addRamp(4, 8, 1, heading)
    heading -= Math.PI / 1.5
    addRamp(4, 12, 3, heading)

    this.createBasin(currentPos, holoMat)
  }

  // --- Track: The Cyber-Core Descent (New) ---
  protected createDescentTrack(): void {
      const coreMat = this.getTrackMaterial("#ff0033")
      let currentPos = this.currentStartPos.clone()
      let heading = 0

      const dropLen = 15
      const dropIncline = (20 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 6, dropLen, dropIncline, coreMat)

      const curve1Radius = 15
      const curve1Angle = Math.PI
      const curve1Incline = (5 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, curve1Radius, curve1Angle, curve1Incline, 6, 3.0, coreMat)
      heading += curve1Angle

      const gapLength = 8
      const gapDrop = 2
      const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(gapLength)
      currentPos = currentPos.add(gapForward)
      currentPos.y -= gapDrop

      currentPos = this.addStraightRamp(currentPos, heading, 6, 5, 0, coreMat)

      const corkRadius = 8
      const corkAngle = (270 * Math.PI) / 180
      const corkIncline = (15 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, corkRadius, corkAngle, corkIncline, 6, 1.0, coreMat)
      heading += corkAngle

      this.createBasin(currentPos, coreMat)
  }

  // --- Track: The Quantum Grid ---
  protected createQuantumGridTrack(): void {
      const gridMat = this.getTrackMaterial("#00FF00")
      let currentPos = this.currentStartPos.clone()
      let heading = 0

      currentPos = this.addStraightRamp(currentPos, heading, 4, 10, 0, gridMat)

      const zigzagWidth = 3
      const zigzagLen = 5
      const zigzagIncline = 0

      currentPos = this.addStraightRamp(currentPos, heading, zigzagWidth, zigzagLen, zigzagIncline, gridMat)
      heading -= Math.PI / 2
      currentPos = this.addStraightRamp(currentPos, heading, zigzagWidth, zigzagLen, zigzagIncline, gridMat)
      heading += Math.PI / 2
      currentPos = this.addStraightRamp(currentPos, heading, zigzagWidth, zigzagLen, zigzagIncline, gridMat)

      const orbitRadius = 6
      const orbitAngle = (270 * Math.PI) / 180
      const orbitIncline = - (5 * Math.PI) / 180
      const orbitWallHeight = 0.5

      currentPos = this.addCurvedRamp(currentPos, heading, orbitRadius, orbitAngle, orbitIncline, zigzagWidth, orbitWallHeight, gridMat)
      heading += orbitAngle

      const gapLength = 4
      const gapDrop = 1
      const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(gapLength)
      currentPos = currentPos.add(gapForward)
      currentPos.y -= gapDrop

      currentPos = this.addStraightRamp(currentPos, heading, 4, 3, 0, gridMat)

      this.createBasin(currentPos, gridMat)
  }

  // --- Track: The Singularity Well ---
  protected createSingularityWell(): void {
      const wellMat = this.getTrackMaterial("#9900FF")
      let currentPos = this.currentStartPos.clone()
      let heading = 0

      const injectLen = 12
      const injectIncline = (15 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 6, injectLen, injectIncline, wellMat)

      const rimRadius = 14
      const rimAngle = Math.PI
      const rimIncline = (5 * Math.PI) / 180
      const rimBank = - (15 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, rimRadius, rimAngle, rimIncline, 6, 4.0, wellMat, 20, rimBank)
      heading += rimAngle

      const gapLength = 4
      const gapDrop = 2
      const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(gapLength)
      currentPos = currentPos.add(gapForward)
      currentPos.y -= gapDrop

      currentPos = this.addStraightRamp(currentPos, heading, 6, 4, 0, wellMat)

      const diskRadius = 8
      const diskAngle = (270 * Math.PI) / 180
      const diskIncline = (10 * Math.PI) / 180
      const diskBank = - (25 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, diskRadius, diskAngle, diskIncline, 6, 1.0, wellMat, 20, diskBank)
      heading += diskAngle

      this.createBasin(currentPos, wellMat)
  }

  // --- Track: The Glitch Spire ---
  protected createGlitchSpireTrack(): void {
      const glitchMat = this.getTrackMaterial("#FF00FF")
      let currentPos = this.currentStartPos.clone()
      let heading = 0

      const uplinkLen = 15
      const uplinkIncline = - (20 * Math.PI) / 180

      currentPos = this.addStraightRamp(currentPos, heading, 4, uplinkLen, uplinkIncline, glitchMat)

      const gapLength = 6
      const gapDrop = 4
      const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(gapLength)
      currentPos = currentPos.add(gapForward)
      currentPos.y -= gapDrop

      currentPos = this.addStraightRamp(currentPos, heading, 4, 3, 0, glitchMat)

      heading += Math.PI / 2
      currentPos = this.addStraightRamp(currentPos, heading, 3, 5, 0, glitchMat)
      heading -= Math.PI / 2
      currentPos = this.addStraightRamp(currentPos, heading, 3, 5, 0, glitchMat)

      const spiralRadius = 8
      const spiralAngle = 2 * Math.PI
      const spiralIncline = (10 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, spiralRadius, spiralAngle, spiralIncline, 3, 0.5, glitchMat, 30)
      heading += spiralAngle

      this.createBasin(currentPos, glitchMat)
  }

  // --- Track: The Retro-Wave Hills ---
  protected createRetroWaveHills(): void {
      const retroMat = this.getTrackMaterial("#FF8800")
      let currentPos = this.currentStartPos.clone()
      let heading = 0

      currentPos = this.addStraightRamp(currentPos, heading, 6, 10, 0, retroMat)

      const hillLen = 8
      const rise1Incline = - (15 * Math.PI) / 180
      const fall1Incline = (15 * Math.PI) / 180

      currentPos = this.addStraightRamp(currentPos, heading, 6, hillLen, rise1Incline, retroMat)
      currentPos = this.addStraightRamp(currentPos, heading, 6, hillLen, fall1Incline, retroMat)

      const rise2Incline = - (20 * Math.PI) / 180
      const fall2Incline = (20 * Math.PI) / 180

      currentPos = this.addStraightRamp(currentPos, heading, 6, hillLen, rise2Incline, retroMat)
      currentPos = this.addStraightRamp(currentPos, heading, 6, hillLen, fall2Incline, retroMat)

      const turnRadius = 12
      const turnAngle = Math.PI
      const turnIncline = 0
      const banking = - (15 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, turnRadius, turnAngle, turnIncline, 6, 2.0, retroMat, 20, banking)
      heading += turnAngle

      const jumpLen = 12
      const jumpIncline = - (25 * Math.PI) / 180

      currentPos = this.addStraightRamp(currentPos, heading, 4, jumpLen, jumpIncline, retroMat)

      const jumpForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const goalDist = 15
      const goalHeight = 5

      const goalPos = currentPos.add(jumpForward.scale(goalDist))
      goalPos.y += goalHeight

      this.createBasin(goalPos, retroMat)
  }

  // --- Track: The Chrono-Core ---
  protected createChronoCore(): void {
      const chronoMat = this.getTrackMaterial("#FFD700")
      let currentPos = this.currentStartPos.clone()
      const heading = 0

      const entryLen = 10
      const entryIncline = (10 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 5, entryLen, entryIncline, chronoMat)

      const gear1Radius = 8
      const gear1Speed = (30 * Math.PI) / 180
      const gear1AngVel = -gear1Speed

      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      currentPos.y -= 1.0
      const gear1Center = currentPos.add(forward.scale(gear1Radius + 1))

      this.createRotatingPlatform(gear1Center, gear1Radius, gear1AngVel, chronoMat)

      currentPos = gear1Center.add(forward.scale(gear1Radius))
      currentPos = this.addStraightRamp(currentPos, heading, 3, 12, 0, chronoMat)

      const gear2Radius = 10
      const gear2Speed = (20 * Math.PI) / 180
      const gear2AngVel = gear2Speed

      const gear2Center = currentPos.add(forward.scale(gear2Radius + 0.5))
      this.createRotatingPlatform(gear2Center, gear2Radius, gear2AngVel, chronoMat, true)

      const goalPos = gear2Center.clone()
      goalPos.y += 4.0

      const jumpRampPos = gear2Center.add(forward.scale(gear2Radius - 2))
      const jumpHeading = heading + Math.PI

      this.addStraightRamp(jumpRampPos, jumpHeading, 4, 4, -(30 * Math.PI)/180, chronoMat)
      this.createBasin(goalPos, chronoMat)
  }


  protected createDynamicBlock(pos: Vector3, size: number, mass: number, material: StandardMaterial): void {
      if (!this.world) return

      const box = MeshBuilder.CreateBox("dynBlock", { size }, this.scene)
      box.position.copyFrom(pos)
      box.material = material
      this.adventureTrack.push(box)

      const bodyDesc = this.rapier.RigidBodyDesc.dynamic()
          .setTranslation(pos.x, pos.y, pos.z)

      const body = this.world.createRigidBody(bodyDesc)

      // Calculate density based on mass and volume to achieve desired mass
      // Volume = size^3
      // Density = Mass / Volume
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

      // Need to sync this dynamic body to mesh
      // We can reuse the kinematicBindings array since it just maps body->mesh in update()
      // although the name implies kinematic, the update loop logic is generic:
      // "Sync kinematic bodies to visuals... pos = body.translation()..."
      // So checking update():
      /*
        for (const binding of this.kinematicBindings) {
            if (!binding.body || !binding.mesh) continue
            const pos = binding.body.translation()
            ...
        }
      */
      // Yes, this works for dynamic bodies too.
      this.kinematicBindings.push({ body, mesh: box })
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
   * @returns End position of the segment
   */
  protected addStraightRamp(
      startPos: Vector3,
      heading: number,
      width: number,
      length: number,
      inclineRad: number,
      material: StandardMaterial,
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
      // Move half the horizontal distance forward, and half the vertical drop down
      const center = startPos.add(forward.scale(hLen / 2))
      center.y -= vDrop / 2
      
      box.position.copyFrom(center)
      box.rotation.y = heading
      box.rotation.x = inclineRad // Babylon +X rotation tilts the nose down/up depending on orientation.
      
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

  protected addCurvedRamp(
      startPos: Vector3,
      startHeading: number,
      radius: number,
      totalAngle: number,
      inclineRad: number,
      width: number,
      wallHeight: number,
      material: StandardMaterial,
      segments: number = 20,
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

  protected createWall(
      center: Vector3,
      heading: number,
      length: number,
      trackWidth: number,
      height: number,
      inclineRad: number,
      mat: StandardMaterial,
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

  protected createRotatingPlatform(
    center: Vector3,
    radius: number,
    angVelY: number,
    material: StandardMaterial,
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
                 .setRotation( { w: Math.cos(angle/2), x: 0, y: Math.sin(angle/2), z: 0 } )

             this.world.createCollider(toothCollider, body)

             const tooth = MeshBuilder.CreateBox("tooth", { width: 1, height: 1, depth: 2 }, this.scene)
             tooth.parent = cylinder
             tooth.position.set(tx, 0.5 + 0.25, tz)
             tooth.rotation.y = angle
             tooth.material = material
        }
      }
  }

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


  protected createStaticCylinder(pos: Vector3, diameter: number, height: number, material: StandardMaterial): void {
      if (!this.world) return

      const mesh = MeshBuilder.CreateCylinder("staticPillar", { diameter, height }, this.scene)
      mesh.position.copyFrom(pos)
      mesh.position.y += height / 2 // Sit on floor (approx)
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

}
