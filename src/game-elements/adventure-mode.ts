import {
  ArcRotateCamera,
  Vector3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Quaternion,
  Color3,
} from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { AdventureModeTracksB } from './adventure-mode-tracks-b'
export { AdventureTrackType } from './adventure-mode-builder'
export type { AdventureCallback } from './adventure-mode-builder'
import {
  AdventureTrackType,
  GROUP_UNIVERSAL,
  GROUP_RED,
  GROUP_GREEN,
  GROUP_BLUE,
  MASK_ALL,
  MASK_RED,
  MASK_GREEN,
  MASK_BLUE,
} from './adventure-mode-builder'
import type { AdventureCallback } from './adventure-mode-builder'

export class AdventureMode extends AdventureModeTracksB {
  /**
   * Registers a callback listener to handle story events in the main Game class.
   */
  setEventListener(callback: AdventureCallback): void {
    this.onEvent = callback
  }

  isActive(): boolean {
    return this.adventureActive
  }

  getSensor(): RAPIER.RigidBody | null {
    return this.adventureSensor
  }

  getResetSensors(): RAPIER.RigidBody[] {
    return this.resetSensors
  }

  getStartPos(): Vector3 {
    return this.currentStartPos
  }

  update(dt: number = 0.016, ballBodies: RAPIER.RigidBody[] = []): void {
    if (!this.adventureActive) return

    this.timeAccumulator += dt

    // 1. Animate Obstacles
    for (const obst of this.animatedObstacles) {
        if (obst.type === 'PISTON') {
            const yOffset = Math.sin(this.timeAccumulator * obst.frequency + obst.phase) * obst.amplitude
            // Pistons move up from base.
            // Formula: y = base + offset
            const newY = obst.basePos.y + yOffset
            obst.body.setNextKinematicTranslation({ x: obst.basePos.x, y: newY, z: obst.basePos.z })
        } else if (obst.type === 'OSCILLATOR') {
            const offset = Math.sin(this.timeAccumulator * obst.frequency + obst.phase) * obst.amplitude
            const axis = obst.axis || new Vector3(0, 1, 0)
            const move = axis.scale(offset)
            const newPos = obst.basePos.add(move)
            obst.body.setNextKinematicTranslation({ x: newPos.x, y: newPos.y, z: newPos.z })
        } else if (obst.type === 'ROTATING_OSCILLATOR') {
            const angle = Math.sin(this.timeAccumulator * obst.frequency + obst.phase) * obst.amplitude
            const axis = obst.axis || new Vector3(0, 1, 0)
            const baseRot = obst.baseRot || new Quaternion()
            const offsetRot = Quaternion.RotationAxis(axis, angle)
            const newRot = baseRot.multiply(offsetRot)
            obst.body.setNextKinematicRotation({ x: newRot.x, y: newRot.y, z: newRot.z, w: newRot.w })
        }
    }

    // 2. Apply Conveyor Forces
    // Check if any ball is inside a conveyor sensor
    for (const zone of this.conveyorZones) {
        const sensorHandle = zone.sensor.collider(0)
        for (const ball of ballBodies) {
            const ballHandle = ball.collider(0)
            if (this.world.intersectionPair(sensorHandle, ballHandle)) {
                const imp = zone.force.scale(dt)
                ball.applyImpulse({ x: imp.x, y: imp.y, z: imp.z }, true)
            }
        }
    }

    // 3. Apply Gravity Wells
    for (const well of this.gravityWells) {
        const sensorHandle = well.sensor.collider(0)
        for (const ball of ballBodies) {
            const ballHandle = ball.collider(0)
            if (this.world.intersectionPair(sensorHandle, ballHandle)) {
                // Direction towards center
                const ballPos = ball.translation()
                const dir = well.center.subtract(new Vector3(ballPos.x, ballPos.y, ballPos.z)).normalize()
                const imp = dir.scale(well.strength * dt)
                ball.applyImpulse({ x: imp.x, y: imp.y, z: imp.z }, true)
            }
        }
    }

    // 4. Apply Damping Zones
    for (const zone of this.dampingZones) {
        const sensorHandle = zone.sensor.collider(0)
        for (const ball of ballBodies) {
            const ballHandle = ball.collider(0)
            if (this.world.intersectionPair(sensorHandle, ballHandle)) {
                // F = -v * k
                const vel = ball.linvel()
                const force = {
                    x: -vel.x * zone.damping,
                    y: -vel.y * zone.damping,
                    z: -vel.z * zone.damping
                }
                // Apply as Impulse: F * dt
                ball.applyImpulse({ x: force.x * dt, y: force.y * dt, z: force.z * dt }, true)
            }
        }
    }

    // 5. Apply Chroma Gates
    for (const gate of this.chromaGates) {
        const sensorHandle = gate.sensor.collider(0)
        for (const ball of ballBodies) {
            const ballHandle = ball.collider(0)
            if (this.world.intersectionPair(sensorHandle, ballHandle)) {
                this.setBallColorState(ball, gate.colorType)
            }
        }
    }

    // 6. Sync kinematic bodies to visuals
    // This includes standard kinematics (rotating platforms) and our animated ones
    const allBindings = [...this.kinematicBindings, ...this.animatedObstacles]
    for (const binding of allBindings) {
      if (!binding.body || !binding.mesh) continue
      const pos = binding.body.translation()
      const rot = binding.body.rotation()
      binding.mesh.position.set(pos.x, pos.y, pos.z)
      if (!binding.mesh.rotationQuaternion) {
        binding.mesh.rotationQuaternion = new Quaternion(rot.x, rot.y, rot.z, rot.w)
      } else {
        binding.mesh.rotationQuaternion.set(rot.x, rot.y, rot.z, rot.w)
      }
    }
  }

  /**
   * Activates Adventure Mode:
   * 1. Emits 'START' event
   * 2. Builds the holographic track
   * 3. Teleports the ball
   * 4. Swaps camera to Isometric Follow view
   */
  start(
    ballBody: RAPIER.RigidBody,
    currentCamera: ArcRotateCamera,
    ballMesh: Mesh | undefined,
    trackType: AdventureTrackType = AdventureTrackType.CYBER_CORE
  ): void {
    if (this.adventureActive) return
    this.adventureActive = true

    // Notify the Game class to update the Display
    if (this.onEvent) this.onEvent('START', trackType)

    // Set Start Position based on Track
    if (trackType === AdventureTrackType.CYBER_CORE) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createDescentTrack()
    } else if (trackType === AdventureTrackType.QUANTUM_GRID) {
        this.currentStartPos = new Vector3(0, 10, 0)
        this.createQuantumGridTrack()
    } else if (trackType === AdventureTrackType.SINGULARITY_WELL) {
        this.currentStartPos = new Vector3(0, 25, 0)
        this.createSingularityWell()
    } else if (trackType === AdventureTrackType.GLITCH_SPIRE) {
        this.currentStartPos = new Vector3(0, 10, 0)
        this.createGlitchSpireTrack()
    } else if (trackType === AdventureTrackType.RETRO_WAVE_HILLS) {
        this.currentStartPos = new Vector3(0, 5, 0)
        this.createRetroWaveHills()
    } else if (trackType === AdventureTrackType.CHRONO_CORE) {
        this.currentStartPos = new Vector3(0, 15, 0)
        this.createChronoCore()
    } else if (trackType === AdventureTrackType.HYPER_DRIFT) {
        this.currentStartPos = new Vector3(0, 15, 0)
        this.createHyperDriftTrack()
    } else if (trackType === AdventureTrackType.PACHINKO_SPIRE) {
        this.currentStartPos = new Vector3(0, 30, 0)
        this.createPachinkoSpireTrack()
    } else if (trackType === AdventureTrackType.ORBITAL_JUNKYARD) {
        this.currentStartPos = new Vector3(0, 15, 0)
        this.createOrbitalJunkyardTrack()
    } else if (trackType === AdventureTrackType.FIREWALL_BREACH) {
        this.currentStartPos = new Vector3(0, 25, 0)
        this.createFirewallBreachTrack()
    } else if (trackType === AdventureTrackType.CPU_CORE) {
        this.currentStartPos = new Vector3(0, 15, 0)
        this.createCpuCoreTrack()
    } else if (trackType === AdventureTrackType.CRYO_CHAMBER) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createCryoChamberTrack()
    } else if (trackType === AdventureTrackType.BIO_HAZARD_LAB) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createBioHazardLabTrack()
    } else if (trackType === AdventureTrackType.GRAVITY_FORGE) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createGravityForgeTrack()
    } else if (trackType === AdventureTrackType.TIDAL_NEXUS) {
        this.currentStartPos = new Vector3(0, 25, 0)
        this.createTidalNexusTrack()
    } else if (trackType === AdventureTrackType.DIGITAL_ZEN_GARDEN) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createDigitalZenGardenTrack()
    } else if (trackType === AdventureTrackType.SYNTHWAVE_SURF) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createSynthwaveSurfTrack()
    } else if (trackType === AdventureTrackType.SOLAR_FLARE) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createSolarFlareTrack()
    } else if (trackType === AdventureTrackType.PRISM_PATHWAY) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createPrismPathwayTrack()
    } else if (trackType === AdventureTrackType.MAGNETIC_STORAGE) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createMagneticStorageTrack()
    } else if (trackType === AdventureTrackType.NEURAL_NETWORK) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createNeuralNetworkTrack()
    } else if (trackType === AdventureTrackType.NEON_STRONGHOLD) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createNeonStrongholdTrack()
    } else if (trackType === AdventureTrackType.CASINO_HEIST) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createCasinoHeistTrack()
    } else if (trackType === AdventureTrackType.TESLA_TOWER) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createTeslaTowerTrack()
    } else if (trackType === AdventureTrackType.NEON_SKYLINE) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createNeonSkylineTrack()
    } else if (trackType === AdventureTrackType.POLYCHROME_VOID) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createPolychromeVoidTrack()
    } else {
        this.currentStartPos = new Vector3(0, 2, 8) // Helix default
        this.createHelixTrack()
    }
    
    // Reset ball velocity
    ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
    ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true)
    ballBody.setTranslation({ x: this.currentStartPos.x, y: this.currentStartPos.y, z: this.currentStartPos.z }, true)
    
    // Store original camera to restore later
    this.tableCamera = currentCamera
    this.currentBallMesh = ballMesh || null

    // Create new RPG-style Isometric Camera
    // For Pachinko Spire, maybe a different angle?
    // Plan says "Camera looks down (or sideways?)".
    // Default ISO is fine, but maybe steeper pitch?

    this.followCamera = new ArcRotateCamera("isoCam", -Math.PI / 2, Math.PI / 3, 14, Vector3.Zero(), this.scene)

    if (trackType === AdventureTrackType.PACHINKO_SPIRE) {
        // Look more directly at the board
        this.followCamera.beta = Math.PI / 2.5
        this.followCamera.radius = 20
    }

    this.followCamera.lowerRadiusLimit = 8
    this.followCamera.upperRadiusLimit = 35
    this.followCamera.attachControl(this.scene.getEngine().getRenderingCanvas(), true)
    
    if (ballMesh) {
      this.followCamera.lockedTarget = ballMesh
    }
    
    this.scene.activeCamera = this.followCamera
  }

  end(): void {
    if (!this.adventureActive) return
    this.adventureActive = false
    
    if (this.onEvent) this.onEvent('END')

    // Restore Table Camera
    if (this.tableCamera) {
      this.scene.activeCamera = this.tableCamera
      this.followCamera?.dispose()
      this.followCamera = null
    }
    
    this.currentBallMesh = null

    // Cleanup Visuals
    this.adventureTrack.forEach(m => m.dispose())
    this.adventureTrack = []
    this.materials.forEach(m => m.dispose())
    this.materials = []
    this.kinematicBindings = []
    this.animatedObstacles = []
    
    // Cleanup Physics
    this.adventureBodies.forEach(body => {
      if (this.world.getRigidBody(body.handle)) {
        this.world.removeRigidBody(body)
      }
    })
    this.adventureBodies = []

    this.conveyorZones.forEach(z => {
        if (this.world.getRigidBody(z.sensor.handle)) {
            this.world.removeRigidBody(z.sensor)
        }
    })
    this.conveyorZones = []

    this.gravityWells.forEach(w => {
        if (this.world.getRigidBody(w.sensor.handle)) {
            this.world.removeRigidBody(w.sensor)
        }
    })
    this.gravityWells = []

    this.dampingZones.forEach(z => {
        if (this.world.getRigidBody(z.sensor.handle)) {
            this.world.removeRigidBody(z.sensor)
        }
    })
    this.dampingZones = []
    
    if (this.adventureSensor) {
      if (this.world.getRigidBody(this.adventureSensor.handle)) {
          this.world.removeRigidBody(this.adventureSensor)
      }
      this.adventureSensor = null
    }

    this.resetSensors.forEach(s => {
        if (this.world.getRigidBody(s.handle)) {
            this.world.removeRigidBody(s)
        }
    })
    this.resetSensors = []

    this.chromaGates.forEach(g => {
        if (this.world.getRigidBody(g.sensor.handle)) {
            this.world.removeRigidBody(g.sensor)
        }
    })
    this.chromaGates = []
  }


  // --- Track: The Solar Flare ---
  protected createSolarFlareTrack(): void {
      const plasmaMat = this.getTrackMaterial("#FF4500") // Orange Red
      const coreMat = this.getTrackMaterial("#FFFF00") // Yellow

      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. Coronal Mass Ejection (Launch)
      // Length 15, Incline -20 deg, Width 6
      const launchLen = 15
      const launchIncline = (20 * Math.PI) / 180
      const launchStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, 6, launchLen, launchIncline, plasmaMat)

      // Plasma Boost: Conveyor Force +10.0 Z (relative to ramp)
      if (this.world) {
          const hLen = launchLen * Math.cos(launchIncline)
          const vDrop = launchLen * Math.sin(launchIncline)
          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          const center = launchStart.add(forward.scale(hLen / 2))
          center.y -= vDrop / 2
          center.y += 0.5

          const sensor = this.world.createRigidBody(
              this.rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z)
          )
          const q = Quaternion.FromEulerAngles(launchIncline, heading, 0)
          sensor.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

          this.world.createCollider(
              this.rapier.ColliderDesc.cuboid(3, 1, launchLen / 2).setSensor(true),
              sensor
          )

          // Force Vector: 10.0 * 10 = 100.0? Based on previous 60.0 for 8.0.
          // Let's try 80.0
          const forceDir = new Vector3(
              Math.sin(heading) * Math.cos(launchIncline),
              -Math.sin(launchIncline),
              Math.cos(heading) * Math.cos(launchIncline)
          )
          this.conveyorZones.push({
              sensor,
              force: forceDir.scale(80.0)
          })
      }

      // 2. The Prominence (Vertical Arch)
      // Parabolic Arch: Rise 8 units, Fall 8 units. Length 20.
      const archLen = 20
      const segments = 10
      const segLen = archLen / segments
      const archWidth = 4

      // Parabola y = -a * x^2 + h
      // Starts at x=0, y=0. Ends at x=20, y=0??
      // "Rise 8 units, Fall 8 units".
      // Let's model as y = -0.08 * (x - 10)^2 + 8.
      // x=0 -> y = -0.08 * 100 + 8 = 0.
      // x=10 -> y=8.
      // x=20 -> y=0.
      // Slope dy/dx = -0.16 * (x - 10).

      for (let i = 0; i < segments; i++) {
          const x0 = i * segLen
          const x1 = (i + 1) * segLen
          const xm = (x0 + x1) / 2

          const slope = -0.16 * (xm - 10)
          const incline = -Math.atan(slope)
          const meshLen = Math.sqrt(1 + slope * slope) * segLen

          currentPos = this.addStraightRamp(currentPos, heading, archWidth, meshLen, incline, plasmaMat, 0.5)
      }

      // 3. The Sunspot Field (Hazard)
      // Flat, Length 25, Width 12
      const fieldLen = 25
      const fieldWidth = 12
      const fieldStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, fieldWidth, fieldLen, 0, plasmaMat)

      // Gravity Wells
      if (this.world) {
          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))
          const wellStrength = 40.0 // Plan says 10.0. Boost for effect?

          // Positions
          const positions = [
             { z: 5, x: -3 },
             { z: 12, x: 3 },
             { z: 20, x: 0 }
          ]

          positions.forEach(p => {
              const wellPos = fieldStart.add(forward.scale(p.z)).add(right.scale(p.x))
              wellPos.y += 0.5

              // Visual: Swirling Vortex? Use cylinder for now.
              const vortex = MeshBuilder.CreateCylinder("vortex", { diameter: 4, height: 0.1 }, this.scene)
              vortex.position.copyFrom(wellPos)
              vortex.material = coreMat // Yellow center
              this.adventureTrack.push(vortex)

              // Sensor
              const sensor = this.world.createRigidBody(
                  this.rapier.RigidBodyDesc.fixed().setTranslation(wellPos.x, wellPos.y, wellPos.z)
              )
              this.world.createCollider(
                  this.rapier.ColliderDesc.cylinder(1.0, 3.0).setSensor(true),
                  sensor
              )

              this.gravityWells.push({
                  sensor,
                  center: wellPos,
                  strength: wellStrength
              })
          })
      }

      // 4. The Solar Wind (Cross-Force)
      // Curve Radius 15, Angle 180, Incline 0.
      // Continuous Lateral Force (+5.0 X)
      const windRadius = 15
      const windAngle = Math.PI
      const windStart = currentPos.clone()
      const windStartHeading = heading

      currentPos = this.addCurvedRamp(currentPos, heading, windRadius, windAngle, 0, 8, 1.0, plasmaMat, 20, 0)

      // Add Solar Wind Sensors
      if (this.world) {
          const segments = 10
          const segAngle = windAngle / segments
          const chordLen = 2 * windRadius * Math.sin(segAngle/2)

          let curH = windStartHeading
          let curP = windStart.clone()

          for (let i = 0; i < segments; i++) {
               curH += segAngle / 2
               const forward = new Vector3(Math.sin(curH), 0, Math.cos(curH))
               const center = curP.add(forward.scale(chordLen / 2))
               center.y += 0.5

               const sensor = this.world.createRigidBody(
                   this.rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z)
               )
               const q = Quaternion.FromEulerAngles(0, curH, 0)
               sensor.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

               this.world.createCollider(
                   this.rapier.ColliderDesc.cuboid(4, 1, chordLen/2).setSensor(true),
                   sensor
               )

               // Force: Lateral (+5.0 X Global?).
               // Plan: "Continuous Lateral Force (+5.0 X) pushing the ball towards the outer edge."
               // If we are turning Right (implied by addCurvedRamp default direction?), outer edge is Left?
               // addCurvedRamp logic:
               // forward = (sin(H), 0, cos(H))
               // If H starts at 0 (North), turns to PI (South).
               // It turns RIGHT if currentHeading += positive.
               // So outer edge is LEFT (-X local).
               // +5.0 X Global is Right.
               // Let's use Global +5.0 X.

               const windForce = new Vector3(50.0, 0, 0) // Scaled

               this.conveyorZones.push({
                   sensor,
                   force: windForce
               })

               curP = curP.add(forward.scale(chordLen))
               curH += segAngle / 2
          }
      }
      heading += windAngle

      // 5. Fusion Core (Goal)
      // Bucket in Dyson Ring structure
      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const goalPos = currentPos.add(forward.scale(4))

      this.createBasin(goalPos, coreMat)

      // Visual: Dyson Ring
      const ring = MeshBuilder.CreateTorus("dysonRing", { diameter: 8, thickness: 1.0, tessellation: 32 }, this.scene)
      ring.position.copyFrom(goalPos)
      ring.position.y += 2
      ring.rotation.x = Math.PI / 2
      ring.material = coreMat
      this.adventureTrack.push(ring)
  }

  // --- Track: The Tesla Tower ---
  protected createTeslaTowerTrack(): void {
      const coilMat = this.getTrackMaterial("#CD7F32") // Copper
      const lightningMat = this.getTrackMaterial("#00DDFF") // Electric Blue

      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. The Induction Coil (Entry)
      // Curved Ramp (Spiral Down). Radius 10, Angle 360, Incline 15.
      // Mag-Rail: Tangential Force +20.0.
      const coilRadius = 10
      const coilAngle = 2 * Math.PI
      const coilIncline = (15 * Math.PI) / 180

      const coilStart = currentPos.clone()
      const coilStartHeading = heading

      currentPos = this.addCurvedRamp(currentPos, heading, coilRadius, coilAngle, coilIncline, 8, 2.0, coilMat, 30)

      // Mag-Rail Sensors
      if (this.world) {
          const segments = 20
          const segAngle = coilAngle / segments
          const chordLen = 2 * coilRadius * Math.sin(segAngle/2)
          const drop = chordLen * Math.sin(coilIncline) // Approx segment drop

          let curH = coilStartHeading
          let curP = coilStart.clone()

          for (let i = 0; i < segments; i++) {
               curH += segAngle / 2
               const forward = new Vector3(Math.sin(curH), 0, Math.cos(curH))
               const center = curP.add(forward.scale(chordLen / 2))
               center.y -= drop / 2
               center.y += 0.5 // Above floor

               const sensor = this.world.createRigidBody(
                   this.rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z)
               )
               const q = Quaternion.FromEulerAngles(coilIncline, curH, 0)
               sensor.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

               this.world.createCollider(
                   this.rapier.ColliderDesc.cuboid(4, 1, chordLen/2).setSensor(true),
                   sensor
               )

               // Tangential Force: Forward vector
               // Force +20.0 Tangential.
               // Since ramp is forward, tangential is forward.
               const forceVec = new Vector3(Math.sin(curH), -Math.sin(coilIncline), Math.cos(curH)).normalize().scale(200.0) // 20.0 * 10

               this.conveyorZones.push({
                   sensor,
                   force: forceVec
               })

               curP = curP.add(forward.scale(chordLen))
               curP.y -= drop
               curH += segAngle / 2
          }
      }
      heading += coilAngle

      // 2. The Spark Gap (Jump)
      // Gap Length 8. Drop 2.
      const gapLen = 8
      const gapDrop = 2

      const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const gapStart = currentPos.clone()

      // Visual Arc
      const arcPoints = [
          gapStart,
          gapStart.add(gapForward.scale(gapLen)).subtract(new Vector3(0, gapDrop, 0))
      ]
      // Just draw a tube or something?
      const arc = MeshBuilder.CreateTube("sparkArc", { path: arcPoints, radius: 0.2 }, this.scene)
      arc.material = lightningMat
      this.adventureTrack.push(arc)

      // Move Pos
      currentPos = currentPos.add(gapForward.scale(gapLen))
      currentPos.y -= gapDrop

      // 3. The Step-Down Transformer (Chicane)
      // Zig-Zag x 3. Width 4. No Walls.
      // Arc Pylons at corners.
      const zigLen = 6
      const zigWidth = 4

      currentPos = this.addStraightRamp(currentPos, heading, zigWidth, zigLen, 0, coilMat)

      // Pylon 1 (Turn Left)
      this.createArcPylon(currentPos, lightningMat)
      heading -= Math.PI / 2

      currentPos = this.addStraightRamp(currentPos, heading, zigWidth, zigLen, 0, coilMat)

      // Pylon 2 (Turn Right)
      this.createArcPylon(currentPos, lightningMat)
      heading += Math.PI / 2

      currentPos = this.addStraightRamp(currentPos, heading, zigWidth, zigLen, 0, coilMat)

      // 4. The Faraday Cage (Arena)
      // Flat 12x12.
      const cageSize = 12
      const cageStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, cageSize, cageSize, 0, coilMat)

      // Ball Lightning
      // 3 Kinematic Spheres moving randomly?
      // "Kinematic Spheres moving randomly".
      // Let's create bouncy spheres that move.
      if (this.world) {
          const sphereRadius = 1.0
          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

          for (let i = 0; i < 3; i++) {
               const offsetZ = 2 + Math.random() * (cageSize - 4)
               const offsetX = (Math.random() - 0.5) * (cageSize - 4)

               const pos = cageStart.add(forward.scale(offsetZ)).add(right.scale(offsetX))
               pos.y += 2.0

               const sphere = MeshBuilder.CreateSphere("ballLightning", { diameter: sphereRadius * 2 }, this.scene)
               sphere.position.copyFrom(pos)
               sphere.material = lightningMat
               this.adventureTrack.push(sphere)

               const body = this.world.createRigidBody(
                   this.rapier.RigidBodyDesc.kinematicVelocityBased()
                       .setTranslation(pos.x, pos.y, pos.z)
               )
               this.world.createCollider(
                   this.rapier.ColliderDesc.ball(sphereRadius).setRestitution(1.2),
                   body
               )
               this.adventureBodies.push(body)
               this.kinematicBindings.push({ body, mesh: sphere })

               this.animatedObstacles.push({
                   body,
                   mesh: sphere,
                   type: 'OSCILLATOR',
                   basePos: pos,
                   frequency: 0.5 + Math.random(),
                   amplitude: 3.0,
                   axis: right, // Move left-right
                   phase: Math.random() * Math.PI
               })
          }
      }

      // 5. Grounding Rod (Goal)
      const goalForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const goalPos = currentPos.add(goalForward.scale(4))

      this.createBasin(goalPos, coilMat)
  }

  // --- Track: The Neon Skyline ---
  protected createNeonSkylineTrack(): void {
      const skylineMat = this.getTrackMaterial("#111122") // Dark Blue
      const windMat = this.getTrackMaterial("#AAFFFF") // White/Cyan

      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. The Rooftop Run (Entry)
      // Length 15, Incline -10 deg, Width 6
      const entryLen = 15
      const entryIncline = (10 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 6, entryLen, entryIncline, skylineMat)

      // 2. The Vent Jump (Mechanic)
      // Gap Length 5. Target Elev +5.
      const gapLen = 5
      const jumpHeight = 5.0

      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const gapStart = currentPos.clone()

      // Updraft Fan Sensor
      if (this.world) {
          const center = gapStart.add(forward.scale(gapLen / 2))
          // Center Y is below gap usually? Or in the gap.
          // Let's place it slightly below where the ball launches.
          center.y -= 2.0

          // Visual Fan
          const fan = MeshBuilder.CreateCylinder("ventFan", { diameter: 4, height: 0.5 }, this.scene)
          fan.position.copyFrom(center)
          fan.material = windMat
          this.adventureTrack.push(fan)

          const sensor = this.world.createRigidBody(
              this.rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y + 1.0, center.z)
          )
          this.world.createCollider(
              this.rapier.ColliderDesc.cylinder(3.0, 2.5).setSensor(true),
              sensor
          )

          // Force: +25.0 Y. Scaled by 10 like others?
          // Gravity Forge: +5.0 -> 25.0 impulse? No, I used 50.0 there.
          // Tidal Nexus: +8.0 -> 60.0.
          // Neon Skyline: +25.0.
          // Let's try 250.0. This is a HUGE jump (+5 elevation).
          this.conveyorZones.push({
              sensor,
              force: new Vector3(0, 250.0, 0)
          })
      }

      // Move Pos
      currentPos = currentPos.add(forward.scale(gapLen))
      currentPos.y += jumpHeight

      // 3. The Skyscraper (Platform)
      // Flat, Length 15, Width 10.
      const skyLen = 15
      const skyWidth = 10
      const skyStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, skyWidth, skyLen, 0, skylineMat)

      // AC Units (Maze)
      if (this.world) {
          const unitCount = 6
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

          for (let i = 0; i < unitCount; i++) {
               const dist = 2 + Math.random() * (skyLen - 4)
               const offset = (Math.random() - 0.5) * (skyWidth - 2)

               const pos = skyStart.add(forward.scale(dist)).add(right.scale(offset))
               pos.y += 1.0

               const ac = MeshBuilder.CreateBox("acUnit", { size: 2 }, this.scene)
               ac.position.copyFrom(pos)
               ac.material = skylineMat
               this.adventureTrack.push(ac)

               const body = this.world.createRigidBody(
                   this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
               )
               this.world.createCollider(
                   this.rapier.ColliderDesc.cuboid(1, 1, 1),
                   body
               )
               this.adventureBodies.push(body)
          }
      }

      // 4. The Billboard (Wall Ride)
      // Curved Ramp. Radius 12, Angle 90, Incline 0, Banking -45.
      const boardRadius = 12
      const boardAngle = Math.PI / 2
      const boardBank = -(45 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, boardRadius, boardAngle, 0, 8, 2.0, windMat, 20, boardBank)
      heading += boardAngle

      // 5. The Penthouse Landing (Goal)
      const goalForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const goalPos = currentPos.add(goalForward.scale(4))

      this.createBasin(goalPos, skylineMat)
  }

  protected createArcPylon(pos: Vector3, mat: StandardMaterial): void {
      if (!this.world) return

      // Visual
      const pylon = MeshBuilder.CreateCylinder("pylon", { diameter: 1.0, height: 3.0 }, this.scene)
      pylon.position.copyFrom(pos)
      pylon.position.y += 1.5
      pylon.material = mat
      this.adventureTrack.push(pylon)

      // Physics (Static)
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

  // --- Track: The Polychrome Void ---
  protected createPolychromeVoidTrack(): void {
      const whiteMat = this.getTrackMaterial("#FFFFFF")
      const redMat = this.getTrackMaterial("#FF0000")
      const greenMat = this.getTrackMaterial("#00FF00")
      const blueMat = this.getTrackMaterial("#0000FF")

      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. Monochrome Injection (Entry)
      // White. Group Universal.
      const entryLen = 10
      const entryIncline = (15 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 6, entryLen, entryIncline, whiteMat, 0, 0.5)

      // 2. The Red Shift (Gate)
      const gatePos = currentPos.clone()
      gatePos.y += 1.0
      this.createChromaGate(gatePos, 'RED')

      // 3. Crimson Walkway (Filter)
      const crimLen = 15
      const crimWidth = 4
      const crimStart = currentPos.clone()

      // Create Red Floor manually to set Group
      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const crimCenter = crimStart.add(forward.scale(crimLen / 2))
      // Flat (Incline 0)
      const floor = MeshBuilder.CreateBox("crimsonFloor", { width: crimWidth, height: 0.5, depth: crimLen }, this.scene)
      floor.position.copyFrom(crimCenter)
      floor.rotation.y = heading
      floor.material = redMat
      this.adventureTrack.push(floor)

      if (this.world) {
          const body = this.world.createRigidBody(
              this.rapier.RigidBodyDesc.fixed().setTranslation(crimCenter.x, crimCenter.y, crimCenter.z)
          )
          const q = Quaternion.FromEulerAngles(0, heading, 0)
          body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

          const collider = this.rapier.ColliderDesc.cuboid(crimWidth/2, 0.25, crimLen/2)
          // Set Group: Red
          // Interaction Groups: (Member << 16) | Filter
          const groups = (GROUP_RED << 16) | MASK_ALL
          collider.setCollisionGroups(groups)

          this.world.createCollider(collider, body)
          this.adventureBodies.push(body)
      }

      // Add Blue Ghosts (Obstacles)
      if (this.world) {
          const ghostCount = 5
          for (let i=0; i<ghostCount; i++) {
              const dist = 3 + i * 2.5
              const offset = (Math.random() - 0.5) * (crimWidth - 1)
              const pos = crimStart.add(forward.scale(dist))
              const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))
              const ghostPos = pos.add(right.scale(offset))
              ghostPos.y += 0.5

              const ghost = MeshBuilder.CreateBox("blueGhost", { size: 1.0 }, this.scene)
              ghost.position.copyFrom(ghostPos)
              ghost.material = blueMat
              this.adventureTrack.push(ghost)

              const body = this.world.createRigidBody(
                  this.rapier.RigidBodyDesc.fixed().setTranslation(ghostPos.x, ghostPos.y, ghostPos.z)
              )
              const collider = this.rapier.ColliderDesc.cuboid(0.5, 0.5, 0.5)
              // Group: Blue
              const groups = (GROUP_BLUE << 16) | MASK_ALL
              collider.setCollisionGroups(groups)

              this.world.createCollider(collider, body)
              this.adventureBodies.push(body)
          }
      }

      currentPos = crimStart.add(forward.scale(crimLen))

      // 4. The Green Filter (Gate)
      const jumpGap = 4
      currentPos = currentPos.add(forward.scale(jumpGap))
      // Gate in air
      const greenGatePos = currentPos.clone()
      greenGatePos.y += 2.0 // High
      this.createChromaGate(greenGatePos, 'GREEN')

      // 5. Emerald Isles (Platforming)
      const isleCount = 5
      const isleSpacing = 3
      const isleSize = 2

      for (let i=0; i<isleCount; i++) {
          currentPos = currentPos.add(forward.scale(isleSpacing))

          const offset = 1.5
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

          // Randomize left/right
          const greenLeft = Math.random() > 0.5

          const p1Pos = currentPos.add(right.scale(-offset))
          const p2Pos = currentPos.add(right.scale(offset))

          const createIsle = (pos: Vector3, color: 'GREEN' | 'RED') => {
              const mat = color === 'GREEN' ? greenMat : redMat
              const grp = color === 'GREEN' ? GROUP_GREEN : GROUP_RED

              const box = MeshBuilder.CreateBox("isle", { width: isleSize, height: 0.5, depth: isleSize }, this.scene)
              box.position.copyFrom(pos)
              box.material = mat
              this.adventureTrack.push(box)

              if (this.world) {
                  const body = this.world.createRigidBody(
                      this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
                  )
                  const col = this.rapier.ColliderDesc.cuboid(isleSize/2, 0.25, isleSize/2)
                  col.setCollisionGroups((grp << 16) | MASK_ALL)
                  this.world.createCollider(col, body)
                  this.adventureBodies.push(body)
              }
          }

          createIsle(p1Pos, greenLeft ? 'GREEN' : 'RED')
          createIsle(p2Pos, greenLeft ? 'RED' : 'GREEN')
      }

      // 6. The Blue Shift (Gate)
      currentPos = currentPos.add(forward.scale(isleSpacing))
      this.createChromaGate(currentPos, 'BLUE')

      // 7. Sapphire Spiral (Ascent)
      const spiralRadius = 10
      const spiralAngle = 2 * Math.PI
      const spiralIncline = -(10 * Math.PI) / 180 // Up

      // const spiralStart = currentPos.clone()
      currentPos = this.addCurvedRamp(currentPos, heading, spiralRadius, spiralAngle, spiralIncline, 6, 1.0, blueMat, 20)

      // if (this.world) {
      //     // Add Red Ghosts along the spiral (Approximate)
      // }
      heading += spiralAngle

      // 8. Whiteout (Goal)
      const goalForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const goalPos = currentPos.add(goalForward.scale(4))

      this.createBasin(goalPos, whiteMat)
  }

  protected createChromaGate(pos: Vector3, color: 'RED' | 'GREEN' | 'BLUE'): void {
      if (!this.world) return

      // Visual
      const gateMat = this.getTrackMaterial(color === 'RED' ? "#FF0000" : color === 'GREEN' ? "#00FF00" : "#0000FF")
      const gate = MeshBuilder.CreateTorus("gate", { diameter: 4, thickness: 0.2 }, this.scene)
      gate.position.copyFrom(pos)
      gate.rotation.x = Math.PI / 2
      gate.material = gateMat
      this.adventureTrack.push(gate)

      // Sensor
      const sensor = this.world.createRigidBody(
          this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
      )
      this.world.createCollider(
          this.rapier.ColliderDesc.cylinder(0.5, 2.0).setSensor(true),
          sensor
      )

      this.chromaGates.push({ sensor, colorType: color })
  }

  protected setBallColorState(ball: RAPIER.RigidBody, color: 'RED' | 'GREEN' | 'BLUE'): void {
      const collider = ball.collider(0)
      if (!collider) return

      let groups = 0
      let matColor = Color3.White()

      switch (color) {
          case 'RED':
              groups = (GROUP_UNIVERSAL << 16) | MASK_RED // Member: Universal (so others see me), Filter: MASK_RED
              // Wait, earlier I said Ball Filter decides what IT sees.
              // "MASK_RED" = "UNIVERSAL | RED".
              // So if Ball Filter = MASK_RED, it sees Universal and Red objects.
              // Ball Membership: If I set it to Universal, then Red Objects (Filter: ALL) will see Ball.
              // Blue Objects (Filter: ALL) will see Ball.
              // But Ball Filter (MASK_RED) will NOT see Blue Objects (Group Blue).
              // So collision logic: Pair exists if (FilterA & MemberB) && (FilterB & MemberA).
              // Ball Filter (Red|Univ) & Blue Object Member (Blue) = 0.
              // So they don't collide. Correct.
              matColor = Color3.Red()
              break
          case 'GREEN':
              groups = (GROUP_UNIVERSAL << 16) | MASK_GREEN
              matColor = Color3.Green()
              break
          case 'BLUE':
              groups = (GROUP_UNIVERSAL << 16) | MASK_BLUE
              matColor = Color3.Blue()
              break
      }

      collider.setCollisionGroups(groups)

      if (this.currentBallMesh) {
          const mat = this.currentBallMesh.material as StandardMaterial
          if (mat) {
              mat.emissiveColor = matColor
              mat.diffuseColor = matColor
          }
      }
  }
}

