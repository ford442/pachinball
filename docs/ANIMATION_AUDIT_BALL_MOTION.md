# Ball Motion & Collision Animation Audit

**Project:** Pachinball  
**Audit Date:** 2026-03-19  
**Auditor:** Animation Specialist  
**Scope:** Ball visual systems, collision feedback, and animation polish opportunities

---

## Executive Summary

The pachinball project implements a physics-driven pinball/pachinko hybrid using **Rapier3D** for physics and **Babylon.js** for rendering. The current visual feedback systems are functional but have significant opportunities for animation polish that would enhance game feel without impacting timing-critical physics.

**Current State:** Functional but minimal animation polish  
**Opportunity:** Add squash-and-stretch, impact recoil, and enhanced trail effects as purely cosmetic overlays  
**Risk Level:** Low - all enhancements can be implemented as visual-only overlays

---

## 1. Current Ball Visual Systems

### 1.1 Ball Lifecycle & Management (`ball-manager.ts`)

**File:** `src/game-elements/ball-manager.ts` (257 lines)

| Aspect | Current Implementation |
|--------|----------------------|
| **Ball Creation** | `MeshBuilder.CreateSphere()` with PBR chrome material |
| **Physics Binding** | `PhysicsBinding[]` array linking mesh to Rapier rigidbody |
| **Trail System** | `TrailMesh` attached to main ball only |
| **Trail Config** | Width: `radius * 0.6`, Length: 20 segments, Cyan emissive (`#00ffff`) |
| **Extra Balls** | Spawned via `spawnExtraBalls()` - NO trails attached |
| **Hologram Catch** | Kinematic positioning with red emissive feedback |

**Key Code References:**
```typescript
// Line 89-93: Trail setup for main ball only
const trailWidth = GameConfig.ball.radius * 0.6
const trail = new TrailMesh("ballTrail", ball, this.scene, trailWidth, 20, true)
const trailMat = new StandardMaterial("trailMat", this.scene)
trailMat.emissiveColor = Color3.FromHexString("#00ffff")
```

**Current Limitations:**
- Only the main ball has a trail (extra balls are trail-less)
- Trail is purely visual with no velocity-based modulation
- No squash/stretch on impacts
- No recoil animation on collision

### 1.2 Shard Particle System (`effects.ts`)

**File:** `src/game-elements/effects.ts` (552 lines)

| Aspect | Current Implementation |
|--------|----------------------|
| **Spawn Trigger** | `spawnShardBurst()` called on bumper collision (line 1044) |
| **Particle Count** | 8 shards per burst |
| **Geometry** | `MeshBuilder.CreateBox()` - 0.15 size cubes |
| **Material** | StandardMaterial with emissive burst color |
| **Velocity** | Random upward scatter: `(random - 0.5, random + 1, random - 0.5) * 5` |
| **Lifetime** | 1.0 second with gravity decay (-9.8 m/s²) |
| **Update** | Manual position integration in `updateShards(dt)` |

**Key Code References:**
```typescript
// Lines 133-146: Shard burst spawn
spawnShardBurst(pos: Vector3, colorHex?: string): void {
  const burstColor = colorHex || PALETTE.CYAN
  for (let i = 0; i < 8; i++) {
    const m = MeshBuilder.CreateBox("s", { size: 0.15 }, this.scene) as Mesh
    const vel = new Vector3(Math.random() - 0.5, Math.random() + 1, Math.random() - 0.5).scale(5)
    this.shards.push({ mesh: m, vel, life: 1.0, material: mat })
  }
}
```

**Current Limitations:**
- Particles are simple cubes with no rotation
- No scale animation over lifetime
- Velocity decay is linear gravity only (no drag)
- Single color per burst (no gradient or fade)

### 1.3 Bloom & Lighting Effects (`effects.ts`)

| Aspect | Current Implementation |
|--------|----------------------|
| **Bloom System** | `DefaultRenderingPipeline` with dynamic weight |
| **Energy Decay** | `bloomEnergy = max(0, bloomEnergy - dt)` (line 166) |
| **Weight Range** | 0.1 (idle) to 0.9 (full bloom) |
| **Trigger** | `setBloomEnergy(2.0)` on bumper hit (line 1045) |
| **Cabinet Lights** | 5 LED strips with state-based color transitions |
| **Lighting Modes** | `normal`, `hit`, `fever`, `reach` |

### 1.4 Bumper Visual Feedback (`game-objects.ts`)

**File:** `src/game-elements/game-objects.ts` - `updateBumpers()` (lines 604-640)

| Aspect | Current Implementation |
|--------|----------------------|
| **Hit Detection** | `activateBumperHit()` sets `hitTime = 0.2` |
| **Scale Animation** | `s = 1 + (hitTime * 2)` - simple pop-out |
| **Hologram Animation** | `scaling.y = 1 + hitTime`, alpha = 0.8 |
| **Idle Animation** | Continuous Y rotation (1.5 rad/s) + bobbing (sine wave) |
| **Particle Burst** | Bumper-specific `ParticleSystem` starts on hit |

**Key Code References:**
```typescript
// Lines 620-628: Current bumper hit animation
if (vis.hitTime > 0) {
  vis.hitTime -= dt
  const s = 1 + (vis.hitTime * 2)
  vis.mesh.scaling.set(s, s, s)
  
  if (vis.hologram) {
    vis.hologram.scaling.set(1, 1 + vis.hitTime, 1)
    vis.hologram.material!.alpha = 0.8
  }
}
```

### 1.5 Physics Sync Loop (`game.ts` lines 911-1070)

**File:** `src/game.ts`

| Aspect | Current Implementation |
|--------|----------------------|
| **Sync Method** | Direct position/rotation copy from physics to mesh |
| **Update Order** | Physics step → Collision processing → Visual sync |
| **Collision Hook** | `processCollision(h1, h2)` called from physics step |
| **Visual Updates** | `updateBumpers()`, `updateShards()`, `updateBloom()` |

**Key Code References:**
```typescript
// Lines 921-938: Physics-to-visual sync
for (const binding of bindings) {
  const body = binding.rigidBody
  const mesh = binding.mesh
  const pos = body.translation()
  const rot = body.rotation()
  
  mesh.position.set(pos.x, pos.y, pos.z)
  mesh.rotationQuaternion.set(rot.x, rot.y, rot.z, rot.w)
}
```

---

## 2. Specific Enhancement Opportunities

### 2.1 Enhanced Trail Effects

#### Current State
- Single cyan trail, 20 segments, fixed width
- Only on main ball
- No velocity responsiveness

#### Enhancement Opportunities

| Enhancement | Description | Implementation Approach |
|-------------|-------------|------------------------|
| **Velocity-Based Trail Width** | Trail widens with speed | Sample velocity magnitude, modulate `trail.width` in sync loop |
| **Color Temperature Shift** | Trail shifts cyan → magenta based on speed | Interpolate emissive color using `Color3.Lerp()` |
| **Extra Ball Trails** | Add trails to spawned extra balls | Create `TrailMesh` in `spawnExtraBalls()` |
| **Trail Fade on Catch** | Trail dissipates when hologram-caught | Animate trail visibility/width in `updateCaughtBalls()` |
| **Impact Trail Burst** | Trail "puffs" on collision | Spawn short-lived secondary trail mesh on impact |

**Babylon.js Animation Approach:**
```typescript
// RECOMMENDED: Use Babylon Animation system for smooth transitions
const animation = new Animation(
  "trailWidth",
  "width",
  60, // fps
  Animation.ANIMATIONTYPE_FLOAT,
  Animation.ANIMATIONLOOPMODE_CYCLE
)

const keys = [
  { frame: 0, value: baseWidth },
  { frame: 10, value: baseWidth * velocityFactor },
  { frame: 30, value: baseWidth }
]
animation.setKeys(keys)
trail.animations.push(animation)
scene.beginAnimation(trail, 0, 30, false)
```

**What Must NOT Change:**
- Trail must not affect physics collision shapes
- Trail rendering must not block physics thread
- Trail lifetime must auto-cleanup to prevent memory leaks

---

### 2.2 Squash-and-Stretch on Impact

#### Current State
- No deformation - ball remains perfect sphere
- Physics velocities are sacred (correctly so)

#### Enhancement Opportunities

| Enhancement | Description | Implementation Approach |
|-------------|-------------|------------------------|
| **Impact Squash** | Brief Y-axis squash on collision | Apply `mesh.scaling` animation in `processCollision()` |
| **Velocity Stretch** | Stretch in direction of travel | Scale mesh based on velocity vector magnitude |
| **Recovery Animation** | Smooth return to sphere | Use `BABYLON.Animation` with easing (EaseOutElastic) |
| **Surface-Specific Deformation** | Different squash for bumper vs wall | Vary intensity based on `h1`/`h2` collider types |

**Babylon.js Animation Approach:**
```typescript
// PURELY COSMETIC - Applied only to mesh, NOT physics body
private animateBallImpact(mesh: Mesh, impactNormal: Vector3, intensity: number): void {
  // Store original scale
  const originalScale = mesh.scaling.clone()
  
  // Create squash frame
  const squashScale = new Vector3(
    1 + intensity * 0.3,  // stretch perpendicular
    1 - intensity * 0.2,  // squash along normal
    1 + intensity * 0.3
  )
  
  // Animate to squash then recover
  const squashAnim = new Animation(
    "squash",
    "scaling",
    60,
    Animation.ANIMATIONTYPE_VECTOR3,
    Animation.ANIMATIONLOOPMODE_CONSTANT
  )
  
  const keys = [
    { frame: 0, value: originalScale },
    { frame: 2, value: squashScale },
    { frame: 8, value: originalScale }
  ]
  
  squashAnim.setKeys(keys)
  
  // Add elastic easing for cartoon feel
  const easing = new ElasticEase()
  easing.setEasingMode(EasingFunction.EASINGMODE_EASEOUT)
  squashAnim.setEasingFunction(easing)
  
  mesh.animations = [squashAnim]
  this.scene.beginAnimation(mesh, 0, 8, false)
}
```

**Integration Point:**
```typescript
// In processCollision() - after physics response, before return
const ballMesh = this.getBallMeshForBody(ballBody)
if (ballMesh) {
  const impactIntensity = ballBody.linvel().magnitude() / 20 // normalized
  this.animateBallImpact(ballMesh, collisionNormal, impactIntensity)
}
```

**What Must NOT Change:**
- `rigidBody.setLinvel()` or `applyImpulse()` values
- Collision detection shapes
- Scoring timing

---

### 2.3 Recoil/Vibration on Collision

#### Current State
- No camera or environment shake
- Cabinet lights flash briefly on hit

#### Enhancement Opportunities

| Enhancement | Description | Implementation Approach |
|-------------|-------------|------------------------|
| **Camera Shake** | Subtle screen shake on bumper impact | Animate `ArcRotateCamera.alpha/beta` offset |
| **Cabinet Vibration** | LED strips jitter on impact | Add noise to light intensity during `hit` mode |
| **Playfield Recoil** | Subtle table mesh deformation | Vertex animation or material offset (advanced) |
| **Hologram Distortion** | Hologram flickers on ball catch | Animate hologram material alpha/shader params |

**Babylon.js Animation Approach:**
```typescript
// Camera shake - applied as offset to existing camera position
private triggerCameraShake(intensity: number, duration: number): void {
  if (!this.camera) return
  
  const baseAlpha = this.camera.alpha
  const baseBeta = this.camera.beta
  
  // Create shake animation
  const shakeAnim = new Animation(
    "cameraShake",
    "alpha",
    60,
    Animation.ANIMATIONTYPE_FLOAT,
    Animation.ANIMATIONLOOPMODE_CONSTANT
  )
  
  // Generate noise keys
  const keys = []
  const frames = Math.floor(duration * 60)
  for (let i = 0; i <= frames; i++) {
    const decay = 1 - (i / frames)
    const noise = (Math.random() - 0.5) * intensity * decay
    keys.push({ frame: i, value: baseAlpha + noise })
  }
  
  shakeAnim.setKeys(keys)
  this.camera.animations = [shakeAnim]
  this.scene.beginAnimation(this.camera, 0, frames, false)
}
```

**What Must NOT Change:**
- Camera target must remain fixed on gameplay
- Shake must not cause motion sickness (keep subtle: < 0.1 rad)
- Must not affect physics object culling

---

### 2.4 Impact Visual Effects (Enhanced)

#### Current State
- Shard burst: 8 cubes, 1 second lifetime
- Bloom flash: 2.0 energy for brief period
- Bumper scale pop: 0.2s duration

#### Enhancement Opportunities

| Enhancement | Description | Implementation Approach |
|-------------|-------------|------------------------|
| **Impact Rings** | Expanding ring decal on collision surface | Spawn torus mesh, animate scale + fade |
| **Particle Rotation** | Shards tumble as they fly | Add angular velocity to shard physics |
| **Particle Scale Fade** | Shrink to zero over lifetime | Animate mesh scaling in `updateShards()` |
| **Combo Trail Colors** | Trail shifts through rainbow on combo | Use combo count to index palette array |
| **Ball Spin Trails** | Visual indication of ball rotation | Add particle emitters to ball surface |

**Babylon.js Animation Approach - Impact Ring:**
```typescript
private spawnImpactRing(position: Vector3, normal: Vector3, color: string): void {
  const ring = MeshBuilder.CreateTorus("impactRing", {
    diameter: 0.5,
    thickness: 0.05,
    tessellation: 32
  }, this.scene)
  
  ring.position = position.clone()
  ring.lookAt(position.add(normal))
  
  const mat = new StandardMaterial("ringMat", this.scene)
  mat.emissiveColor = Color3.FromHexString(color)
  mat.alpha = 0.8
  ring.material = mat
  
  // Animate expansion and fade
  const scaleAnim = new Animation("ringScale", "scaling", 60, 
    Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT)
  const fadeAnim = new Animation("ringFade", "material.alpha", 60,
    Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT)
  
  scaleAnim.setKeys([
    { frame: 0, value: new Vector3(1, 1, 1) },
    { frame: 20, value: new Vector3(5, 5, 1) }
  ])
  
  fadeAnim.setKeys([
    { frame: 0, value: 0.8 },
    { frame: 20, value: 0 }
  ])
  
  ring.animations = [scaleAnim, fadeAnim]
  
  // Cleanup after animation
  this.scene.beginAnimation(ring, 0, 20, false, 1, () => {
    ring.dispose()
  })
}
```

---

### 2.5 Ball Catch/Hologram Mechanics Enhancement

#### Current State
- Ball turns red when caught (`emissiveColor = new Color3(1, 0, 0)`)
- Linear interpolation to target position
- Simple impulse release with random velocity

#### Enhancement Opportunities

| Enhancement | Description | Implementation Approach |
|-------------|-------------|------------------------|
| **Catch Vortex** | Swirling particles around caught ball | Particle system attached to ball mesh |
| **Energy Buildup** | Ball glows brighter as catch timer counts down | Animate emissive intensity in `updateCaughtBalls()` |
| **Release Burst** | Explosion of particles on release | Spawn burst at release position |
| **Trajectory Preview** | Ghost trail showing release path | Calculate predicted path, render line |
| **Hologram Pulse** | Hologram scales with "heartbeat" | Sine wave scale animation synced to timer |

**Babylon.js Animation Approach:**
```typescript
// In updateCaughtBalls() - energy buildup animation
if (mesh && mesh.material) {
  const timeRatio = 1 - (catchData.timer / 4.0) // 0 to 1
  const pulseIntensity = 1.0 + Math.sin(timeRatio * Math.PI * 4) * 0.3
  const baseColor = new Color3(1, 0, 0)
  
  // Intensify as release approaches
  ;(mesh.material as PBRMaterial).emissiveColor = 
    baseColor.scale(pulseIntensity * (1 + timeRatio))
}
```

---

## 3. Proposed Implementation Approach

### 3.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    VISUAL ANIMATION LAYER                    │
│  (Pure cosmetic - no physics influence)                     │
├─────────────────────────────────────────────────────────────┤
│  BallAnimator        TrailAnimator       ImpactAnimator     │
│  ├── squash/stretch  ├── velocity-width  ├── ring effects  │
│  ├── spin trails     ├── color-shift     ├── camera shake  │
│  └── catch glow      └── fade effects    └── particle burst │
└─────────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────────┐
│                    EXISTING SYSTEMS                          │
│  BallManager ── PhysicsBinding ── Rapier RigidBody         │
│  EffectsSystem ── ShardParticle ── Visual Effects          │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 File Organization

**Option A: New Module (Recommended)**
```
src/game-elements/
├── ball-animator.ts      # Ball squash/stretch, spin trails
├── trail-enhancer.ts     # Trail width/color modulation
├── impact-fx.ts          # Impact rings, camera shake
└── animation-utils.ts    # Shared easing, cleanup helpers
```

**Option B: Extend Existing**
- Add methods to `EffectsSystem` for impact effects
- Add methods to `BallManager` for ball-specific animations
- Keep changes localized to existing files

### 3.3 Integration Points

| Hook Location | Current Code | Animation Addition |
|--------------|--------------|-------------------|
| `game.ts:1040` | `activateBumperHit(bump)` | Add `triggerImpactAnimation(ballMesh, bumperPos)` |
| `game.ts:1044` | `spawnShardBurst(vis.mesh.position)` | Add `spawnImpactRing()` + `triggerCameraShake()` |
| `ball-manager.ts:215` | `updateCaughtBalls(dt, onRelease)` | Add energy buildup + vortex particles |
| `game.ts:931-937` | Physics sync loop | Add velocity-based trail modulation |

### 3.4 Babylon.js Animation System Usage

**When to use Animation vs. Manual Update:**

| Use Case | Recommended Approach | Reason |
|----------|---------------------|--------|
| One-shot effects (squash, ring) | `BABYLON.Animation` with `beginAnimation()` | Automatic cleanup, easing functions |
| Continuous modulation (trails) | Manual update in sync loop | Needs physics state every frame |
| Particle systems | `ParticleSystem` or manual mesh pool | Better performance for many objects |
| Camera effects | `Animation` with `onAnimationEnd` cleanup | Must restore exact camera state |

**Cleanup Strategy:**
```typescript
// Always cleanup animations to prevent memory leaks
animation.onAnimationEndObservable.add(() => {
  mesh.animations = []
  if (mesh.isDisposed() === false) {
    mesh.scaling = new Vector3(1, 1, 1) // Reset to safe state
  }
})
```

---

## 4. Risk Assessment

### 4.1 HIGH RISK (Must Avoid)

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Modifying physics velocities** | Gameplay timing changes, scoring bugs | Strict separation: animation layer NEVER touches `rigidBody.linvel()` |
| **Blocking physics thread** | Frame drops, unresponsive gameplay | All animations run on render thread only |
| **Memory leaks from meshes** | Performance degradation over time | Use `Mesh.dispose()`, `Animation` cleanup callbacks |
| **Camera shake causing nausea** | Player discomfort | Keep shake < 0.05 rad, < 0.3s duration |

### 4.2 MEDIUM RISK (Monitor)

| Risk | Impact | Mitigation |
|------|--------|------------|
| **TrailMesh performance with many balls** | Frame rate drop | Limit trails to main ball only, or LOD based on distance |
| **Particle count during fever mode** | GPU fill-rate bound | Cap max particles, use object pooling |
| **Bloom flickering on rapid hits** | Visual distraction | Smooth bloom energy transitions with `lerp` |
| **Animation desync with slow-motion** | Visuals don't match physics | Scale animation speed by `dt` |

### 4.3 LOW RISK (Acceptable)

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Squash animation slightly clips bumper** | Minor visual artifact | Keep squash < 30% scale, short duration |
| **Trail color changes too subtle** | Players don't notice | Test with high contrast palette |
| **Impact rings overlap** | Visual clutter | Limit one ring per bumper per 0.5s |

### 4.4 What Must NOT Change (Immutable)

**Physics Layer (Untouchable):**
```typescript
// THESE MUST NEVER BE MODIFIED BY ANIMATION CODE:
- rigidBody.setLinvel()
- rigidBody.setAngvel()
- rigidBody.applyImpulse()
- rigidBody.setTranslation() (except in hologram catch)
- ColliderDesc properties
- World.step() timing
```

**Gameplay Logic (Untouchable):**
```typescript
// THESE MUST NEVER BE MODIFIED BY ANIMATION CODE:
- Score calculations
- Collision detection logic
- GameState transitions
- Timer values (except visual countdowns)
- Random seeding for gameplay
```

**Timing-Critical Code (Untouchable):**
```typescript
// In game.ts:998-1070 - processCollision()
// Current collision handling must remain exact
// Visual enhancements only AFTER all physics/scoring logic
```

---

## 5. Implementation Priority

### Phase 1: Low Risk, High Impact
1. **Impact squash-and-stretch** - Immediate game feel improvement
2. **Enhanced shard particles** - Add rotation, scale fade
3. **Impact rings** - Visual clarity on collision point

### Phase 2: Medium Risk, High Polish
4. **Velocity-based trail modulation** - Dynamic feedback
5. **Camera shake on big impacts** - Cinematic feel
6. **Hologram catch vortex** - Special moment emphasis

### Phase 3: Advanced Features
7. **Extra ball trails** - Visual consistency
8. **Combo color shifts** - Reward feedback
9. **Trajectory preview** - Strategic aid

---

## 6. Code Style Guidelines

**When implementing animations:**

1. **Always use Babylon.js Animation system** for one-shot effects (squash, rings)
2. **Always cleanup** - Use `onAnimationEndObservable` to dispose/reset
3. **Always respect dt** - Scale animations by delta time for slow-motion compatibility
4. **Never modify physics** - Keep animation layer strictly visual
5. **Profile before/after** - Use Chrome DevTools to verify < 1ms impact per frame

---

## 7. Summary

The pachinball project has solid foundations for animation polish. The key insight is that **all enhancements can be implemented as purely cosmetic overlays** without touching the physics simulation or gameplay timing.

**Recommended First Steps:**
1. Create `src/game-elements/ball-animator.ts` with squash-and-stretch
2. Add impact ring effect to `EffectsSystem.spawnShardBurst()`
3. Enhance shard particles with rotation and scale fade

**Success Metrics:**
- Frame time increase < 0.5ms per frame
- No changes to physics velocities or collision detection
- Visual feedback feels "juicier" without changing game balance

---

*End of Audit*
