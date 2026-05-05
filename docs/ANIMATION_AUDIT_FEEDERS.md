# Pachinball Feeder Animation Audit Report

**Date:** 2026-03-19  
**Auditor:** Animation Specialist  
**Scope:** Visual enhancement opportunities for all feeder animation systems

---

## Executive Summary

All 5 feeder systems use Babylon.js for rendering with Rapier physics. Animation is currently limited to basic rotation, linear interpolation, and color changes. Each feeder has significant untapped potential for follow-through, squash-and-stretch, and impact polish without affecting gameplay-critical systems.

### Animation Rating Summary Table

| Feeder | Current Rating | Potential Rating | Primary Enhancement Opportunities |
|--------|---------------|------------------|-----------------------------------|
| MagSpinFeeder | ⭐⭐ (2/5) | ⭐⭐⭐⭐⭐ (5/5) | Ring momentum, ball squash, impact shake |
| GaussCannonFeeder | ⭐⭐⭐ (3/5) | ⭐⭐⭐⭐⭐ (5/5) | Recoil, coil stretch, barrel vibration |
| PrismCoreFeeder | ⭐⭐ (2/5) | ⭐⭐⭐⭐ (4/5) | Shell deformation, energy bloom, rotation follow-through |
| QuantumTunnelFeeder | ⭐⭐⭐ (3/5) | ⭐⭐⭐⭐⭐ (5/5) | Portal distortion, transport stretch, eject recoil |
| NanoLoomFeeder | ⭐⭐ (2/5) | ⭐⭐⭐⭐ (4/5) | Pin wave, frame flex, lift anticipation |

---

## 1. MagSpinFeeder (mag-spin-feeder.ts)

### Current Animation Approach
- **Ring rotation:** `this.ringMesh.rotation.y += dt * 20` (SPIN state) or `dt * 1` (IDLE)
- **Color transitions:** Cyan (IDLE) → Purple (CATCH) → Pink (SPIN) → Gray (COOLDOWN)
- **Light intensity:** 0.5 → 1.0 → 2.0 → 0.2
- **Ball capture:** Lerp-based positioning (`dt * 5` factor)

### Enhancement Opportunities

#### A. Follow-Through: Ring Momentum (LOW RISK)
**Location:** `update()` method, lines 169-175

The ring instantly changes rotation speed between states. Add momentum with angular velocity:

```typescript
// Add to class properties
private ringAngularVelocity: number = 0
private readonly RING_SPIN_ACCEL = 40
private readonly RING_SPIN_FRICTION = 2.0

// In update() method, replace lines 169-175:
const targetSpeed = this.state === MagSpinState.SPIN ? 20 : 1
this.ringAngularVelocity = Scalar.Lerp(
  this.ringAngularVelocity, 
  targetSpeed, 
  dt * (this.state === MagSpinState.SPIN ? 2.0 : 0.5)
)
if (this.ringMesh) {
  this.ringMesh.rotation.y += dt * this.ringAngularVelocity
}
```

**Risk Assessment:** 🟢 **SAFE** - Pure visual, no physics/collision impact

#### B. Squash-and-Stretch: Ball Compression on Capture (LOW RISK)
**Location:** `animateLoad()` equivalent in CATCH state, lines 183-202

The ball is moved via `setNextKinematicTranslation()` but mesh scaling isn't accessible. To implement this enhancement, the Game class would need to expose the ball mesh for visual-only scaling:

```typescript
// In captureBall() - add callback for visual squash
public onBallCaptureVisual: ((body: RAPIER.RigidBody, intensity: number) => void) | null = null

// Trigger in captureBall():
if (this.onBallCaptureVisual) {
  this.onBallCaptureVisual(body, 1.0) // Full squash effect
}

// Game.ts would handle the visual mesh scaling:
// ballMesh.scaling = new Vector3(1.3, 0.7, 1.3) // Squash
// Then animate back to Vector3(1, 1, 1) over 0.2s
```

**Risk Assessment:** 🟢 **SAFE** - Requires Game.ts coordination but affects only visual mesh

#### C. Impact Polish: Release Vibration (LOW RISK)
**Location:** `releaseBall()` method, lines 306-328

Add screen-space shake or mesh vibration on release:

```typescript
// Add to class properties
private releaseShakeIntensity: number = 0

// In releaseBall(), after impulse application:
this.releaseShakeIntensity = 0.5 // Visual shake amount

// Add to update() - shake the ring mesh only:
if (this.releaseShakeIntensity > 0 && this.ringMesh) {
  const shakeX = (Math.random() - 0.5) * this.releaseShakeIntensity
  const shakeZ = (Math.random() - 0.5) * this.releaseShakeIntensity
  this.ringMesh.position.x = this.position.x + shakeX
  this.ringMesh.position.z = this.position.z + shakeZ
  this.releaseShakeIntensity *= 0.9 // Decay
} else if (this.ringMesh) {
  // Reset to exact position
  this.ringMesh.position.copyFrom(this.position)
  this.ringMesh.position.y += 0.5
}
```

**Risk Assessment:** 🟢 **SAFE** - Visual only, resets to exact position

### What Must NOT Change
- ✅ `setNextKinematicTranslation()` calls (lines 192, 326) - Ball physics timing
- ✅ State transition distances (line 198: `dist < 0.2`) - Capture completion threshold
- ✅ `applyImpulse()` direction calculation (lines 315-326) - Launch trajectory
- ✅ Timer-based state transitions (lines 205-207, 215-217) - Gameplay timing

---

## 2. GaussCannonFeeder (gauss-cannon-feeder.ts)

### Current Animation Approach
- **Barrel rotation:** Y-axis rotation based on `currentAngle` (degrees)
- **Idle sweep:** Back-and-forth between min/max angle at 0.2 speed
- **Coil charging:** Sequential color changes (Blue → Orange → Red)
- **Fire flash:** Light intensity spike 0→5.0 with 100ms timeout

### Enhancement Opportunities

#### A. Follow-Through: Barrel Recoil (LOW RISK)
**Location:** `fireBall()` method, lines 350-379

The barrel should kick back on fire with spring recovery:

```typescript
// Add to class properties
private barrelRecoilOffset: number = 0
private barrelRecoilVelocity: number = 0

// In fireBall(), after impulse application:
this.barrelRecoilVelocity = 0.5 // Units per second kickback

// Add to update() method:
if (this.barrelMesh) {
  // Physics-based recoil spring
  const springStrength = 20.0
  const damping = 0.7
  const targetOffset = 0
  
  const force = (targetOffset - this.barrelRecoilOffset) * springStrength
  this.barrelRecoilVelocity += force * dt
  this.barrelRecoilVelocity *= (1 - damping * dt)
  this.barrelRecoilOffset += this.barrelRecoilVelocity * dt
  
  // Apply as local Z offset (along barrel axis after rotation)
  // Note: barrelMesh is rotated X=90deg, so local Y is world Z
  const recoilPos = new Vector3(0, 2.0 - this.barrelRecoilOffset, 0)
  // Apply to mesh position relative to baked transform
}
```

**Risk Assessment:** 🟢 **SAFE** - Mesh position only, physics body unchanged

#### B. Squash-and-Stretch: Coil Energy Buildup (LOW RISK)
**Location:** `setCoilColor()` and `animateAim()`, lines 251-266, 338-348

Coils should stretch/throb as energy builds:

```typescript
// Add to class properties
private coilPulsePhase: number = 0

// In update() during AIM state:
if (this.state === GaussCannonState.AIM && this.barrelMesh) {
  this.coilPulsePhase += dt * 10 // Fast pulse
  const stretch = 1.0 + Math.sin(this.coilPulsePhase) * 0.1 * (this.timer / 2.0)
  
  this.barrelMesh.getChildren().forEach((child, index) => {
    if (child instanceof Mesh && child.name.includes("gaussCoil")) {
      // Scale Y (along barrel) based on charge
      child.scaling.y = stretch
      // Squeeze X/Z to preserve volume
      child.scaling.x = 1.0 / Math.sqrt(stretch)
      child.scaling.z = 1.0 / Math.sqrt(stretch)
    }
  })
}
```

**Risk Assessment:** 🟢 **SAFE** - Scaling doesn't affect physics colliders

#### C. Impact Polish: Barrel Vibration (LOW RISK)
**Location:** `fireBall()` and update loop

Micro-vibrations during charge and fire:

```typescript
// Add to class properties
private vibrationIntensity: number = 0

// In setState() when entering AIM:
this.vibrationIntensity = 0.02 // Subtle charging vibration

// In fireBall():
this.vibrationIntensity = 0.3 // Strong fire vibration

// In update():
if (this.vibrationIntensity > 0 && this.barrelMesh) {
  const vib = this.vibrationIntensity
  this.barrelMesh.position.x = (Math.random() - 0.5) * vib
  this.barrelMesh.position.z = (Math.random() - 0.5) * vib
  this.vibrationIntensity *= 0.95 // Decay
} else if (this.barrelMesh && this.state !== GaussCannonState.AIM) {
  // Reset
  this.barrelMesh.position.x = 0
  this.barrelMesh.position.z = 0
}
```

**Risk Assessment:** 🟢 **SAFE** - Visual jitter only

### What Must NOT Change
- ✅ `currentAngle` calculation and limits (lines 210-222, 251-266) - Aim trajectory
- ✅ `setBodyType()` calls (lines 288, 353) - Physics state changes
- ✅ `applyImpulse()` timing (line 371) - Fire moment
- ✅ `timer` values in setState() - State durations

---

## 3. PrismCoreFeeder (prism-core-feeder.ts)

### Current Animation Approach
- **Dual rotation:** Inner octahedron + outer cylinder rotate at different speeds
- **Speed ramping:** 0.5 → 2.0 → 5.0 → 10.0 based on state
- **Color progression:** Green → Yellow → Red → White
- **Instant release:** All balls ejected simultaneously on OVERLOAD

### Enhancement Opportunities

#### A. Follow-Through: Rotation Decay (LOW RISK)
**Location:** `update()` method, lines 113-121

Add rotational inertia that carries through state changes:

```typescript
// Add to class properties
private innerRotationSpeed: number = 0.5
private outerRotationSpeed: number = -0.25 // Counter-rotation

// In update(), replace lines 113-121:
const targetInnerSpeed = this.state === PrismCoreState.IDLE ? 0.5 :
                         this.state === PrismCoreState.LOCKED_1 ? 2.0 :
                         this.state === PrismCoreState.LOCKED_2 ? 5.0 : 15.0
const targetOuterSpeed = -targetInnerSpeed * 0.5

// Smooth acceleration/deceleration
this.innerRotationSpeed = Scalar.Lerp(this.innerRotationSpeed, targetInnerSpeed, dt * 2)
this.outerRotationSpeed = Scalar.Lerp(this.outerRotationSpeed, targetOuterSpeed, dt * 2)

if (this.innerMesh) {
  this.innerMesh.rotation.y += this.innerRotationSpeed * dt
  this.innerMesh.rotation.x += this.innerRotationSpeed * dt * 0.5
}
if (this.outerMesh) {
  this.outerMesh.rotation.y += this.outerRotationSpeed * dt
}
```

**Risk Assessment:** 🟢 **SAFE** - Pure visual rotation

#### B. Squash-and-Stretch: Shell Breathing (LOW RISK)
**Location:** `update()` method

The outer shell should deform based on charge level:

```typescript
// Add to class properties
private shellBreathPhase: number = 0

// In update():
if (this.outerMesh) {
  this.shellBreathPhase += dt * this.visualRotationSpeed * 2
  const breathAmount = 0.05 * (this.state + 1) // More deformation at higher states
  const scaleY = 1.0 + Math.sin(this.shellBreathPhase) * breathAmount
  const scaleXZ = 1.0 + Math.cos(this.shellBreathPhase) * breathAmount * 0.5
  
  this.outerMesh.scaling.y = scaleY
  this.outerMesh.scaling.x = scaleXZ
  this.outerMesh.scaling.z = scaleXZ
}
```

**Risk Assessment:** 🟢 **SAFE** - Visual mesh scaling only

#### C. Impact Polish: Energy Bloom on Release (LOW RISK)
**Location:** `releaseAll()` method, lines 220-287

Add expanding shockwave effect:

```typescript
// Add to createVisuals():
const shockwave = MeshBuilder.CreateSphere("prismShockwave", { diameter: 1 }, this.scene)
shockwave.position.copyFrom(this.position)
const shockMat = new StandardMaterial("shockMat", this.scene)
shockMat.emissiveColor = Color3.White()
shockMat.alpha = 0
shockwave.material = shockMat
shockwave.setEnabled(false)
this.shockwaveMesh = shockwave

// In releaseAll():
if (this.shockwaveMesh) {
  this.shockwaveMesh.setEnabled(true)
  this.shockwaveMesh.scaling = Vector3.One()
  // Animate in update or use Babylon animation
  // Expand to 5x scale over 0.3s then fade
}
```

**Risk Assessment:** 🟢 **SAFE** - New visual element, no physics

### What Must NOT Change
- ✅ `captureBall()` state transitions (lines 147-175) - Gameplay logic
- ✅ `setBodyType()` calls (line 165, 229) - Physics timing
- ✅ `applyImpulse()` directions (lines 240-251) - Eject trajectories
- ✅ `cooldownTimer` logic - Anti-spam protection

---

## 4. QuantumTunnelFeeder (quantum-tunnel-feeder.ts)

### Current Animation Approach
- **Portal spin:** Input ring rotates +Z, output rotates -Z
- **Pulse effect:** Sine-based emissive pulsing in IDLE
- **Color lerp:** Output charges from dark to cyan during TRANSPORT
- **Instant eject:** Ball teleports and receives impulse

### Enhancement Opportunities

#### A. Follow-Through: Portal Spin Decay (LOW RISK)
**Location:** `update()` method, lines 99-123

Portals should spin up/down smoothly:

```typescript
// Add to class properties
private inputSpinSpeed: number = 1.0
private outputSpinSpeed: number = -1.0
private readonly SPIN_ACCEL = 5.0

// In update(), replace lines 103-104:
const targetInputSpeed = this.state === QuantumTunnelState.IDLE ? 1.0 :
                         this.state === QuantumTunnelState.CAPTURE ? 5.0 :
                         this.state === QuantumTunnelState.TRANSPORT ? 8.0 :
                         this.state === QuantumTunnelState.EJECT ? 10.0 : 2.0

this.inputSpinSpeed = Scalar.Lerp(this.inputSpinSpeed, targetInputSpeed, dt * SPIN_ACCEL)
this.outputSpinSpeed = Scalar.Lerp(this.outputSpinSpeed, -targetInputSpeed * 0.8, dt * SPIN_ACCEL)

this.inputMesh.rotation.z += dt * this.inputSpinSpeed
this.outputMesh.rotation.z += dt * this.outputSpinSpeed
```

**Risk Assessment:** 🟢 **SAFE** - Visual rotation only

#### B. Squash-and-Stretch: Portal Distortion During Transport (MEDIUM RISK)
**Location:** `updateTransport()` method, lines 175-192

The input portal should "stretch" toward the output:

```typescript
// Add to class properties
private portalStretch: number = 0

// In updateTransport():
const progress = Math.min(this.stateTimer / this.config.transportDelay, 1.0)
// Stretch input toward output during transport
this.portalStretch = Math.sin(progress * Math.PI) * 0.3 // 0 → 0.3 → 0

// Apply to input mesh scale (Z is along portal face normal)
// Note: Input faces -X (rotated -90deg Y), so local Z is world -X
this.inputMesh.scaling.z = 1.0 + this.portalStretch
this.inputMesh.scaling.x = 1.0 - this.portalStretch * 0.3 // Preserve volume roughly
this.inputMesh.scaling.y = 1.0 - this.portalStretch * 0.3

// Output does inverse - bulges outward
this.outputMesh.scaling.z = 1.0 + this.portalStretch * 0.5
```

**Risk Assessment:** 🟡 **CAUTION** - Ensure scaling doesn't affect sensor collider positioning

#### C. Impact Polish: Eject Recoil (LOW RISK)
**Location:** `updateEject()` method, lines 194-227

Output portal kicks back on ejection:

```typescript
// Add to class properties
private ejectRecoil: number = 0

// In updateEject(), after impulse:
this.ejectRecoil = 0.3 // Units to kick back

// Add to update():
if (this.ejectRecoil > 0) {
  const outputPos = new Vector3(
    this.config.outputPosition.x,
    this.config.outputPosition.y,
    this.config.outputPosition.z
  )
  // Kick back along normal (facing +X, so recoil is -X)
  const recoilOffset = this.ejectRecoil
  this.outputMesh.position.x = outputPos.x - recoilOffset
  this.ejectRecoil *= 0.8 // Spring back
} else {
  this.outputMesh.position.x = this.config.outputPosition.x
}
```

**Risk Assessment:** 🟢 **SAFE** - Mesh position only, sensor at input side

### What Must NOT Change
- ✅ `setTranslation()` on ball (line 204) - Teleport position
- ✅ `setBodyType()` (line 207) - Physics restoration
- ✅ `applyImpulse()` (line 218) - Eject force
- ✅ `intersectionPair()` check (line 132) - Capture detection
- ✅ `config.transportDelay` usage - Timing

---

## 5. NanoLoomFeeder (nano-loom-feeder.ts)

### Current Animation Approach
- **Static pins:** Grid of cylinders, no animation
- **Light changes:** Intensity 0.2 → 1.0 during LIFT
- **Color shifts:** Cyan (LIFT) → Magenta (WEAVE)
- **Direct kinematic ball lift:** Linear Y movement at 10 units/sec

### Enhancement Opportunities

#### A. Follow-Through: Pin Activation Wave (LOW RISK)
**Location:** `setState()` when entering LIFT, lines 285-326

Pins should activate in a wave as the ball rises:

```typescript
// Add to class properties
private pinActivationProgress: number = 0
private activePinIndices: Set<number> = new Set()

// In setState() for LIFT:
this.pinActivationProgress = 0

// Add to update() during LIFT:
if (this.state === NanoLoomState.LIFT && this.caughtBall) {
  const pos = this.caughtBall.translation()
  const progress = (pos.y - this.intakePosition.y) / this.config.height
  this.pinActivationProgress = progress
  
  // Activate pins near ball height
  const ballRow = Math.floor((this.config.height / 2 - (pos.y - this.position.y)) / this.config.pinSpacing)
  
  this.pins.forEach((pin, index) => {
    const row = Math.floor(index / this.config.pinCols)
    const distanceFromActive = Math.abs(row - ballRow)
    
    if (distanceFromActive < 2) {
      // Pin near ball - extend/activate
      const activation = 1.0 - (distanceFromActive / 2)
      pin.scaling.setAll(1.0 + activation * 0.5)
      ;(pin.material as StandardMaterial).emissiveColor = 
        Color3.FromHexString("#00ff00").scale(0.5 + activation * 0.5)
    } else {
      // Distant pin - reset
      pin.scaling.setAll(1.0)
      ;(pin.material as StandardMaterial).emissiveColor = Color3.FromHexString("#00ff00")
    }
  })
}
```

**Risk Assessment:** 🟢 **SAFE** - Visual scaling only, physics pins unchanged

#### B. Squash-and-Stretch: Frame Flex (LOW RISK)
**Location:** `update()` during ball passage

Frame should bulge slightly as ball passes:

```typescript
// Add to class properties
private frameFlex: number = 0

// In update() during WEAVE:
if (this.state === NanoLoomState.WEAVE && this.caughtBall) {
  // Ball bouncing creates frame vibration
  const pos = this.caughtBall.translation()
  const velocity = this.caughtBall.linvel()
  const impact = Math.abs(velocity.y) + Math.abs(velocity.x) + Math.abs(velocity.z)
  this.frameFlex = Math.min(impact * 0.01, 0.1)
}
this.frameFlex *= 0.9 // Decay

if (this.frameMesh && this.frameFlex > 0.001) {
  const bulge = 1.0 + this.frameFlex * Math.sin(performance.now() * 0.02)
  this.frameMesh.scaling.x = bulge
  this.frameMesh.scaling.z = bulge
}
```

**Risk Assessment:** 🟢 **SAFE** - Frame mesh scaling only

#### C. Impact Polish: Eject Anticipation (LOW RISK)
**Location:** `setState()` EJECT transition

Build tension before ejection:

```typescript
// Add to class properties
private ejectAnticipation: number = 0

// Modify setState() EJECT case:
case NanoLoomState.EJECT:
  this.ejectAnticipation = 0.2 // 200ms anticipation
  // Don't fire immediately
  break

// Add to update():
if (this.ejectAnticipation > 0) {
  this.ejectAnticipation -= dt
  
  // Visual wind-up
  if (this.frameMesh) {
    const windup = 1.0 - (this.ejectAnticipation / 0.2)
    this.frameMesh.scaling.x = 1.0 - windup * 0.1 // Compress
    this.frameMesh.scaling.y = 1.0 + windup * 0.15 // Stretch
  }
  
  if (this.ejectAnticipation <= 0) {
    // NOW fire
    if (this.caughtBall) {
      const force = new Vector3(8.0, 2.0, 0)
      this.caughtBall.applyImpulse({ x: force.x, y: force.y, z: force.z }, true)
    }
    this.timer = 1.0
  }
  return // Skip normal EJECT logic
}
```

**Risk Assessment:** 🟡 **CAUTION** - Delays impulse by 200ms, verify gameplay feel acceptable

### What Must NOT Change
- ✅ `setNextKinematicTranslation()` in LIFT (line 236) - Ball positioning
- ✅ `setBodyType()` to Dynamic (line 307) - Physics handoff timing
- ✅ Pin collider positions/locations - Physics geometry
- ✅ `checkIntake()` radius (line 264) - Capture detection

---

## Implementation Priority Matrix

| Enhancement | Feeder | Impact | Risk | Effort | Priority |
|-------------|--------|--------|------|--------|----------|
| Ring momentum | MagSpin | High | Low | Low | P1 |
| Release vibration | MagSpin | Medium | Low | Low | P1 |
| Barrel recoil | GaussCannon | High | Low | Medium | P1 |
| Coil stretch | GaussCannon | Medium | Low | Low | P2 |
| Portal spin decay | QuantumTunnel | Medium | Low | Low | P1 |
| Portal distortion | QuantumTunnel | High | Medium | Medium | P2 |
| Rotation inertia | PrismCore | Medium | Low | Low | P2 |
| Energy bloom | PrismCore | High | Low | Medium | P2 |
| Pin wave | NanoLoom | High | Low | Medium | P1 |
| Frame flex | NanoLoom | Medium | Low | Low | P3 |

---

## Critical Safety Checklist

Before implementing any enhancement, verify:

- [ ] No `setTranslation()` or `setNextKinematicTranslation()` calls are delayed
- [ ] No `applyImpulse()` calls are delayed (unless specifically playtested)
- [ ] No `setBodyType()` transitions are affected
- [ ] No state machine timing constants are modified
- [ ] No collision detection distances are changed
- [ ] All visual-only properties are clearly marked in comments
- [ ] Physics body positions remain exact (visual offsets are tracked separately)

---

## Code Pattern: Visual-Only Animation Helper

Use this pattern to ensure separation of concerns:

```typescript
// Visual animation state (safe to modify)
private visual = {
  rotationOffset: 0,
  positionOffset: new Vector3(0, 0, 0),
  scaleMultiplier: 1.0,
  vibrationIntensity: 0,
  momentum: 0
}

// Apply in update AFTER physics logic:
if (this.mesh) {
  // Base position from physics/config
  const basePos = this.position.clone()
  
  // Add visual offsets
  this.mesh.position = basePos.add(this.visual.positionOffset)
  this.mesh.rotation.y = this.physicsAngle + this.visual.rotationOffset
  this.mesh.scaling.setAll(this.visual.scaleMultiplier)
}
```

---

*End of Animation Audit Report*
