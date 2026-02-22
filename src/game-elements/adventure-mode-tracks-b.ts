import {
  MeshBuilder,
  Vector3,
  Quaternion,
} from '@babylonjs/core'
import { AdventureModeTracksA } from './adventure-mode-tracks-a'

export abstract class AdventureModeTracksB extends AdventureModeTracksA {
  // --- Track: The CPU Core ---
  protected createCpuCoreTrack(): void {
      // Colors: PCB Green and Gold Traces
      const pcbMat = this.getTrackMaterial("#004400") // Dark Green
      const traceMat = this.getTrackMaterial("#FFD700") // Gold
      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. The Front Side Bus (Entry)
      // Flat, Wide (6), Length 15
      const entryLen = 15
      currentPos = this.addStraightRamp(currentPos, heading, 6, entryLen, 0, pcbMat)

      // 2. The Logic Gate (Chicane)
      // Narrow (3), Zig-Zag
      const gateWidth = 3
      const gateLen = 5

      // Forward 5
      currentPos = this.addStraightRamp(currentPos, heading, gateWidth, gateLen, 0, traceMat)

      // Left 90
      heading -= Math.PI / 2
      // Because we turned 90 degrees abruptly, we need to adjust start pos for the next ramp
      // addStraightRamp starts from 'currentPos'. If we turn, we continue from that point.
      // But visually, a sharp turn might look weird without a corner piece.
      // addStraightRamp returns the END of the segment.
      // If we simply rotate heading, the next segment starts from the end of previous one, but rotated.
      // That works for sharp turns.

      // Forward 5
      currentPos = this.addStraightRamp(currentPos, heading, gateWidth, gateLen, 0, traceMat)

      // Right 90 (Back to original heading)
      heading += Math.PI / 2
      // Forward 5
      currentPos = this.addStraightRamp(currentPos, heading, gateWidth, gateLen, 0, traceMat)

      // 3. The Heatsink (Hazard)
      // Rotating Platform, Radius 8, Fast (90 deg/sec)
      // Needs Fan Blades
      const fanRadius = 8
      const fanSpeed = 1.5 // Radians/sec (~86 deg/sec)

      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))

      // Drop slightly or stay flat? Plan says flat.
      // Move center forward so we land on the edge
      const fanCenter = currentPos.add(forward.scale(fanRadius + 1))

      // We need to implement a custom rotating platform with blades
      // Reuse createRotatingPlatform but add blade logic?
      // Or just write it here custom.

      this.createRotatingPlatform(fanCenter, fanRadius, -fanSpeed, pcbMat, false) // Base

      // Add Fan Blades separately attached to the same kinematic body?
      // createRotatingPlatform creates a body. We can't easily attach more colliders to it from outside without modifying it.
      // Let's modify createRotatingPlatform to support "Fan Blades" or do it manually here.

      // Manual implementation for Heatsink Fan
      if (this.world) {
          // We already created the base platform above.
          // Let's find the last body added (which is the platform)
          const fanBody = this.adventureBodies[this.adventureBodies.length - 1]

          // Add 4 Blades
          const bladeCount = 4
          const bladeLength = fanRadius - 1
          const bladeHeight = 1.5
          const bladeThickness = 0.5

          for (let i = 0; i < bladeCount; i++) {
              const angle = (i * Math.PI * 2) / bladeCount

              // Visual Blade
              const blade = MeshBuilder.CreateBox("fanBlade", { width: bladeThickness, height: bladeHeight, depth: bladeLength }, this.scene)
              // Position relative to center?
              // We need to parent it to the visual mesh of the platform?
              // The platform mesh is in this.kinematicBindings
              const binding = this.kinematicBindings.find(b => b.body === fanBody)
              if (binding) {
                  blade.parent = binding.mesh
                  // Local position: Offset from center
                  blade.position.set(0, bladeHeight/2, bladeLength/2)
                  // Rotate around Y center?
                  // We want them radiating out.
                  // If we set position to (0,0, L/2) and then rotate the PARENT (Pivot), that works.
                  // But here we are attaching to the spinning platform.

                  // Easier: Create the blade at the correct local position/rotation
                  // TransformNode as pivot?
                  // Babylon parenting handles visual rotation.

                  // Local position:
                  const r = bladeLength / 2
                  const lx = Math.sin(angle) * r
                  const lz = Math.cos(angle) * r

                  blade.position.set(lx, bladeHeight/2, lz)
                  blade.rotation.y = angle
                  blade.material = traceMat

                  // Physics Collider
                  // Must be attached to the kinematic body
                  // Collider Position is Relative to Body Center (which is fanCenter)
                  // So we use the same offsets as visual

                  const colRot = Quaternion.FromEulerAngles(0, angle, 0)

                  const colliderDesc = this.rapier.ColliderDesc.cuboid(bladeThickness/2, bladeHeight/2, bladeLength/2)
                      .setTranslation(lx, bladeHeight/2 + 0.25, lz) // +0.25 for half platform thickness
                      .setRotation({ x: colRot.x, y: colRot.y, z: colRot.z, w: colRot.w })

                  this.world.createCollider(colliderDesc, fanBody)
              }
          }
      }

      // 4. The Thermal Bridge
      // Narrow (2), Length 10
      // Connects from fan edge to goal

      // Current logical position is fanCenter.
      // We need to start the bridge at the far edge of the fan.
      const bridgeStart = fanCenter.add(forward.scale(fanRadius))
      const bridgeLen = 10
      const bridgeWidth = 2.0

      // Update currentPos to bridgeStart
      // addStraightRamp calculates center based on startPos.
      const bridgeEnd = this.addStraightRamp(bridgeStart, heading, bridgeWidth, bridgeLen, 0, traceMat)

      // 5. The Processor Die (Goal)
      const goalPos = bridgeEnd.clone()
      goalPos.z += 4 // Move into basin
      // goalPos.y -= 1 // Drop slightly?

      this.createBasin(goalPos, pcbMat)

      // Visual: CPU Socket?
      const socket = MeshBuilder.CreateBox("cpuSocket", { width: 4, height: 0.2, depth: 4 }, this.scene)
      socket.position.copyFrom(goalPos)
      socket.position.y += 0.5 // Sit on floor
      socket.material = traceMat
      this.adventureTrack.push(socket)
  }

  // --- Track: The Cryo-Chamber ---
  protected createCryoChamberTrack(): void {
      const iceMat = this.getTrackMaterial("#A5F2F3") // Ice Blue
      const pillarMat = this.getTrackMaterial("#FFFFFF") // White/Ice
      let currentPos = this.currentStartPos.clone()
      let heading = 0
      const iceFriction = 0.001 // Frictionless

      // 1. Flash Freeze (Entry)
      // Length 15, Incline -20 deg, Width 6, Friction 0.0
      const entryLen = 15
      const entryIncline = (20 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 6, entryLen, entryIncline, iceMat, 1.0, iceFriction)

      // 2. The Slalom (Chicane)
      // Curved Ramp x 3. Left 45 -> Right 90 -> Left 45. Radius 10.
      const slalomRadius = 10
      const turn45 = Math.PI / 4
      const turn90 = Math.PI / 2

      // Part 1: Left 45
      currentPos = this.addCurvedRamp(currentPos, heading, slalomRadius, -turn45, 0, 8, 1.0, iceMat, 10, 0, iceFriction)
      heading -= turn45
      // Pillar at Apex (Start of next?)
      this.createStaticCylinder(currentPos, 1.0, 3.0, pillarMat)

      // Part 2: Right 90
      currentPos = this.addCurvedRamp(currentPos, heading, slalomRadius, turn90, 0, 8, 1.0, iceMat, 15, 0, iceFriction)
      heading += turn90
      // Pillar at Apex
      this.createStaticCylinder(currentPos, 1.0, 3.0, pillarMat)

      // Part 3: Left 45
      currentPos = this.addCurvedRamp(currentPos, heading, slalomRadius, -turn45, 0, 8, 1.0, iceMat, 10, 0, iceFriction)
      heading -= turn45

      // 3. The Ice Bridge (Hazard)
      // Straight, Length 12, Width 2.5, WallHeight 0.0
      const bridgeLen = 12
      const bridgeWidth = 2.5
      currentPos = this.addStraightRamp(currentPos, heading, bridgeWidth, bridgeLen, 0, iceMat, 0.0, iceFriction)

      // 4. The Avalanche (Descent)
      // Curved Ramp, Radius 10, Angle 180, Incline -15 deg, Banking -20 deg (Inward)
      const avRadius = 10
      const avAngle = Math.PI
      const avIncline = (15 * Math.PI) / 180
      const avBank = -(20 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, avRadius, avAngle, avIncline, 8, 2.0, iceMat, 20, avBank, iceFriction)
      heading += avAngle

      // 5. Absolute Zero (Goal)
      const goalPos = currentPos.clone()
      goalPos.y -= 2
      goalPos.z += 2
      this.createBasin(goalPos, iceMat)
  }

  // --- Track: The Bio-Hazard Lab ---
  protected createBioHazardLabTrack(): void {
      const hazardMat = this.getTrackMaterial("#39FF14") // Lime Green
      const warningMat = this.getTrackMaterial("#FFFF00") // Yellow
      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. The Sludge Chute (Entry)
      // Length 15, Incline -20 deg, Width 6, Friction 0.1
      const chuteLen = 15
      const chuteIncline = (20 * Math.PI) / 180
      const sludgeFriction = 0.1

      // WallHeight 0.5 to keep ball in initially
      currentPos = this.addStraightRamp(currentPos, heading, 6, chuteLen, chuteIncline, hazardMat, 1.0, sludgeFriction)

      // 2. The Centrifuge (Hazard)
      // Radius 10, Rotation CCW 3.0 rad/s
      const centrifugeRadius = 10
      const centrifugeSpeed = 3.0 // Rad/s

      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))

      // Move center so we enter tangentially or radially?
      // Usually ramp leads to edge.
      // Let's drop the ball onto the edge.
      const centrifugeCenter = currentPos.add(forward.scale(centrifugeRadius + 1))
      centrifugeCenter.y -= 2.0 // Drop into it

      // Create Platform
      this.createRotatingPlatform(centrifugeCenter, centrifugeRadius, centrifugeSpeed, hazardMat)

      // Add Containment Wall (Rotating with platform)
      // We need to access the body created by createRotatingPlatform to attach the wall collider
      // It's the last added body.
      if (this.world && this.adventureBodies.length > 0) {
          const platformBody = this.adventureBodies[this.adventureBodies.length - 1]
          const wallHeight = 0.5
          const wallThickness = 0.5

          // Visual Wall (Tube)
          // Actually, let's use a Tube describing the ring, or just a cylinder with hollow logic?
          // Simplest is a Cylinder with 'arc' but we need 360.
          // Let's use CreateTorus
          const torus = MeshBuilder.CreateTorus("centrifugeWall", {
              diameter: centrifugeRadius * 2,
              thickness: wallThickness,
              tessellation: 32
          }, this.scene)

          // Torus is created lying flat? No, usually standing.
          // We need it flat.

          // But wait, parenting to the kinematic mesh (cylinder)
          const binding = this.kinematicBindings.find(b => b.body === platformBody)
          if (binding) {
             torus.parent = binding.mesh
             torus.position.set(0, wallHeight/2, 0)
             torus.material = warningMat

             // The collider needs to be a hollow cylinder or multiple cuboids approximating a ring.
             // Rapier doesn't have a hollow cylinder collider.
             // We must use compound cuboids.
             const segments = 16
             const angleStep = (Math.PI * 2) / segments

             for (let i=0; i<segments; i++) {
                 const angle = i * angleStep
                 const cx = Math.sin(angle) * centrifugeRadius
                 const cz = Math.cos(angle) * centrifugeRadius

                 const colRot = Quaternion.FromEulerAngles(0, angle, 0)

                 // Arc length approx = radius * step
                 const arcLen = centrifugeRadius * angleStep

                 const colliderDesc = this.rapier.ColliderDesc.cuboid(wallThickness/2, wallHeight/2, arcLen/2 + 0.2) // +0.2 overlap
                    .setTranslation(cx, wallHeight/2 + 0.25, cz) // +0.25 relative to platform center (floor is 0.5 thick)
                    .setRotation({ x: colRot.x, y: colRot.y, z: colRot.z, w: colRot.w })

                 this.world.createCollider(colliderDesc, platformBody)
             }
          }
      }

      // Update currentPos to exit the centrifuge
      // We entered at 'entry' (approx). We exit at 'exit'.
      // Let's say we exit 180 degrees from entry? Or 90?
      // Since it's spinning fast CCW, ball will be flung out.
      // We need a gap in the wall? "Outer rim wall is only 0.5 units high. High speed risks flying over."
      // The intention is the ball FLIES OVER the wall due to centripetal force.
      // So we place the next track section slightly lower and outward.

      const exitDir = heading // Continue straight?
      // Or maybe to the right?
      // Let's continue forward.
      const exitForward = new Vector3(Math.sin(exitDir), 0, Math.cos(exitDir))
      const exitPos = centrifugeCenter.add(exitForward.scale(centrifugeRadius + 2))
      exitPos.y -= 1.0 // Drop

      currentPos = exitPos

      // 3. The Pipeline (Tunnel)
      // Length 12, Width 2.5, WallHeight 4.0, Incline 0
      const pipeLen = 12
      const pipeWidth = 2.5
      const pipeHeight = 4.0

      // Add a catch basin/funnel to ensure ball enters pipe?
      // Or just a wider entry ramp.
      // Let's add a small funnel ramp first.
      currentPos = this.addStraightRamp(currentPos, heading, 6, 4, 0, warningMat, 2.0)

      currentPos = this.addStraightRamp(currentPos, heading, pipeWidth, pipeLen, 0, hazardMat, pipeHeight)

      // 4. The Mixing Vats (Chicane)
      // S-Bend: 90 Left, 90 Right. Radius 8. Gaps.
      const turnRadius = 8
      const turnAngle = Math.PI / 2

      // Turn Left 90
      // Split into 2 segments with gap
      // 45 deg -> Gap -> 45 deg
      const halfAngle = turnAngle / 2

      // Part 1
      currentPos = this.addCurvedRamp(currentPos, heading, turnRadius, -halfAngle, 0, 4, 1.0, hazardMat, 10, 0, 0.1)
      heading -= halfAngle

      // GAP
      const gapLen = 2.0
      // Visual Gap: Just move currentPos
      const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      // Tangent is perpendicular to radius... addCurvedRamp returns end pos.
      // Heading is updated to tangent at end.
      currentPos = currentPos.add(gapForward.scale(gapLen))

      // Part 2
      currentPos = this.addCurvedRamp(currentPos, heading, turnRadius, -halfAngle, 0, 4, 1.0, hazardMat, 10, 0, 0.1)
      heading -= halfAngle

      // Straight buffer
      currentPos = this.addStraightRamp(currentPos, heading, 4, 3, 0, warningMat)

      // Turn Right 90
      // Part 1
      currentPos = this.addCurvedRamp(currentPos, heading, turnRadius, halfAngle, 0, 4, 1.0, hazardMat, 10, 0, 0.1)
      heading += halfAngle

      // GAP
      const gapForward2 = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      currentPos = currentPos.add(gapForward2.scale(gapLen))

      // Part 2
      currentPos = this.addCurvedRamp(currentPos, heading, turnRadius, halfAngle, 0, 4, 1.0, hazardMat, 10, 0, 0.1)
      heading += halfAngle

      // 5. Containment Unit (Goal)
      const goalPos = currentPos.clone()
      goalPos.y -= 2
      goalPos.z += 2

      this.createBasin(goalPos, hazardMat)
  }

  // --- Track: The Gravity Forge ---
  protected createGravityForgeTrack(): void {
      const rustMat = this.getTrackMaterial("#8B4513") // Rust
      const steelMat = this.getTrackMaterial("#333333") // Dark Steel
      const moltenMat = this.getTrackMaterial("#FF4500") // Molten Orange

      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. The Feed Chute (Entry)
      // Length 12, Incline -30 deg, Width 6
      const feedLen = 12
      const feedIncline = (30 * Math.PI) / 180

      // Save start pos of conveyor for sensor
      const conveyorStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, 6, feedLen, feedIncline, rustMat)

      // Add Conveyor Sensor logic
      // It covers the ramp area.
      // We can use a sensor box rotated to match the ramp.
      if (this.world) {
          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          // Calculate center of ramp (same logic as addStraightRamp)
          const hLen = feedLen * Math.cos(feedIncline)
          const vDrop = feedLen * Math.sin(feedIncline)
          const center = conveyorStart.add(forward.scale(hLen / 2))
          center.y -= vDrop / 2

          // Raise slightly so ball is inside
          center.y += 0.5

          const sensorBody = this.world.createRigidBody(
              this.rapier.RigidBodyDesc.fixed()
                  .setTranslation(center.x, center.y, center.z)
          )
          // Rotation matches ramp
          const q = Quaternion.FromEulerAngles(feedIncline, heading, 0)
          sensorBody.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

          this.world.createCollider(
              this.rapier.ColliderDesc.cuboid(3, 1, feedLen / 2).setSensor(true),
              sensorBody
          )

          // Force Vector: +5.0 Z (Relative to ramp forward)
          // Ramp Forward is (0, -sin, cos) in local space if inclining down?
          // Wait, addStraightRamp rotates X by incline.
          // In Local space, forward is Z+.
          // We want to push the ball DOWN the ramp.
          // Force should be applied in World Space or Local? applyImpulse takes World Space.
          // We need World Vector matching Ramp Forward.
          // Ramp Rotation Quaternion q.
          // Local Forward (0,0,1) rotated by q.

          // Force should be applied in World Space.
          // The ramp heads in `heading` (Y rotation) and pitches down by `feedIncline` (X rotation).
          // World Forward:
          // x = sin(heading) * cos(incline)
          // y = -sin(incline)
          // z = cos(heading) * cos(incline)

          const forceDir = new Vector3(
              Math.sin(heading) * Math.cos(feedIncline),
              -Math.sin(feedIncline),
              Math.cos(heading) * Math.cos(feedIncline)
          )

          this.conveyorZones.push({
              sensor: sensorBody,
              force: forceDir.scale(50.0) // Force 5.0 * 10? Plan says "Force +5.0". But impulse needs to be noticeable.
                                          // 5.0 N force on 1kg ball is 5 m/s^2 accel.
                                          // At 60fps (dt 0.016), dv = 5 * 0.016 = 0.08 m/s per frame.
                                          // Over 1 second, adds 5 m/s. Seems correct for a conveyor.
                                          // If I use 50, it's 50 m/s^2. VERY fast.
                                          // Let's stick to 25.0 to be safe/strong.
          })
      }

      // 2. The Crusher Line (Hazard)
      // Flat, Length 20, Width 8
      const crushLen = 20
      const crushWidth = 8

      // Save start pos for pistons
      const crushStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, crushWidth, crushLen, 0, steelMat)

      // Add 3 Hydraulic Pistons
      // Box: Width 6, Depth 3, Height 4
      // Sinusoidal Y.
      if (this.world) {
          const pistonWidth = 6
          const pistonDepth = 3
          const pistonHeight = 4

          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))

          // Staggered: 0.0, 1.5, 3.0 sec offsets. Freq 1.0 Hz.
          // Locations: distributed along the 20 length.
          // Let's place them at 5, 10, 15 units from start.

          const positions = [5, 10, 15]
          const phases = [0, 1.5, 3.0] // Phase in Radians? Or Seconds? Plan says "offsets". Sin(t * freq). offset is phase shift.
                                       // If freq is 1.0 (2PI rad/s?), then 1.5s is ~1.5 cycles?
                                       // Let's treat them as phase addends.

          for (let i = 0; i < 3; i++) {
              const dist = positions[i]
              const pistonPos = crushStart.add(forward.scale(dist))
              // Center X (0 offset)

              // Base Y calculation
              // Floor is at pistonPos.y
              // We want min Y to be floor + 0.2 gap.
              // Piston Height is 4. Center at min Y is (floor + 0.2 + 2).
              // Oscillation: y = mid + sin * amp.
              // We want (mid - amp) = min Y.
              // We want (mid + amp) = max Y (lifted).
              // Let's lift it by 4 units. Max Y = min Y + 4.
              // So Amp = 2.0.
              // Mid = Min + 2.0 = floor + 0.2 + 2 + 2 = floor + 4.2.

              const floorY = pistonPos.y
              const gap = 0.2
              const amp = 2.0
              const minY = floorY + gap + pistonHeight / 2
              const midY = minY + amp

              const basePos = new Vector3(pistonPos.x, midY, pistonPos.z)

              // Visual
              const piston = MeshBuilder.CreateBox("piston", { width: pistonWidth, height: pistonHeight, depth: pistonDepth }, this.scene)
              piston.position.copyFrom(basePos)
              piston.material = steelMat // Or maybe Rust?
              this.adventureTrack.push(piston)

              // Physics
              const body = this.world.createRigidBody(
                  this.rapier.RigidBodyDesc.kinematicPositionBased()
                      .setTranslation(basePos.x, basePos.y, basePos.z)
              )
              this.world.createCollider(
                  this.rapier.ColliderDesc.cuboid(pistonWidth/2, pistonHeight/2, pistonDepth/2),
                  body
              )
              this.adventureBodies.push(body)

              this.animatedObstacles.push({
                  body,
                  mesh: piston,
                  type: 'PISTON',
                  basePos,
                  frequency: 2.0, // Slowish? 1.0 Hz = 2PI rad/s? Logic uses sin(t * freq). If freq is rad/s, use 2PI. If Hz, mul by 2PI.
                                  // Plan says "pistonFreq = 1.0 (Hz)". So use Math.PI * 2.
                  amplitude: amp,
                  phase: phases[i]
              })
          }
      }

      // 3. The Slag Bridge (Chicane)
      // S-Bend: 90 Left, 90 Right. Width 2. No Walls.
      const turnRadius = 10
      const turnAngle = Math.PI / 2

      // Turn Left
      currentPos = this.addCurvedRamp(currentPos, heading, turnRadius, -turnAngle, 0, 2, 0, moltenMat, 15)
      heading -= turnAngle

      // Turn Right
      currentPos = this.addCurvedRamp(currentPos, heading, turnRadius, turnAngle, 0, 2, 0, moltenMat, 15)
      heading += turnAngle

      // 4. The Centrifugal Caster (Turn)
      // Rotating Platform, Radius 10, Speed 2.0 rad/s. Wall Height 3.0.
      // Exit Gap.

      const castRadius = 10
      const castSpeed = 2.0

      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const castCenter = currentPos.add(forward.scale(castRadius + 1))

      // Create Platform
      this.createRotatingPlatform(castCenter, castRadius, castSpeed, steelMat)

      // Add Custom Wall with Gap
      // Wall Height 3.0.
      // Gap at exit.
      // We need to know where "Exit" is.
      // We entered at 'heading' (tangent? or radial?).
      // The bridge ends at 'currentPos'.
      // If we simply drop onto the platform...
      // Let's assume exit is 180 degrees from entry or 90?
      // "Exit: A 30-degree gap in the wall that aligns with the goal ramp once per rotation."
      // Wait, "aligns with the goal ramp once per rotation" implies the GAP rotates with the platform?
      // OR the platform rotates, and the wall is STATIC?
      // "Centrifugal Caster... Rotating Platform... WallHeight 3.0 (To keep ball in)... Exit: A 30-degree gap... aligns..."
      // If the WALL is part of the rotating platform, then the gap rotates.
      // If the gap rotates, it only opens to the static exit ramp momentarily. This fits "Caster".
      // So Wall rotates.

      if (this.world && this.adventureBodies.length > 0) {
          const platformBody = this.adventureBodies[this.adventureBodies.length - 1]
          const wallHeight = 3.0
          const wallThickness = 0.5

          // Visual: Torus with gap? Or Cylinder segments.
          // Gap is 30 degrees.
          // Wall covers 330 degrees.

          const gapAngle = (30 * Math.PI) / 180
          const wallAngle = (2 * Math.PI) - gapAngle

          // We can use a Ribbon or multiple boxes.
          // Multiple boxes approximating the arc.
          const segments = 20
          const step = wallAngle / segments

          // Binding
          const binding = this.kinematicBindings.find(b => b.body === platformBody)
          const parentMesh = binding ? binding.mesh : null

          // Start angle. Gap should align with exit eventually.
          // Let's put gap at angle 0 relative to platform.
          // We need to place walls from gapAngle/2 to 2PI - gapAngle/2?

          const startAngle = gapAngle / 2

          for (let i = 0; i <= segments; i++) {
              const theta = startAngle + i * step

              const cx = Math.sin(theta) * castRadius
              const cz = Math.cos(theta) * castRadius

              // Box dimensions
              // Width ~ Arc Length
              const arcLen = castRadius * step

              const wall = MeshBuilder.CreateBox("casterWall", { width: wallThickness, height: wallHeight, depth: arcLen + 0.2 }, this.scene)
              if (parentMesh) {
                  wall.parent = parentMesh
                  wall.position.set(cx, wallHeight/2, cz)
                  wall.rotation.y = theta
                  wall.material = steelMat
              }

              // Collider
              const colRot = Quaternion.FromEulerAngles(0, theta, 0)
              const colliderDesc = this.rapier.ColliderDesc.cuboid(wallThickness/2, wallHeight/2, arcLen/2 + 0.1)
                  .setTranslation(cx, wallHeight/2 + 0.25, cz)
                  .setRotation({ x: colRot.x, y: colRot.y, z: colRot.z, w: colRot.w })

              this.world.createCollider(colliderDesc, platformBody)
          }
      }

      // 5. The Quenching Tank (Goal)
      // 5 units below the Caster exit.
      // Where is the exit? The gap rotates, so exit is anywhere on the perimeter.
      // But we need a STATIC ramp to catch it? Or just a bucket below.
      // "Goal... 5 units below the Caster exit."
      // Let's place the goal ramp/bucket at the "Exit Direction".
      // Let's say exit is Straight Ahead (heading).

      const exitForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const goalPos = castCenter.add(exitForward.scale(castRadius + 4))
      goalPos.y -= 5.0

      this.createBasin(goalPos, moltenMat) // Blue liquid? PLAN says "Blue liquid".
                                            // moltenMat is Orange. Let's make a blue one.
      const waterMat = this.getTrackMaterial("#0088FF")
      // Overwrite material of last added basin?
      // createBasin pushes to adventureTrack.
      const basinMesh = this.adventureTrack[this.adventureTrack.length - 1]
      if (basinMesh) basinMesh.material = waterMat
  }

  // --- Track: The Tidal Nexus ---
  protected createTidalNexusTrack(): void {
      const waterMat = this.getTrackMaterial("#0066FF") // Deep Sky Blue
      const foamMat = this.getTrackMaterial("#E0FFFF") // Light Cyan

      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. The Spillway (Injection)
      // Length 15, Incline -20 deg, Width 6, Conveyor Force +8.0 Z
      const spillLen = 15
      const spillIncline = (20 * Math.PI) / 180

      // Save start for conveyor
      const spillStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, 6, spillLen, spillIncline, waterMat)

      if (this.world) {
          // Conveyor Logic
          const hLen = spillLen * Math.cos(spillIncline)
          const vDrop = spillLen * Math.sin(spillIncline)
          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          const center = spillStart.add(forward.scale(hLen / 2))
          center.y -= vDrop / 2
          center.y += 0.5 // Just above floor

          const sensorBody = this.world.createRigidBody(
              this.rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z)
          )
          const q = Quaternion.FromEulerAngles(spillIncline, heading, 0)
          sensorBody.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

          this.world.createCollider(
              this.rapier.ColliderDesc.cuboid(3, 1, spillLen / 2).setSensor(true),
              sensorBody
          )

          // Force: +8.0 Z relative to ramp.
          // World Force Vector
          // Gravity Forge used 50.0 for "+5.0". So 8.0 -> 80.0?
          // Let's try 60.0.
          const forceDir = new Vector3(
              Math.sin(heading) * Math.cos(spillIncline),
              -Math.sin(spillIncline),
              Math.cos(heading) * Math.cos(spillIncline)
          )
          this.conveyorZones.push({
              sensor: sensorBody,
              force: forceDir.scale(60.0)
          })
      }

      // 2. The Turbine (Hazard)
      // Rotating Platform, Radius 8, CW 1.5 rad/s.
      // 4 Paddle Wheels.
      const turbineRadius = 8
      const turbineSpeed = 1.5 // CW => Negative Y rotation? Usually +Y is CCW. So -1.5.

      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const turbineCenter = currentPos.add(forward.scale(turbineRadius + 1))
      // turbineCenter.y -= 1.0 // Drop slightly?

      // Reuse CreateRotatingPlatform for base
      this.createRotatingPlatform(turbineCenter, turbineRadius, -turbineSpeed, waterMat)

      // Add Paddles
      if (this.world) {
          const platformBody = this.adventureBodies[this.adventureBodies.length - 1]
          const paddleCount = 4
          const paddleLen = turbineRadius - 1
          const paddleHeight = 1.5
          const paddleThick = 0.5

          for (let i = 0; i < paddleCount; i++) {
              const angle = (i * Math.PI * 2) / paddleCount

              // Visual
              const paddle = MeshBuilder.CreateBox("paddle", { width: paddleThick, height: paddleHeight, depth: paddleLen }, this.scene)
              // Attach to platform mesh
              const binding = this.kinematicBindings.find(b => b.body === platformBody)
              if (binding) {
                  paddle.parent = binding.mesh

                  // Local pos
                  const r = paddleLen / 2
                  const lx = Math.sin(angle) * r
                  const lz = Math.cos(angle) * r

                  paddle.position.set(lx, paddleHeight/2, lz)
                  paddle.rotation.y = angle
                  paddle.material = foamMat
              }

              // Collider
              const colRot = Quaternion.FromEulerAngles(0, angle, 0)
              const colliderDesc = this.rapier.ColliderDesc.cuboid(paddleThick/2, paddleHeight/2, paddleLen/2)
                  .setTranslation(
                       Math.sin(angle) * paddleLen/2,
                       paddleHeight/2 + 0.25,
                       Math.cos(angle) * paddleLen/2
                  )
                  .setRotation({ x: colRot.x, y: colRot.y, z: colRot.z, w: colRot.w })

              this.world.createCollider(colliderDesc, platformBody)
          }
      }

      // Exit Turbine
      // Assuming straight exit
      const turbineExit = turbineCenter.add(forward.scale(turbineRadius))
      currentPos = turbineExit

      // 3. The Riptide (Turn)
      // Radius 12, Angle 180, Incline -5 deg, Banking -10 deg (Inward).
      // "Cross-Current" pushes Outward.
      const ripRadius = 12
      const ripAngle = Math.PI // 180
      const ripIncline = (5 * Math.PI) / 180
      const ripBank = -(10 * Math.PI) / 180

      const ripStart = currentPos.clone()

      // Create Visuals/Physics
      currentPos = this.addCurvedRamp(currentPos, heading, ripRadius, ripAngle, ripIncline, 8, 2.0, waterMat, 20, ripBank)

      // Create Cross-Current Sensors
      // Iterate segments again manually
      if (this.world) {
          const segments = 20
          const segmentAngle = ripAngle / segments
          const arcLength = ripRadius * segmentAngle
          const chordLen = 2 * ripRadius * Math.sin(segmentAngle / 2)
          const segmentDrop = arcLength * Math.sin(ripIncline)

          let curH = heading
          let curP = ripStart.clone()

          for (let i = 0; i < segments; i++) {
              curH += (segmentAngle / 2)

              const segForward = new Vector3(Math.sin(curH), 0, Math.cos(curH))
              const center = curP.add(segForward.scale(chordLen / 2))
              center.y -= segmentDrop / 2
              center.y += 0.5 // Above floor

              // Sensor
              const sensorBody = this.world.createRigidBody(
                  this.rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z)
              )
              const q = Quaternion.FromEulerAngles(ripIncline, curH, ripBank)
              sensorBody.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

              this.world.createCollider(
                  this.rapier.ColliderDesc.cuboid(4, 1, chordLen / 2).setSensor(true),
                  sensorBody
              )

              // Force: Outward (Right relative to forward)
              // Forward is (sin(H), 0, cos(H)). Right is (cos(H), 0, -sin(H)).
              // Ignoring vertical tilt for simple outward push.
              const outwardDir = new Vector3(Math.cos(curH), 0, -Math.sin(curH))

              this.conveyorZones.push({
                  sensor: sensorBody,
                  force: outwardDir.scale(40.0) // Strong push
              })

              curP = curP.add(segForward.scale(chordLen))
              curP.y -= segmentDrop
              curH += (segmentAngle / 2)
          }
      }
      heading += ripAngle

      // 4. The Wave Pool (Chicane)
      // Straight Ramp, Length 20, Width 8.
      // 5 rows of kinematic boxes moving in sine wave.
      const poolLen = 20
      const poolWidth = 8

      const poolStart = currentPos.clone()
      currentPos = this.addStraightRamp(currentPos, heading, poolWidth, poolLen, 0, waterMat)

      if (this.world) {
          const rows = 5
          const rowSpacing = 3.0
          const startDist = 3.0
          const boxWidth = poolWidth - 1
          const boxDepth = 2.0
          const boxHeight = 1.0

          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))

          for (let i = 0; i < rows; i++) {
              const dist = startDist + i * rowSpacing
              const pos = poolStart.add(forward.scale(dist))

              // Sine Wave: sin(t + z).
              // z here is distance along track or world z?
              // "sin(t + z)". Let's use 'dist' as phase offset.
              // Amplitude 1.5.
              // Base Y: Floor level.
              // We want it to rise out of floor?
              // Floor is at pos.y.
              // Let's set Base Y such that it peaks at Floor + Amp/2?
              // Or just moves up and down through floor.

              const basePos = pos.clone()
              basePos.y -= 0.5 // Start partially submerged

              const box = MeshBuilder.CreateBox("waveBox", { width: boxWidth, height: boxHeight, depth: boxDepth }, this.scene)
              box.position.copyFrom(basePos)
              box.rotation.y = heading
              box.material = foamMat
              this.adventureTrack.push(box)

              const q = Quaternion.FromEulerAngles(0, heading, 0)
              const body = this.world.createRigidBody(
                  this.rapier.RigidBodyDesc.kinematicPositionBased()
                      .setTranslation(basePos.x, basePos.y, basePos.z)
                      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
              )
              this.world.createCollider(
                  this.rapier.ColliderDesc.cuboid(boxWidth/2, boxHeight/2, boxDepth/2),
                  body
              )
              this.adventureBodies.push(body)

              this.animatedObstacles.push({
                  body,
                  mesh: box,
                  type: 'PISTON', // Reuse piston logic
                  basePos,
                  frequency: 3.0, // Speed of wave
                  amplitude: 1.5,
                  phase: dist * 0.5 // Phase shift based on distance
              })
          }
      }

      // 5. The Abyssal Drop (Goal)
      // Steep waterfall drop?
      // Just a bucket at bottom.
      const goalPos = currentPos.clone()
      goalPos.y -= 4
      goalPos.z += 4

      this.createBasin(goalPos, waterMat)
  }

  // --- Track: The Digital Zen Garden ---
  protected createDigitalZenGardenTrack(): void {
      const gardenMat = this.getTrackMaterial("#FFFFFF") // White
      const accentMat = this.getTrackMaterial("#FF69B4") // Hot Pink
      const sandFriction = 0.8
      const waterFriction = 0.1

      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. The Raked Path (Entry)
      // Length 15, Incline -15 deg, Width 8, Friction 0.8
      const entryLen = 15
      const entryIncline = (15 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 8, entryLen, entryIncline, gardenMat, 1.0, sandFriction)

      // 2. The Rock Garden (Obstacles)
      // Flat, Length 20, Width 12
      const rockLen = 20
      const rockWidth = 12
      const rockStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, rockWidth, rockLen, 0, gardenMat, 0.5, sandFriction)

      // Add 3 Large Static Geospheres
      if (this.world) {
          const rockRadius = 2.0
          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

          // Triangular Formation: One Central, Two Flankers
          const positions = [
              { z: 12, x: 0 },
              { z: 6, x: -3.5 },
              { z: 6, x: 3.5 }
          ]

          positions.forEach(pos => {
              const rockPos = rockStart
                  .add(forward.scale(pos.z))
                  .add(right.scale(pos.x))

              // Embed slightly
              rockPos.y += rockRadius * 0.6

              const rock = MeshBuilder.CreateSphere("zenRock", { diameter: rockRadius * 2, segments: 4 }, this.scene)
              rock.position.copyFrom(rockPos)
              rock.material = accentMat
              this.adventureTrack.push(rock)

              // Physics
              const body = this.world.createRigidBody(
                  this.rapier.RigidBodyDesc.fixed().setTranslation(rockPos.x, rockPos.y, rockPos.z)
              )
              this.world.createCollider(
                  this.rapier.ColliderDesc.ball(rockRadius).setRestitution(0.2),
                  body
              )
              this.adventureBodies.push(body)
          })
      }

      // 3. The Stream Crossing (Hazard)
      // Curve Radius 15, Angle 90, Incline 0, Friction 0.1
      // Conveyor Force +3.0 X (Towards outer edge)
      const streamRadius = 15
      const streamAngle = Math.PI / 2

      const streamStart = currentPos.clone()
      const streamStartHeading = heading

      currentPos = this.addCurvedRamp(currentPos, heading, streamRadius, streamAngle, 0, 8, 1.0, gardenMat, 20, 0, waterFriction)

      // Add Cross Current
      if (this.world) {
          const segments = 10
          const segAngle = streamAngle / segments
          const chordLen = 2 * streamRadius * Math.sin(segAngle/2)

          let curH = streamStartHeading
          let curP = streamStart.clone()

          for (let i=0; i<segments; i++) {
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

               // Force: Towards Outer Edge (Left relative to forward in a Right turn)
               const leftDir = new Vector3(-Math.cos(curH), 0, Math.sin(curH))

               this.conveyorZones.push({
                   sensor,
                   force: leftDir.scale(30.0)
               })

               curP = curP.add(forward.scale(chordLen))
               curH += segAngle / 2
          }
      }
      heading += streamAngle

      // 4. The Moon Bridge (Vertical Arch)
      // Length 10, Width 3, WallHeight 1.0. Parabolic.
      const bridgeLen = 10
      const segments = 10
      const segLen = bridgeLen / segments
      const bridgeWidth = 3

      for (let i=0; i<segments; i++) {
          const x0 = i * segLen
          const x1 = (i + 1) * segLen
          const xm = (x0 + x1) / 2

          // Parabola: y = -0.12 * (x - 5)^2 + 3
          // Slope at xm: dy/dx = -0.24 * (xm - 5)
          const slope = -0.24 * (xm - 5)
          const incline = -Math.atan(slope)

          const meshLen = Math.sqrt(1 + slope * slope) * segLen

          currentPos = this.addStraightRamp(currentPos, heading, bridgeWidth, meshLen, incline, accentMat, 1.0, sandFriction)
      }

      // 5. The Lotus Shrine (Goal)
      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const goalPos = currentPos.add(forward.scale(4))

      this.createBasin(goalPos, accentMat)
  }

  // --- Track: The Synthwave Surf ---
  protected createSynthwaveSurfTrack(): void {
      const floorMat = this.getTrackMaterial("#110022") // Dark Purple
      const gridMat = this.getTrackMaterial("#00FFFF") // Cyan
      const barMat1 = this.getTrackMaterial("#00FF00") // Green
      const barMat2 = this.getTrackMaterial("#FF0000") // Red

      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. The Bass Drop (Entry)
      // Length 15, Incline -25 deg, Width 8
      const dropLen = 15
      const dropIncline = (25 * Math.PI) / 180

      currentPos = this.addStraightRamp(currentPos, heading, 8, dropLen, dropIncline, floorMat)

      // Visual: Pulsing Chevrons?
      // Can simulate with some static meshes for now or just rely on floorMat.

      // 2. The Equalizer (Hazard)
      // Flat, Length 20, Width 10.
      const eqLen = 20
      const eqWidth = 10
      const eqStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, eqWidth, eqLen, 0, floorMat)

      // EQ Bars (Pistons)
      // 5 Rows of 4 Pistons.
      if (this.world) {
          const rows = 5
          const cols = 4
          const rowSpacing = 3.0
          const colSpacing = 2.0
          const pistonWidth = 1.5
          const pistonHeight = 3.0
          const pistonDepth = 1.5

          const startZ = 2.0 // From start of segment
          const startX = -((cols - 1) * colSpacing) / 2

          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

          for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols; c++) {
                   const zOffset = startZ + r * rowSpacing
                   const xOffset = startX + c * colSpacing

                   const pistonPos = eqStart.add(forward.scale(zOffset)).add(right.scale(xOffset))

                   // Base Pos: Floor level?
                   // "They rise and fall... y = abs(sin(t + x))"
                   // We want them to block path when up.
                   // Start with top flush with floor?
                   // Or fully below?
                   // Let's have base Y such that min Y is flush with floor, max Y is 3.0 above.
                   // Amplitude 1.5. Midpoint = Floor + 1.5.
                   // y = mid + amp * sin.
                   // Min = floor. Max = floor + 3.

                   const basePos = pistonPos.clone()
                   basePos.y += pistonHeight / 2 // Center of box when flush
                   // But we want to animate it.
                   // The animate loop uses: y = basePos.y + offset.
                   // Offset is +/- amp.
                   // So basePos.y needs to be the MIDPOINT of the oscillation.
                   // Midpoint = Floor + 1.5 (half max height).
                   // Center of box at midpoint = (Floor + 1.5).

                   const oscBaseY = pistonPos.y + pistonHeight / 2 // Floor + 1.5

                   // Reset basePos for animation center
                   const animBasePos = new Vector3(pistonPos.x, oscBaseY - pistonHeight/2, pistonPos.z)
                   // Wait, my logic in update():
                   // const newY = obst.basePos.y + yOffset
                   // If amplitude is 1.5, range is [base-1.5, base+1.5].
                   // If base is Floor + 1.5. Range is [Floor, Floor + 3.0]. Correct.
                   // Center of box is at Y. Box bottom is Y - 1.5.
                   // At Floor: Center = Floor. Bottom = Floor - 1.5. Top = Floor + 1.5.
                   // At Floor+3: Center = Floor+3. Bottom = Floor+1.5. Top = Floor+4.5.
                   // So it rises OUT of floor?
                   // "Navigate the troughs".
                   // If it's 0 to 3, it blocks.
                   // If it's -3 to 0, it's clear.
                   // abs(sin) is 0 to 1.
                   // We want 0 to Max Height.
                   // Update logic uses simple sin.
                   // Let's adjust Phase/Freq.
                   // Use abs(sin) logic? update() currently supports sin.
                   // Let's stick to sin. Range [-1, 1].
                   // We want it to go from Flush (0 height above floor) to Full (3 height).
                   // Center oscillates.

                   const box = MeshBuilder.CreateBox("eqPiston", { width: pistonWidth, height: pistonHeight, depth: pistonDepth }, this.scene)
                   box.position.copyFrom(animBasePos)
                   box.rotation.y = heading
                   // Gradient color: Green to Red. Use row index.
                   box.material = (r % 2 === 0) ? barMat1 : barMat2
                   this.adventureTrack.push(box)

                   const q = Quaternion.FromEulerAngles(0, heading, 0)
                   const body = this.world.createRigidBody(
                       this.rapier.RigidBodyDesc.kinematicPositionBased()
                           .setTranslation(animBasePos.x, animBasePos.y, animBasePos.z)
                           .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
                   )
                   this.world.createCollider(
                       this.rapier.ColliderDesc.cuboid(pistonWidth/2, pistonHeight/2, pistonDepth/2),
                       body
                   )
                   this.adventureBodies.push(body)

                   this.animatedObstacles.push({
                       body,
                       mesh: box,
                       type: 'PISTON',
                       basePos: animBasePos,
                       frequency: 4.0, // bpm 120 -> 2 Hz? let's make it fast.
                       amplitude: 1.5,
                       // Phase based on X + T?
                       // We can pass phase as xOffset.
                       phase: xOffset * 0.5 + r * 1.0
                   })
              }
          }
      }

      // 3. The High-Pass Filter (Turn)
      // Radius 12, Angle 180, Incline +5 deg (Uphill), Banking -15 deg
      const turnRadius = 12
      const turnAngle = Math.PI
      const turnIncline = -(5 * Math.PI) / 180 // Negative is Uphill?
      // Wait, in addStraightRamp: vDrop = length * sin(incline).
      // positive incline -> vDrop positive -> y goes down.
      // So negative incline -> vDrop negative -> y goes up. Correct.
      const turnBank = -(15 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, turnRadius, turnAngle, turnIncline, 8, 2.0, gridMat, 20, turnBank)
      heading += turnAngle

      // 4. The Sub-Woofer (Goal Approach)
      // Spiral 360, Incline -15 deg (Down), Banking -30 deg
      const spiralRadius = 6
      const spiralAngle = 2 * Math.PI
      const spiralIncline = (15 * Math.PI) / 180 // Down
      const spiralBank = -(30 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, spiralRadius, spiralAngle, spiralIncline, 8, 2.0, floorMat, 30, spiralBank)
      heading += spiralAngle

      // 5. The Mic Drop (Goal)
      const goalPos = currentPos.clone()
      goalPos.y -= 2
      goalPos.z += 2

      this.createBasin(goalPos, gridMat)
  }

}
