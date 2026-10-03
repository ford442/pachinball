# Physics Configuration Audit Report
## Pachinball - Rapier3D Physics Material & Solver Analysis

---

### 1. Current State Summary

| Component | Configuration | Notes |
|-----------|--------------|-------|
| **World** | Gravity: `{0, -9.81, -5.0}`, EventQueue enabled | No explicit timestep or solver iterations |
| **Ball** | Mass: 1.0, Restitution: 0.7, Friction: 0.1, CCD: enabled | Density calculated from volume; no damping |
| **Pins** | Cylinder (h=0.75, r=0.1), Restitution: 0.5, Friction: 0.1 | Matches visual diameter |
| **Bumpers** | Restitution: 1.5 | No friction specified (uses default) |
| **Slingshots** | Restitution: 1.5 | Cuboid collider |
| **Walls** | Friction: 0.3 | Inconsistent with ball friction |
| **Flippers** | LinearDamping: 0.5, AngularDamping: 2, CCD: enabled | Motor: stiffness 25000, damping 1000 |
| **Ground** | Default friction | No explicit material properties |

**Current Behavior Characteristics:**
- Physics steps use variable `dt` from `engine.getDeltaTime()` without fixed timestep
- No solver iterations explicitly configured (using Rapier defaults)
- Ball has no sleep thresholds or damping (may never settle)
- Contact skin not configured (potential tunneling at high speeds)
- Wall friction (0.3) is 3x higher than ball friction (0.1)

---

### 2. Opportunities (Prioritized by Impact/Safety)

#### **OP-1: Add Solver Iterations for Flipper Stability**
- **Category**: World/Performance
- **Current**: Default (typically 4 velocity, 1 position iteration)
- **Opportunity**: Explicit solver iterations for better constraint resolution
```typescript
// In physics.ts after world creation:
this.world.integrationParameters.numSolverIterations = 8
this.world.integrationParameters.numAdditionalFrictionIterations = 4
```
- **Physics Gain**: Flipper-ball contact stability, less constraint drift
- **Gameplay Impact**: More consistent flipper hits, reduced "soft" hits
- **Risk Level**: Low

#### **OP-2: Implement Fixed Timestep with Accumulator**
- **Category**: World/Performance
- **Current**: Variable `dt` from `engine.getDeltaTime() / 1000`
- **Opportunity**: Fixed timestep for deterministic physics
```typescript
// In game.ts - add accumulator pattern:
private timeAccumulator = 0
private fixedDt = 1/120 // 120Hz physics

private stepPhysics(): void {
  if (this.state !== GameState.PLAYING) return
  
  const dt = this.engine.getDeltaTime() / 1000
  this.timeAccumulator += dt
  
  while (this.timeAccumulator >= this.fixedDt) {
    this.physics.step((h1, h2, start) => {
      if (!start) return
      this.processCollision(h1, h2)
    })
    this.timeAccumulator -= this.fixedDt
  }
  // ... rest of sync code
}
```
- **Physics Gain**: Deterministic behavior, consistent at all frame rates
- **Gameplay Impact**: Identical physics at 60fps vs 144fps
- **Risk Level**: Medium (requires testing for sub-stepping artifacts)

#### **OP-3: Add Ball Damping for Natural Roll Decay**
- **Category**: Ball
- **Current**: No linear/angular damping
- **Opportunity**: Slight damping for realistic steel ball rolling resistance
```typescript
// In ball-manager.ts:
const ballBody = this.world.createRigidBody(
  this.rapier.RigidBodyDesc.dynamic()
    .setTranslation(spawn.x, spawn.y, spawn.z)
    .setCcdEnabled(true)
    .setLinearDamping(0.05)    // NEW: Slight air resistance
    .setAngularDamping(0.1)     // NEW: Rolling resistance
)
```
- **Physics Gain**: Natural ball roll decay, prevents infinite motion
- **Gameplay Impact**: Slightly shorter ball travel time (authentic to real pinball)
- **Risk Level**: Low

#### **OP-4: Unify Wall Friction with Ball Material**
- **Category**: Colliders
- **Current**: Walls use 0.3, ball uses 0.1
- **Opportunity**: Consistent friction for "steel on wood" feel
```typescript
// In game-objects.ts createWall():
this.world.createCollider(
  this.rapier.ColliderDesc.cuboid(size.x / 2, size.y, size.z / 2)
    .setFriction(GameConfig.ball.friction) // Use 0.1 instead of 0.3
    .setRestitution(0.3), // NEW: Slight bounce for walls
  b
)
```
- **Physics Gain**: Consistent ball-wall interaction, more predictable deflections
- **Gameplay Impact**: Ball slides along walls more naturally
- **Risk Level**: Low

#### **OP-5: Configure Contact Skin for High-Speed Stability**
- **Category**: World/Performance
- **Current**: Default contact skin (0.0)
- **Opportunity**: Non-zero contact skin for CCD reliability
```typescript
// In physics.ts after world creation:
this.world.integrationParameters.contactSkin = 0.005 // 5mm skin
```
- **Physics Gain**: Reduces micro-bouncing, improves CCD reliability
- **Gameplay Impact**: Smoother ball rolling, less jitter on fast impacts
- **Risk Level**: Low

#### **OP-6: Add Sleep Thresholds for Performance**
- **Category**: Ball/Performance
- **Current**: No explicit sleep configuration
- **Opportunity**: Enable sleeping for balls at rest
```typescript
// In ball-manager.ts:
const ballBody = this.world.createRigidBody(
  this.rapier.RigidBodyDesc.dynamic()
    .setTranslation(spawn.x, spawn.y, spawn.z)
    .setCcdEnabled(true)
    .setLinearDamping(0.05)
    .setAngularDamping(0.1)
    .setCanSleep(true) // NEW
)
```
- **Physics Gain**: CPU savings when ball is stationary
- **Gameplay Impact**: None for active play; may delay response on first nudge
- **Risk Level**: Medium (test to ensure wake-up on nudge)

#### **OP-7: Add Contact Force Events Threshold**
- **Category**: Ball/Colliders
- **Current**: `CONTACT_FORCE_EVENTS` enabled without threshold
- **Opportunity**: Configure minimum impulse for contact events
```typescript
// In ball-manager.ts collider creation:
this.world.createCollider(
  this.rapier.ColliderDesc.ball(GameConfig.ball.radius)
    .setRestitution(GameConfig.ball.restitution)
    .setFriction(GameConfig.ball.friction)
    .setDensity(density)
    .setActiveEvents(
      this.rapier.ActiveEvents.COLLISION_EVENTS | 
      this.rapier.ActiveEvents.CONTACT_FORCE_EVENTS
    )
    .setContactForceEventThreshold(0.5), // NEW: Only report significant contacts
  ballBody
)
```
- **Physics Gain**: Reduced event overhead for micro-collisions
- **Gameplay Impact**: Cleaner collision event processing
- **Risk Level**: Low

#### **OP-8: Bumper Friction Configuration**
- **Category**: Colliders
- **Current**: No explicit friction on bumpers
- **Opportunity**: Add bumper friction for consistent response
```typescript
// In game-objects.ts createBumpers():
this.world.createCollider(
  this.rapier.ColliderDesc.ball(0.4)
    .setRestitution(this.config.physics.bumperRestitution)
    .setFriction(0.1) // NEW: Match ball for pure bounce
    .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
  body
)
```
- **Physics Gain**: More predictable bumper bounces
- **Gameplay Impact**: Bumper hits feel more "direct"
- **Risk Level**: Low

#### **OP-9: Flipper Joint Motor Limits Validation**
- **Category**: Joints
- **Current**: Stiffness 25000, damping 1000
- **Opportunity**: Verify motor limits aren't fighting joint limits
```typescript
// In game-objects.ts - add limits check:
jParams.limitsEnabled = true
jParams.limits = right ? [-Math.PI / 4, Math.PI / 6] : [-Math.PI / 6, Math.PI / 4]

// Consider softening motor for less aggressive snapping:
joint.configureMotorPosition(
  right ? -Math.PI / 4 : Math.PI / 4,
  GameConfig.table.flipperStrength,
  GameConfig.flipper.damping * 1.5 // Slightly higher damping for smoother motion
)
```
- **Physics Gain**: Reduced constraint fighting, smoother flipper motion
- **Gameplay Impact**: Slightly "heavier" flipper feel
- **Risk Level**: Medium (requires tuning)

#### **OP-10: Configure CCD Max Distance**
- **Category**: Ball/Performance
- **Current**: CCD enabled with defaults
- **Opportunity**: Explicit CCD parameters for ball
```typescript
// In ball-manager.ts:
const ballBody = this.world.createRigidBody(
  this.rapier.RigidBodyDesc.dynamic()
    .setTranslation(spawn.x, spawn.y, spawn.z)
    .setCcdEnabled(true)
    // Note: Rapier3D-compat may not expose all CCD parameters
)
```
- **Physics Gain**: Prevents tunneling at extreme speeds
- **Gameplay Impact**: Ball won't pass through thin colliders
- **Risk Level**: Low

---

### 3. Recommended Implementation Order

| Priority | Opportunity | Effort | Impact | Risk |
|----------|-------------|--------|--------|------|
| 1 | **OP-1: Solver Iterations** | 5 min | High stability | Low |
| 2 | **OP-5: Contact Skin** | 5 min | High stability | Low |
| 3 | **OP-3: Ball Damping** | 10 min | Natural feel | Low |
| 4 | **OP-4: Wall Friction** | 10 min | Consistency | Low |
| 5 | **OP-8: Bumper Friction** | 5 min | Predictability | Low |

**Implementation Notes:**
- OP-1 and OP-5 can be done together in `physics.ts`
- OP-3, OP-4, and OP-8 are material property changes with immediate visual feedback
- Test each change individually with the ball plunger to verify feel
- OP-2 (Fixed Timestep) is valuable but requires more extensive testing

**Testing Recommendation:**
After each change, verify:
1. Ball rolls smoothly down playfield without jitter
2. Flipper hits register consistently
3. Ball-wall bounces feel natural (not too sticky, not too slippery)
4. Multiball scenarios maintain performance
