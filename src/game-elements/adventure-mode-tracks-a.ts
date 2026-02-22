import {
  MeshBuilder,
  Vector3,
  Quaternion,
  Mesh,
  VertexBuffer,
} from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { AdventureModeBuilder } from './adventure-mode-builder'

export abstract class AdventureModeTracksA extends AdventureModeBuilder {
  // --- Track: The Hyper-Drift ---
  protected createHyperDriftTrack(): void {
      const driftMat = this.getTrackMaterial("#00FFFF")
      let currentPos = this.currentStartPos.clone()
      let heading = 0

      const launchLen = 15
      const launchIncline = (20 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 8, launchLen, launchIncline, driftMat)

      const alphaRadius = 15
      const alphaAngle = -Math.PI / 2
      const alphaIncline = (5 * Math.PI) / 180
      const alphaBank = (30 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, alphaRadius, alphaAngle, alphaIncline, 8, 2.0, driftMat, 20, alphaBank)
      heading += alphaAngle

      const betaRadius = 15
      const betaAngle = Math.PI / 2
      const betaIncline = (5 * Math.PI) / 180
      const betaBank = -(30 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, betaRadius, betaAngle, betaIncline, 8, 2.0, driftMat, 20, betaBank)
      heading += betaAngle

      const corkRadius = 10
      const corkAngle = 2 * Math.PI
      const corkIncline = (10 * Math.PI) / 180
      const corkBank = -(45 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, corkRadius, corkAngle, corkIncline, 8, 2.0, driftMat, 30, corkBank)
      heading += corkAngle

      const jumpLen = 10
      const jumpIncline = -(30 * Math.PI) / 180

      currentPos = this.addStraightRamp(currentPos, heading, 6, jumpLen, jumpIncline, driftMat)

      const jumpForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const goalDist = 15
      const goalHeight = 8

      const goalPos = currentPos.add(jumpForward.scale(goalDist))
      goalPos.y += goalHeight

      this.createBasin(goalPos, driftMat)
  }

  // --- Track: The Pachinko Spire ---
  protected createPachinkoSpireTrack(): void {
    const spireMat = this.getTrackMaterial("#FFFFFF") // Silver/Chrome
    let currentPos = this.currentStartPos.clone()
    const heading = 0 // North

    // 1. The Drop Gate
    // 5 units, -45 degrees (Steep Down)
    const dropLen = 5
    const dropIncline = (45 * Math.PI) / 180
    currentPos = this.addStraightRamp(currentPos, heading, 6, dropLen, dropIncline, spireMat)

    // 2. The Pin Field (Main Body)
    // 30 units, -75 degrees (Very Steep)
    // Width 12
    const mainLen = 30
    const mainIncline = (75 * Math.PI) / 180
    const mainWidth = 12

    // Capture start of main segment for pin placement
    const mainStartPos = currentPos.clone()

    currentPos = this.addStraightRamp(currentPos, heading, mainWidth, mainLen, mainIncline, spireMat)

    // Helper to calculate position on the ramp surface
    // Forward Vector along the ramp
    const forwardVec = new Vector3(0, -Math.sin(mainIncline), Math.cos(mainIncline))
    // Right Vector
    const rightVec = new Vector3(1, 0, 0)

    // Normal Vector (for pin rotation axis)
    // Ramp Surface Normal = (0, cos(75), sin(75))
    const normalVec = new Vector3(0, Math.cos(mainIncline), Math.sin(mainIncline))

    // Pin Grid Generation
    const pinSpacing = 2.0
    const rows = Math.floor(mainLen / pinSpacing) - 1

    // Need to handle physics manually for pins
    if (this.world) {
        for (let r = 1; r <= rows; r++) {
            const dist = r * pinSpacing
            // Staggered offsets
            const isEven = r % 2 === 0
            const xOffsets = isEven ? [-4, -2, 0, 2, 4] : [-3, -1, 1, 3]

            for (const xOff of xOffsets) {
                // Position on ramp
                const pinPos = mainStartPos.add(forwardVec.scale(dist)).add(rightVec.scale(xOff))
                // Raise slightly so it sits on surface (surface is at pinPos roughly, but box has height 0.5)
                // Box center is at -0.25 (half height) relative to surface? No, addStraightRamp centers box.
                // We should push out by Normal * 0.25 (ramp half height) + Pin Half Height.
                // Pin Height = 0.5?

                const pinHeight = 0.5
                const surfaceOffset = normalVec.scale(0.25 + pinHeight/2)
                const finalPos = pinPos.add(surfaceOffset)

                const pin = MeshBuilder.CreateCylinder("pin", { diameter: 0.3, height: pinHeight }, this.scene)
                pin.position.copyFrom(finalPos)
                // Align rotation with Ramp Normal (Y-up cylinder needs to point along Normal)
                // Default Cylinder is Y-up. We want Y to be Normal.
                // Normal is (0, cos, sin).
                // Rotation Axis: Cross(Y, Normal). Angle: acos(Dot(Y, Normal)).
                // Normal is roughly Z-ish/Y-ish.
                // Or simpler: Rotate X by Incline?
                // Flat Ramp (0 deg): Normal (0,1,0). Cylinder Y (0,1,0). Rot X = 0.
                // Ramp 90 deg: Normal (0,0,1). Cylinder Y needs to be (0,0,1). Rot X = 90.
                // Ramp 75 deg: Rot X = 75.
                pin.rotation.x = mainIncline
                pin.material = spireMat
                this.adventureTrack.push(pin)

                // Physics
                const q = Quaternion.FromEulerAngles(pin.rotation.x, pin.rotation.y, pin.rotation.z)
                const body = this.world.createRigidBody(
                    this.rapier.RigidBodyDesc.fixed()
                        .setTranslation(finalPos.x, finalPos.y, finalPos.z)
                        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
                )
                this.world.createCollider(
                    this.rapier.ColliderDesc.cylinder(pinHeight/2, 0.15).setRestitution(0.6),
                    body
                )
                this.adventureBodies.push(body)
            }
        }
    }

    // 3. The Mills (Rotating Platforms)
    // Distance ~15 units down (Halfway)
    const millDist = 15
    const millRadius = 3
    const millOffset = 3.5 // X offset

    const createMill = (xDir: number, speedDir: number) => {
         const posOnRamp = mainStartPos.add(forwardVec.scale(millDist)).add(rightVec.scale(xDir * millOffset))
         // Flush with surface
         const millPos = posOnRamp.add(normalVec.scale(0.1)) // Slightly embedded/flush

         // Visual
         const mill = MeshBuilder.CreateCylinder("mill", { diameter: millRadius*2, height: 0.2 }, this.scene)
         mill.position.copyFrom(millPos)
         mill.rotation.x = mainIncline
         mill.material = spireMat
         this.adventureTrack.push(mill)

         // Physics
         if (this.world) {
             const bodyDesc = this.rapier.RigidBodyDesc.kinematicVelocityBased()
                 .setTranslation(millPos.x, millPos.y, millPos.z)

             // Initial Rotation
             const q = Quaternion.FromEulerAngles(mainIncline, 0, 0)
             bodyDesc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })

             const body = this.world.createRigidBody(bodyDesc)

             // Angular Velocity: Must be along the local Y axis (Normal)
             // Global AngVel vector
             const angSpeed = 2.0 * speedDir
             const angVel = normalVec.scale(angSpeed)
             body.setAngvel({ x: angVel.x, y: angVel.y, z: angVel.z }, true)

             this.world.createCollider(
                 this.rapier.ColliderDesc.cylinder(0.1, millRadius).setFriction(1.0),
                 body
             )
             this.adventureBodies.push(body)
             this.kinematicBindings.push({ body, mesh: mill })
         }
    }

    createMill(-1, 1) // Left, CW (relative to normal?)
    createMill(1, -1) // Right, CCW

    // 4. Catch Basins
    // At the bottom of the 30 unit ramp.
    const bottomPos = mainStartPos.add(forwardVec.scale(mainLen))
    // Drop down to create a landing zone? Or just place them there.

    const basinY = bottomPos.y - 2
    const basinZ = bottomPos.z

    // Center Goal
    this.createBasin(new Vector3(0, basinY, basinZ), spireMat)

    // Side Resets (Left and Right)
    // Make them look like basins but function as teleporters
    const createResetBasin = (x: number) => {
        const pos = new Vector3(x, basinY, basinZ)

        // 1. Visual & Physical Floor (So ball doesn't ghost through)
        // Use logic similar to createBasin: Solid floor + Walls
        const basin = MeshBuilder.CreateBox("resetBasin", { width: 4, height: 1, depth: 4 }, this.scene)
        basin.position.copyFrom(pos)
        basin.material = spireMat
        this.adventureTrack.push(basin)

        if (this.world) {
            // Solid Floor Body
            const body = this.world.createRigidBody(
                this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
            )
            // Collider must match visual box (Width 4, Height 1, Depth 4)
            this.world.createCollider(
                this.rapier.ColliderDesc.cuboid(2, 0.5, 2),
                body
            )
            this.adventureBodies.push(body)

            // 2. Sensor (Trigger) - Placed just above the floor
            // So when ball lands ON the solid floor, it triggers the sensor.
            const sensorPos = pos.clone()
            sensorPos.y += 0.75 // Just above surface

            const sensorBody = this.world.createRigidBody(
                this.rapier.RigidBodyDesc.fixed().setTranslation(sensorPos.x, sensorPos.y, sensorPos.z)
            )
            this.world.createCollider(
                this.rapier.ColliderDesc.cuboid(1.8, 0.25, 1.8).setSensor(true),
                sensorBody
            )
            this.resetSensors.push(sensorBody)
        }
    }

    createResetBasin(-6)
    createResetBasin(6)
  }

  // --- Track: The Orbital Junkyard ---
  protected createOrbitalJunkyardTrack(): void {
      const junkMat = this.getTrackMaterial("#888888") // Grey/Rusty
      let currentPos = this.currentStartPos.clone()
      const heading = 0

      // 1. Launch Tube
      // Length 8, Incline -10 deg, Width 4
      const launchLen = 8
      const launchIncline = (10 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 4, launchLen, launchIncline, junkMat)

      // 2. The Debris Field
      // Length 25, Incline -5 deg, Width 10
      const debrisLen = 25
      const debrisIncline = (5 * Math.PI) / 180
      const debrisWidth = 10

      // Capture start of debris field for object placement
      const debrisStartPos = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, debrisWidth, debrisLen, debrisIncline, junkMat)

      // 3. Debris Objects (Space Junk)
      if (this.world) {
          const debrisCount = 25
          const forwardVec = new Vector3(0, -Math.sin(debrisIncline), Math.cos(debrisIncline))
          const rightVec = new Vector3(1, 0, 0)
          const normalVec = new Vector3(0, Math.cos(debrisIncline), Math.sin(debrisIncline))

          for (let i = 0; i < debrisCount; i++) {
              // Random position along the ramp
              // Keep it somewhat centered but messy.
              // Avoid the very start and very end to prevent blocking entry/exit totally.
              const dist = 2 + Math.random() * (debrisLen - 6)
              const offset = (Math.random() - 0.5) * (debrisWidth - 2) // Keep inside walls

              const debrisPosOnSurface = debrisStartPos.add(forwardVec.scale(dist)).add(rightVec.scale(offset))

              // Random Type: Box or Tetrahedron (Polyhedron)
              const type = Math.random() > 0.5 ? 'box' : 'tetra'
              const scale = 0.5 + Math.random() * 1.0 // 0.5 to 1.5

              let mesh: Mesh
              let colliderDesc: RAPIER.ColliderDesc

              // Raise slightly above surface based on scale
              const finalPos = debrisPosOnSurface.add(normalVec.scale(scale * 0.5))

              if (type === 'box') {
                  mesh = MeshBuilder.CreateBox("junkBox", { size: scale }, this.scene)
                  colliderDesc = this.rapier.ColliderDesc.cuboid(scale / 2, scale / 2, scale / 2)
              } else {
                  mesh = MeshBuilder.CreatePolyhedron("junkTetra", { type: 0, size: scale * 0.6 }, this.scene)
                  // Approx collider for tetra - use a ball or small cuboid for simplicity or convex hull if expensive
                  // Using Cuboid for performance stability
                  colliderDesc = this.rapier.ColliderDesc.cuboid(scale / 3, scale / 3, scale / 3)
              }

              mesh.position.copyFrom(finalPos)
              // Random Rotation
              mesh.rotation.x = Math.random() * Math.PI
              mesh.rotation.y = Math.random() * Math.PI
              mesh.rotation.z = Math.random() * Math.PI
              mesh.material = junkMat
              this.adventureTrack.push(mesh)

              const q = Quaternion.FromEulerAngles(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z)
              const body = this.world.createRigidBody(
                  this.rapier.RigidBodyDesc.fixed()
                      .setTranslation(finalPos.x, finalPos.y, finalPos.z)
                      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
              )
              this.world.createCollider(colliderDesc, body)
              this.adventureBodies.push(body)
          }
      }

      // 4. The Crusher (Choke Point)
      // Two large blocks creating a narrow gap
      // Located near the end of the debris field or just after?
      // "The Crusher (Hazard): ... Two large static blocks creating a narrow 2-unit wide gap"
      // Let's place it at the end of the debris ramp segment, effectively acting as the gate to the goal.

      // We need to add these blocks MANUALLY because addStraightRamp doesn't support custom obstacles inside it easily.
      // We can place them relative to 'currentPos' (which is the end of the debris ramp).
      // Or place them ON the debris ramp near the end.

      // Let's place them just before currentPos.
      const crusherDistFromEnd = 2
      const forwardVec = new Vector3(0, -Math.sin(debrisIncline), Math.cos(debrisIncline))
      const rightVec = new Vector3(1, 0, 0)
      const normalVec = new Vector3(0, Math.cos(debrisIncline), Math.sin(debrisIncline))

      const crusherCenterPos = debrisStartPos.add(forwardVec.scale(debrisLen - crusherDistFromEnd))
      const gapWidth = 2
      const blockWidth = (debrisWidth - gapWidth) / 2 // (10 - 2) / 2 = 4
      const blockHeight = 2
      const blockDepth = 2

      const createCrusherBlock = (direction: number) => { // -1 Left, 1 Right
          const offset = direction * (gapWidth/2 + blockWidth/2) // 1 + 2 = 3
          const pos = crusherCenterPos.add(rightVec.scale(offset)).add(normalVec.scale(blockHeight/2))

          const box = MeshBuilder.CreateBox("crusherBlock", { width: blockWidth, height: blockHeight, depth: blockDepth }, this.scene)
          box.position.copyFrom(pos)
          box.rotation.x = debrisIncline
          box.material = junkMat
          this.adventureTrack.push(box)

          if (this.world) {
               const q = Quaternion.FromEulerAngles(box.rotation.x, box.rotation.y, box.rotation.z)
               const body = this.world.createRigidBody(
                   this.rapier.RigidBodyDesc.fixed()
                       .setTranslation(pos.x, pos.y, pos.z)
                       .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
               )
               this.world.createCollider(
                   this.rapier.ColliderDesc.cuboid(blockWidth/2, blockHeight/2, blockDepth/2),
                   body
               )
               this.adventureBodies.push(body)
          }
      }

      createCrusherBlock(-1)
      createCrusherBlock(1)

      // 5. Escape Pod (Goal)
      // Just after the debris ramp ends.
      // currentPos is the end of the debris ramp.
      // Drop slightly into a basin.

      const goalPos = currentPos.clone()
      goalPos.y -= 2 // Drop down
      goalPos.z += 2 // Move forward slightly

      this.createBasin(goalPos, junkMat)
  }

  // --- Track: The Firewall Breach ---
  protected createFirewallBreachTrack(): void {
      const wallMat = this.getTrackMaterial("#FF4400") // Orange/Red
      const debrisMat = this.getTrackMaterial("#0088FF") // Cyan/Blue
      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. Packet Stream (Launch)
      // Length 20, Incline -25 deg (Steep Drop)
      const launchLen = 20
      const launchIncline = (25 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 6, launchLen, launchIncline, wallMat)

      // 2. Security Layer 1 (Debris Field)
      // Flat, Length 15, Width 8
      const debrisLen = 15
      const debrisWidth = 8

      const debrisStartPos = currentPos.clone()
      currentPos = this.addStraightRamp(currentPos, heading, debrisWidth, debrisLen, 0, wallMat)

      // Add Data Blocks (Dynamic Debris)
      // 4x5 grid of small dynamic boxes
      if (this.world) {
          const rows = 5
          const cols = 4
          const spacing = 1.5
          const startX = -(cols - 1) * spacing / 2
          const startZ = 2.0 // Offset from start of ramp

          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

          for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols; c++) {
                  const xOffset = startX + c * spacing
                  const zOffset = startZ + r * spacing

                  const blockPos = debrisStartPos
                      .add(forward.scale(zOffset))
                      .add(right.scale(xOffset))

                  // Raise slightly
                  blockPos.y += 0.5

                  this.createDynamicBlock(blockPos, 1.0, 0.5, debrisMat) // Mass 0.5
              }
          }
      }

      // 3. The Chicane (Filter)
      // S-Bend: 90 Left, 90 Right
      const turnRadius = 10
      const turnAngle = Math.PI / 2

      // Turn Left
      currentPos = this.addCurvedRamp(currentPos, heading, turnRadius, turnAngle, 0, 8, 1.0, wallMat, 15, 0)
      heading -= turnAngle

      // Turn Right
      currentPos = this.addCurvedRamp(currentPos, heading, turnRadius, turnAngle, 0, 8, 1.0, wallMat, 15, 0)
      heading += turnAngle

      // 4. Security Layer 2 (The Heavy Wall)
      // Flat, Length 10
      const wallLen = 10
      const wallStartPos = currentPos.clone()
      currentPos = this.addStraightRamp(currentPos, heading, 8, wallLen, 0, wallMat)

      // Add Firewall Panels (Heavy Blocks)
      // 3 large blocks side-by-side
      if (this.world) {
          const blockCount = 3
          const blockSize = 2.5
          const spacing = 2.6
          const startX = -(blockCount - 1) * spacing / 2
          const zOffset = 5.0 // Middle of the ramp

          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

          for (let i = 0; i < blockCount; i++) {
              const xOffset = startX + i * spacing
              const blockPos = wallStartPos
                  .add(forward.scale(zOffset))
                  .add(right.scale(xOffset))

              blockPos.y += blockSize / 2

              this.createDynamicBlock(blockPos, blockSize, 5.0, wallMat) // Mass 5.0
          }
      }

      // 5. Root Access (Goal)
      const goalPos = currentPos.clone()
      goalPos.y -= 2
      goalPos.z += 2

      this.createBasin(goalPos, wallMat)
  }

  // --- Track: The Prism Pathway ---
  protected createPrismPathwayTrack(): void {
      const glassMat = this.getTrackMaterial("#E0FFFF") // Cyan
      const laserMat = this.getTrackMaterial("#FF00FF") // Magenta

      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. The Fiber Injection (Entry)
      // Length 15, Incline -20 deg, Width 4
      const entryLen = 15
      const entryIncline = (20 * Math.PI) / 180 // Down
      currentPos = this.addStraightRamp(currentPos, heading, 4, entryLen, entryIncline, glassMat)

      // 2. The Refractor Field (Obstacles)
      // Flat, Length 20, Width 10. Static Prisms.
      const fieldLen = 20
      const fieldWidth = 10
      const fieldStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, fieldWidth, fieldLen, 0, glassMat)

      if (this.world) {
          const prismCount = 5
          const prismHeight = 1.5
          const prismRadius = 0.5 // Diameter 1.0

          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

          for (let i = 0; i < prismCount; i++) {
               // Scatter logic
               const dist = 3 + Math.random() * (fieldLen - 6)
               const offset = (Math.random() - 0.5) * (fieldWidth - 2)

               const pos = fieldStart.add(forward.scale(dist)).add(right.scale(offset))
               pos.y += prismHeight / 2 // Sit on floor (floor y is roughly constant if flat)

               // Prism Mesh
               const prism = MeshBuilder.CreateCylinder("prism", { diameter: prismRadius * 2, height: prismHeight, tessellation: 3 }, this.scene)
               prism.position.copyFrom(pos)
               // Random Rotation
               prism.rotation.y = Math.random() * Math.PI * 2
               prism.material = glassMat // Or maybe separate prism material
               this.adventureTrack.push(prism)

               // Physics
               // Use Convex Hull for accurate triangular collision
               const positions = prism.getVerticesData(VertexBuffer.PositionKind)
               if (positions) {
                   const q = Quaternion.FromEulerAngles(0, prism.rotation.y, 0)
                   const body = this.world.createRigidBody(
                       this.rapier.RigidBodyDesc.fixed()
                           .setTranslation(pos.x, pos.y, pos.z)
                           .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
                   )

                   // Convex Hull expects a Float32Array of vertices
                   const vertices = new Float32Array(positions)
                   const hull = this.rapier.ColliderDesc.convexHull(vertices)

                   if (hull) {
                       hull.setRestitution(0.8) // High bounce
                       this.world.createCollider(hull, body)
                       this.adventureBodies.push(body)
                   }
               }
          }
      }

      // 3. The Laser Gauntlet (Hazard)
      // Flat, Length 25, Width 8. Sweeping Lasers.
      const gauntletLen = 25
      const gauntletWidth = 8
      const gauntletStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, gauntletWidth, gauntletLen, 0, glassMat)

      if (this.world) {
          const laserCount = 3
          const laserHeight = 2.0
          const laserRadius = 0.2 // Thin
          const spacing = gauntletLen / (laserCount + 1)

          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

          for (let i = 0; i < laserCount; i++) {
              const dist = spacing * (i + 1)
              const basePos = gauntletStart.add(forward.scale(dist))
              // Center Y
              basePos.y += laserHeight / 2

              // Visual
              const laser = MeshBuilder.CreateCylinder("laser", { diameter: laserRadius * 2, height: laserHeight }, this.scene)
              laser.position.copyFrom(basePos)
              laser.material = laserMat
              // Emissive glow? laserMat is already emissive magenta.
              this.adventureTrack.push(laser)

              // Physics
              // Kinematic Position Based
              const body = this.world.createRigidBody(
                   this.rapier.RigidBodyDesc.kinematicPositionBased()
                       .setTranslation(basePos.x, basePos.y, basePos.z)
              )
              this.world.createCollider(
                  this.rapier.ColliderDesc.cylinder(laserHeight/2, laserRadius),
                  body
              )
              this.adventureBodies.push(body)

              // Animation: Side-to-Side
              // Axis is 'right' vector.
              // Amplitude: Width is 8. Half width 4. Keep inside -> Amp 3.0?
              // Frequency: Vary slightly?
              const freq = 1.5 + i * 0.5
              const phase = i * 1.0

              this.animatedObstacles.push({
                  body,
                  mesh: laser,
                  type: 'OSCILLATOR',
                  basePos: basePos,
                  frequency: freq,
                  amplitude: 3.0,
                  phase: phase,
                  axis: right
              })
          }
      }

      // 4. The Spectrum Loop (Vertical)
      // Spiral Up. Radius 8, Angle 360, Incline 10 (Up), Banking 20.
      const loopRadius = 8
      const loopAngle = 2 * Math.PI
      const loopIncline = -(10 * Math.PI) / 180 // Negative for Up in my helper logic (vDrop negative)
      const loopBank = (20 * Math.PI) / 180 // Inward banking? Positive?
                                            // Helper: bankingAngle is rotation.z
                                            // Left turn (heading increases).
                                            // To bank inward (left), we need Z rotation...
                                            // Standard Babylon: +Z rotation rolls CCW around Z.
                                            // If heading is 0 (North), +Z roll tilts Left side Up? No.
                                            // Right Hand Rule on Z axis (pointing South?).
                                            // Let's assume helper handles local banking relative to heading.
                                            // Helper: box.rotation.z = bankingAngle.
                                            // If box is rotated Y by heading.
                                            // Local Z axis is... Forward? No, Box dimensions: Width=X, Height=Y, Depth=Z.
                                            // Wait, addCurvedRamp creates box width=width, height=0.5, depth=chordLen.
                                            // box.rotation.y = heading.
                                            // box.rotation.x = incline.
                                            // box.rotation.z = banking.
                                            // In Babylon, rotation order is usually YXZ or ZXY? Default is YXZ?
                                            // If YXZ: Rotate Y (Heading), then X (Pitch), then Z (Roll).
                                            // Pitch is local X. Roll is local Z.
                                            // Since Depth is Z, Roll around Z axis is "Barrel Roll".
                                            // That's what we want for banking.
                                            // Positive Z roll -> Left side Down, Right side Up? Or CCW.
                                            // Let's stick to positive 20.

      currentPos = this.addCurvedRamp(currentPos, heading, loopRadius, loopAngle, loopIncline, 8, 2.0, glassMat, 30, loopBank)
      heading += loopAngle

      // 5. The White Light (Goal)
      // Bucket at top.
      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const goalPos = currentPos.add(forward.scale(4))

      this.createBasin(goalPos, glassMat) // Cyan/White
      // Add a glowing sphere?
      const goalLight = MeshBuilder.CreateSphere("goalLight", { diameter: 2 }, this.scene)
      goalLight.position.copyFrom(goalPos)
      goalLight.position.y += 2
      const whiteMat = this.getTrackMaterial("#FFFFFF")
      goalLight.material = whiteMat
      this.adventureTrack.push(goalLight)
  }

  // --- Track: The Magnetic Storage ---
  protected createMagneticStorageTrack(): void {
      const storageMat = this.getTrackMaterial("#222222") // Dark Chrome
      const laserMat = this.getTrackMaterial("#FF0000") // Red

      let currentPos = this.currentStartPos.clone()
      const heading = 0

      // 1. The Write Head (Injection)
      // Length 12, Incline -25 deg, Width 6
      const entryLen = 12
      const entryIncline = (25 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 6, entryLen, entryIncline, storageMat)

      // 2. The Platter (Main Stage)
      // Radius 12, CCW 2.5 rad/s, Friction 0.1
      const platterRadius = 12
      const platterSpeed = 2.5 // CCW = Positive Y? usually.

      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const platterCenter = currentPos.add(forward.scale(platterRadius + 1))
      // Drop slightly onto it?
      platterCenter.y -= 1.0

      this.createRotatingPlatform(platterCenter, platterRadius, platterSpeed, storageMat)

      // 3. Bad Sectors (Obstacles)
      // 3 Cubes attached to platter.
      if (this.world && this.adventureBodies.length > 0) {
          const platterBody = this.adventureBodies[this.adventureBodies.length - 1]
          const binding = this.kinematicBindings.find(b => b.body === platterBody)

          const positions = [
              { r: 6, angle: 0 },
              { r: 9, angle: (120 * Math.PI) / 180 },
              { r: 4, angle: (240 * Math.PI) / 180 }
          ]

          positions.forEach(p => {
               // Visual
               const size = 2.0
               const box = MeshBuilder.CreateBox("badSector", { size }, this.scene)
               if (binding) {
                   box.parent = binding.mesh
                   const lx = Math.sin(p.angle) * p.r
                   const lz = Math.cos(p.angle) * p.r
                   box.position.set(lx, size/2 + 0.25, lz) // 0.25 is half platform thickness
                   box.rotation.y = p.angle
                   box.material = laserMat
               }

               // Collider
               const lx = Math.sin(p.angle) * p.r
               const lz = Math.cos(p.angle) * p.r
               const colRot = Quaternion.FromEulerAngles(0, p.angle, 0)

               this.world.createCollider(
                   this.rapier.ColliderDesc.cuboid(size/2, size/2, size/2)
                       .setTranslation(lx, size/2 + 0.25, lz)
                       .setRotation({ x: colRot.x, y: colRot.y, z: colRot.z, w: colRot.w }),
                   platterBody
               )
          })
      }

      // 4. The Actuator Arm (Hazard)
      // Pivot Outside. Length 10. Sweep 45 deg.
      const pivotDist = 16
      const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))
      // Place to the Left
      const pivotPos = platterCenter.add(right.scale(-pivotDist))
      pivotPos.y += 2.0 // Hover above

      const armLength = 10
      const armWidth = 1.0
      const armHeight = 1.0

      if (this.world) {
          const pivotMesh = MeshBuilder.CreateSphere("actuatorPivot", { diameter: 2 }, this.scene)
          pivotMesh.position.copyFrom(pivotPos)
          pivotMesh.material = storageMat
          this.adventureTrack.push(pivotMesh)

          const armBox = MeshBuilder.CreateBox("actuatorArm", { width: armLength, height: armHeight, depth: armWidth }, this.scene)
          armBox.parent = pivotMesh
          // Arm extends towards center (Right).
          armBox.position.set(armLength/2, 0, 0)
          armBox.material = storageMat

          // Physics Body at Pivot
          const bodyDesc = this.rapier.RigidBodyDesc.kinematicPositionBased()
               .setTranslation(pivotPos.x, pivotPos.y, pivotPos.z)
          const body = this.world.createRigidBody(bodyDesc)

          // Collider relative to Body (Pivot)
          // Center at (Length/2, 0, 0)
          this.world.createCollider(
              this.rapier.ColliderDesc.cuboid(armLength/2, armHeight/2, armWidth/2)
                  .setTranslation(armLength/2, 0, 0),
              body
          )
          this.adventureBodies.push(body)

          this.animatedObstacles.push({
              body,
              mesh: pivotMesh,
              type: 'ROTATING_OSCILLATOR',
              basePos: pivotPos,
              baseRot: new Quaternion(), // Identity
              frequency: Math.PI, // 0.5 Hz * 2PI
              amplitude: Math.PI / 4,
              phase: 0,
              axis: new Vector3(0, 1, 0)
          })
      }

      // 5. The Data Cache (Goal)
      // 5 units off "West" edge.
      const goalPos = platterCenter.add(right.scale(-platterRadius - 6))
      goalPos.y -= 2.0

      this.createBasin(goalPos, storageMat)
  }

  // --- Track: The Neural Network ---
  protected createNeuralNetworkTrack(): void {
      const netMat = this.getTrackMaterial("#FFFFFF") // White
      const veinMat = this.getTrackMaterial("#FF0000") // Red

      let currentPos = this.currentStartPos.clone()
      const heading = 0

      // 1. The Stimulus (Injection)
      // Length 12, Incline -25 deg, Width 6
      const stimLen = 12
      const stimIncline = (25 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 6, stimLen, stimIncline, netMat)

      // 2. The Axon Terminal (Branching Path)
      const forkStart = currentPos.clone()
      const forkHeading = heading

      // Left Path
      let leftPos = forkStart.clone()
      let leftHeading = forkHeading
      // Curve Left 45
      leftPos = this.addCurvedRamp(leftPos, leftHeading, 10, Math.PI/4, 0, 2, 0, veinMat, 10)
      leftHeading -= Math.PI/4
      // Straight
      leftPos = this.addStraightRamp(leftPos, leftHeading, 2, 5, 0, veinMat)
      // Curve Right 45 (Reconnect direction)
      leftPos = this.addCurvedRamp(leftPos, leftHeading, 10, -Math.PI/4, 0, 2, 0, veinMat, 10)
      leftHeading += Math.PI/4

      // Right Path
      let rightPos = forkStart.clone()
      let rightHeading = forkHeading
      // Curve Right 45
      rightPos = this.addCurvedRamp(rightPos, rightHeading, 10, -Math.PI/4, 0, 6, 1.0, netMat, 10)
      rightHeading += Math.PI/4
      // Straight with Obstacles
      const rightStraightStart = rightPos.clone()
      rightPos = this.addStraightRamp(rightPos, rightHeading, 6, 5, 0, netMat)
      // Add Obstacles (Cell Bodies)
      if (this.world) {
           const rockRadius = 0.5
           const rockPos = rightStraightStart.add(new Vector3(Math.sin(rightHeading), 0, Math.cos(rightHeading)).scale(2.5))
           rockPos.y += 0.5
           const rock = MeshBuilder.CreateSphere("cellBody", { diameter: rockRadius * 2 }, this.scene)
           rock.position.copyFrom(rockPos)
           rock.material = veinMat
           this.adventureTrack.push(rock)
           const body = this.world.createRigidBody(
               this.rapier.RigidBodyDesc.fixed().setTranslation(rockPos.x, rockPos.y, rockPos.z)
           )
           this.world.createCollider(
               this.rapier.ColliderDesc.ball(rockRadius),
               body
           )
           this.adventureBodies.push(body)
      }
      // Curve Left 45 (Reconnect)
      rightPos = this.addCurvedRamp(rightPos, rightHeading, 10, Math.PI/4, 0, 6, 1.0, netMat, 10)
      rightHeading -= Math.PI/4

      // Converge
      const convergePos = leftPos.add(rightPos).scale(0.5)
      currentPos = convergePos

      // 3. The Synaptic Gap (Hazard)
      const gapLen = 6
      const gapStart = currentPos.clone()
      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))

      // Move currentPos to other side of gap
      currentPos = currentPos.add(forward.scale(gapLen))

      // Bridge in middle
      if (this.world) {
          const bridgeWidth = 4
          const bridgeLen = 4 // Slightly shorter than gap
          const bridgeHeight = 1.0

          const bridgeCenter = gapStart.add(forward.scale(gapLen / 2))
          // Base Y: Submerged (-2) -> Surface (0)
          const surfaceY = gapStart.y
          const submergedY = surfaceY - 2.0
          const midY = (surfaceY + submergedY) / 2
          const amp = (surfaceY - submergedY) / 2 // 1.0

          const basePos = new Vector3(bridgeCenter.x, midY, bridgeCenter.z) // Center of oscillation

          const box = MeshBuilder.CreateBox("synapseBridge", { width: bridgeWidth, height: bridgeHeight, depth: bridgeLen }, this.scene)
          box.position.copyFrom(basePos)
          box.rotation.y = heading
          box.material = veinMat
          this.adventureTrack.push(box)

          const q = Quaternion.FromEulerAngles(0, heading, 0)
          const body = this.world.createRigidBody(
              this.rapier.RigidBodyDesc.kinematicPositionBased()
                  .setTranslation(basePos.x, basePos.y, basePos.z)
                  .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          )
          this.world.createCollider(
              this.rapier.ColliderDesc.cuboid(bridgeWidth/2, bridgeHeight/2, bridgeLen/2),
              body
          )
          this.adventureBodies.push(body)

          this.animatedObstacles.push({
              body,
              mesh: box,
              type: 'PISTON',
              basePos,
              frequency: 2.0, // 1 Hz approx
              amplitude: amp,
              phase: 0
          })
      }

      // 4. The Dendrite Forest (Chicane)
      const forestLen = 20
      const forestWidth = 10
      const forestStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, forestWidth, forestLen, 0, netMat)

      if (this.world) {
          // Damping Zone
          const hLen = forestLen
          const center = forestStart.add(forward.scale(hLen / 2))
          center.y += 0.5

          const sensor = this.world.createRigidBody(
              this.rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z)
          )
          const q = Quaternion.FromEulerAngles(0, heading, 0)
          sensor.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

          this.world.createCollider(
              this.rapier.ColliderDesc.cuboid(forestWidth/2, 1, forestLen/2).setSensor(true),
              sensor
          )

          this.dampingZones.push({
              sensor,
              damping: 2.0
          })

          // Cilia Field
          const ciliaCount = 50
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

          for (let i=0; i<ciliaCount; i++) {
               const dist = Math.random() * (forestLen - 2) + 1
               const offset = (Math.random() - 0.5) * (forestWidth - 1)
               const pos = forestStart.add(forward.scale(dist)).add(right.scale(offset))
               pos.y += 1.0 // Height 2.0, center at 1.0

               const cilia = MeshBuilder.CreateCylinder("cilia", { diameter: 0.2, height: 2.0 }, this.scene)
               cilia.position.copyFrom(pos)
               cilia.material = veinMat
               this.adventureTrack.push(cilia)

               const body = this.world.createRigidBody(
                   this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
               )
               this.world.createCollider(
                   this.rapier.ColliderDesc.cylinder(1.0, 0.1),
                   body
               )
               this.adventureBodies.push(body)
          }
      }

      // 5. The Soma (Goal)
      const goalPos = currentPos.clone()
      goalPos.y -= 2
      goalPos.z += 2

      this.createBasin(goalPos, netMat)
  }

  // --- Track: The Neon Stronghold ---
  protected createNeonStrongholdTrack(): void {
      const stoneMat = this.getTrackMaterial("#2F2F2F") // Dark Stone
      const neonMat = this.getTrackMaterial("#0088FF") // Electric Blue

      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. The Approach
      // Length 15, Incline -10 deg, Width 6
      const approachLen = 15
      const approachIncline = (10 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 6, approachLen, approachIncline, stoneMat)

      // 2. The Drawbridge (The Moat)
      // Gap Length 6. Target Elevation +2 relative to launch.
      const moatLen = 6
      const jumpHeight = 2.0

      // Visual Water below
      const waterPos = currentPos.clone()
      waterPos.y -= 3.0
      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      // Center of water box
      const waterCenter = waterPos.add(forward.scale(moatLen / 2))

      if (this.world) {
           const water = MeshBuilder.CreateBox("moatWater", { width: 10, height: 1, depth: moatLen }, this.scene)
           water.position.copyFrom(waterCenter)
           water.material = neonMat // Holographic water
           this.adventureTrack.push(water)
      }

      // Move currentPos across gap and up
      currentPos = currentPos.add(forward.scale(moatLen))
      currentPos.y += jumpHeight

      // 3. The Gatehouse (Hazards)
      // Flat, Length 18, Width 4.
      const gatehouseLen = 18
      const gatehouseWidth = 4
      const gatehouseStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, gatehouseWidth, gatehouseLen, 0, stoneMat, 2.0)

      // Portcullis Gates
      if (this.world) {
          const gateCount = 3
          const gateSpacing = 4.0 // Spread them out
          const startDist = 3.0

          const gateWidth = gatehouseWidth
          const gateHeight = 3.0
          const gateDepth = 0.5

          for (let i = 0; i < gateCount; i++) {
               const dist = startDist + i * gateSpacing
               const pos = gatehouseStart.add(forward.scale(dist))

               // Center Y Oscillation
               const floorY = pos.y
               const midY = floorY + gateHeight/2 + 1.25
               const amp = 1.25

               const basePos = new Vector3(pos.x, midY, pos.z)

               const gate = MeshBuilder.CreateBox("portcullis", { width: gateWidth, height: gateHeight, depth: gateDepth }, this.scene)
               gate.position.copyFrom(basePos)
               gate.rotation.y = heading
               gate.material = neonMat // Neon Bars
               this.adventureTrack.push(gate)

               const q = Quaternion.FromEulerAngles(0, heading, 0)
               const body = this.world.createRigidBody(
                   this.rapier.RigidBodyDesc.kinematicPositionBased()
                       .setTranslation(basePos.x, basePos.y, basePos.z)
                       .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
               )
               this.world.createCollider(
                   this.rapier.ColliderDesc.cuboid(gateWidth/2, gateHeight/2, gateDepth/2),
                   body
               )
               this.adventureBodies.push(body)

               this.animatedObstacles.push({
                   body,
                   mesh: gate,
                   type: 'PISTON',
                   basePos,
                   frequency: 2.0, // 1 Hz
                   amplitude: amp,
                   phase: i * 1.5 // Staggered
               })
          }
      }

      // 4. The Courtyard (Battle)
      // Rotating Platform, Radius 10, 0.5 rad/s.
      const courtRadius = 10
      const courtSpeed = 0.5 // Slow

      const courtCenter = currentPos.add(forward.scale(courtRadius + 1))

      this.createRotatingPlatform(courtCenter, courtRadius, courtSpeed, stoneMat)

      // Turrets (Static on Platform -> Kinematic Children)
      if (this.world && this.adventureBodies.length > 0) {
          const platformBody = this.adventureBodies[this.adventureBodies.length - 1]
          const turretCount = 2
          const turretDist = 6.0

          for (let i = 0; i < turretCount; i++) {
              const angle = i * Math.PI // Opposite sides

              const turretHeight = 2.0
              const turretRadius = 1.0

              // Visual
              const turret = MeshBuilder.CreateCylinder("turret", { diameter: turretRadius*2, height: turretHeight }, this.scene)

              const binding = this.kinematicBindings.find(b => b.body === platformBody)
              if (binding) {
                  turret.parent = binding.mesh
                  const cx = Math.sin(angle) * turretDist
                  const cz = Math.cos(angle) * turretDist

                  turret.position.set(cx, turretHeight/2 + 0.25, cz)
                  turret.material = neonMat

                  // Collider
                  const colliderDesc = this.rapier.ColliderDesc.cylinder(turretHeight/2, turretRadius)
                      .setTranslation(cx, turretHeight/2 + 0.25, cz)

                  this.world.createCollider(colliderDesc, platformBody)
              }
          }
      }

      // 5. The Keep (Ascent)
      // Curved Ramp, Radius 8, Angle 270, Incline 20 (Up).
      const keepRadius = 8
      const keepAngle = (270 * Math.PI) / 180
      const keepIncline = -(20 * Math.PI) / 180 // Up

      // Start Keep ramp from edge of courtyard
      const keepStart = courtCenter.add(forward.scale(courtRadius + 1))
      currentPos = keepStart
      // Heading is still 0 (North)

      currentPos = this.addCurvedRamp(currentPos, heading, keepRadius, keepAngle, keepIncline, 6, 2.0, stoneMat, 20)
      heading += keepAngle

      // 6. The Throne (Goal)
      const goalPos = currentPos.clone()
      goalPos.y -= 1 // Basin floor
      const goalForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const finalGoalPos = goalPos.add(goalForward.scale(4))

      this.createBasin(finalGoalPos, neonMat)
  }

  // --- Track: The Casino Heist ---
  protected createCasinoHeistTrack(): void {
      const feltMat = this.getTrackMaterial("#880000") // Dark Red
      const goldMat = this.getTrackMaterial("#FFD700") // Gold
      const chipMatRed = this.getTrackMaterial("#FF0000")
      const chipMatBlue = this.getTrackMaterial("#0000FF")
      const chipMatBlack = this.getTrackMaterial("#111111")
      const chipMatWhite = this.getTrackMaterial("#FFFFFF")
      const chipMats = [chipMatRed, chipMatBlue, chipMatBlack, chipMatWhite]

      let currentPos = this.currentStartPos.clone()
      const heading = 0
      const entryLen = 15
      const entryIncline = (15 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 8, entryLen, entryIncline, feltMat)

      // 2. The Chip Stack Maze (Obstacles)
      // Flat, Length 20, Width 12
      const mazeLen = 20
      const mazeWidth = 12
      const mazeStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, mazeWidth, mazeLen, 0, feltMat)

      if (this.world) {
          const chipCount = 15
          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

          for (let i = 0; i < chipCount; i++) {
              const dist = 2 + Math.random() * (mazeLen - 4)
              const offset = (Math.random() - 0.5) * (mazeWidth - 2)

              const pos = mazeStart.add(forward.scale(dist)).add(right.scale(offset))
              // Stack height? "Stacks". Let's vary height.
              const stackHeight = 0.5 + Math.random() * 1.5
              const chipRadius = 1.0

              pos.y += stackHeight / 2 // Sit on floor

              const chip = MeshBuilder.CreateCylinder("pokerChip", { diameter: chipRadius * 2, height: stackHeight }, this.scene)
              chip.position.copyFrom(pos)
              chip.material = chipMats[Math.floor(Math.random() * chipMats.length)]
              this.adventureTrack.push(chip)

              const body = this.world.createRigidBody(
                  this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
              )
              this.world.createCollider(
                  this.rapier.ColliderDesc.cylinder(stackHeight / 2, chipRadius).setRestitution(0.8),
                  body
              )
              this.adventureBodies.push(body)
          }
      }

      // 3. The Roulette Wheel (Hazard)
      // Rotating Platform, Radius 12, Speed Variable (1.5 rad/s)
      const wheelRadius = 12
      const wheelSpeed = 1.5 // CCW

      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const wheelCenter = currentPos.add(forward.scale(wheelRadius + 1))

      this.createRotatingPlatform(wheelCenter, wheelRadius, wheelSpeed, feltMat)

      // Zero Pockets (Sensors)
      // 2 Gaps. Attached to platform via separate kinematic body with same velocity
      if (this.world) {
          const pocketCount = 2
          const pocketAngleStep = Math.PI // 180 degrees apart

          // Create a kinematic body for sensors that mimics the platform rotation
          const sensorBodyDesc = this.rapier.RigidBodyDesc.kinematicVelocityBased()
              .setTranslation(wheelCenter.x, wheelCenter.y, wheelCenter.z)
          const sensorBody = this.world.createRigidBody(sensorBodyDesc)
          sensorBody.setAngvel({ x: 0, y: wheelSpeed, z: 0 }, true)

          this.resetSensors.push(sensorBody)
          this.adventureBodies.push(sensorBody)

          // Add sensor shapes
          for (let i = 0; i < pocketCount; i++) {
              const angle = i * pocketAngleStep
              const r = wheelRadius * 0.7 // Mid-radius

              const lx = Math.sin(angle) * r
              const lz = Math.cos(angle) * r

              const sensorShape = this.rapier.ColliderDesc.cylinder(0.5, 1.0)
                  .setTranslation(lx, 0.5, lz)
                  .setSensor(true)

              this.world.createCollider(sensorShape, sensorBody)

              // Visual Marker
              const marker = MeshBuilder.CreateCylinder("zeroPocket", { diameter: 2, height: 0.1 }, this.scene)
              // We need to parent this to the platform mesh to rotate visually
              // The platform mesh is the last one in kinematicBindings
              if (this.kinematicBindings.length > 0) {
                  const platformBinding = this.kinematicBindings[this.kinematicBindings.length - 1]
                  marker.parent = platformBinding.mesh
                  marker.position.set(lx, 0.55, lz)
                  marker.material = chipMatBlack
              }
          }
      }

      // 4. The Slots (Chicane)
      // Length 12, Width 8
      // 3 Kinematic Walls (Reel Gates).
      const slotLen = 12
      const slotWidth = 8

      const wheelExit = wheelCenter.add(forward.scale(wheelRadius + 1))
      currentPos = wheelExit
      const slotStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, slotWidth, slotLen, 0, feltMat)

      if (this.world) {
          const gateCount = 3
          const gateWidth = slotWidth
          const gateHeight = 4.0
          const gateDepth = 0.5
          const spacing = 3.0

          for (let i = 0; i < gateCount; i++) {
               const dist = 2.0 + i * spacing
               const pos = slotStart.add(forward.scale(dist))

               // Random motion
               const amp = 2.5
               const phase = Math.random() * Math.PI * 2
               const freq = 1.0 + Math.random() // Random speed

               const floorY = pos.y
               const basePos = new Vector3(pos.x, floorY, pos.z)

               const gate = MeshBuilder.CreateBox("slotGate", { width: gateWidth, height: gateHeight, depth: gateDepth }, this.scene)
               gate.position.copyFrom(basePos)
               gate.rotation.y = heading
               gate.material = goldMat
               this.adventureTrack.push(gate)

               const q = Quaternion.FromEulerAngles(0, heading, 0)
               const body = this.world.createRigidBody(
                   this.rapier.RigidBodyDesc.kinematicPositionBased()
                       .setTranslation(basePos.x, basePos.y, basePos.z)
                       .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
               )
               this.world.createCollider(
                   this.rapier.ColliderDesc.cuboid(gateWidth/2, gateHeight/2, gateDepth/2),
                   body
               )
               this.adventureBodies.push(body)

               this.animatedObstacles.push({
                   body,
                   mesh: gate,
                   type: 'PISTON',
                   basePos,
                   frequency: freq * 3.0,
                   amplitude: amp,
                   phase
               })
          }
      }

      // 5. The Vault (Goal)
      const goalPos = currentPos.clone()
      goalPos.y -= 2
      goalPos.z += 2

      this.createBasin(goalPos, goldMat)
  }

}
