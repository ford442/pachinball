# Collision Detection Audit Report
## Pachinball - Rapier3D Spatial Queries & Collision Response

---

## 1. Current State Summary

### Architecture Overview

**Physics World Setup** (`physics.ts`):
- Single `World` with gravity `{x: 0, y: -9.81, z: -5.0}`
- `EventQueue` with `true` (intersection tests enabled)
- Simple `step()` → `drainCollisionEvents()` pattern

**Collision Processing Flow** (`game.ts:911-1070`):
```
stepPhysics()
  ├── physics.step() → drains EventQueue
  │     └── callback: processCollision(h1, h2, started)
  │           ├── Adventure sensor check (body reference equality)
  │           ├── Death zone check (body reference equality)
  │           ├── Bumper collision (array.find + height check)
  │           └── Target collision (array.find)
  ├── Sync visual meshes
  └── Update game systems
```

**Collider Configuration** (`game-objects.ts`, `ball-manager.ts`):
| Object | Shape | Events | Notes |
|--------|-------|--------|-------|
| Ball | Sphere | COLLISION + CONTACT_FORCE | CCD enabled, density-based mass |
| Bumper | Sphere (physics) + Cylinder (sensor) | COLLISION | Hologram sensor at y+2 |
| Pins | Cylinder | None | Fixed, restitution 0.5 |
| Walls | Cuboid | None | Fixed, friction 0.3 |
| Flippers | Cuboid | None | Dynamic, revolute joints, CCD |
| Death Zone | Cuboid | COLLISION | Sensor |
| Slingshot | Cuboid | COLLISION | Restitution 1.5 |

### Critical Observations

1. **Contact Force Events Subscribed but Unused**: Ball colliders request `CONTACT_FORCE_EVENTS` but `processCollision` never accesses force data
2. **O(N) Body Lookups**: Every collision does `array.find()` on bumper/target arrays
3. **No Collision Groups**: All objects collide with all others (default Rapier behavior)
4. **Variable Timestep**: `dt` from render frame directly fed to physics (no fixed timestep)
5. **Height-Based Logic**: `ballPos.y > 1.5` for hologram catch is fragile

---

## 2. Opportunities (Prioritized by Impact/Safety)

### 🔴 HIGH IMPACT / LOW RISK

#### Opportunity #1: Fixed Timestep Physics
- **Category**: Optimization
- **Current**: Variable `dt` from `engine.getDeltaTime()` passed directly to physics
- **Opportunity**: Implement accumulator pattern for deterministic physics
```typescript
// In game.ts
private accumulator = 0
private fixedDt = 1/60 // 60Hz physics

private stepPhysics(): void {
  if (this.state !== GameState.PLAYING) return
  
  const dt = this.engine.getDeltaTime() / 1000
  this.accumulator += dt
  
  while (this.accumulator >= this.fixedDt) {
    this.physics.step((h1, h2, start) => {
      if (!start) return
      this.processCollision(h1, h2)
    })
    this.accumulator -= this.fixedDt
  }
  
  // Interpolate visuals between physics states
  const alpha = this.accumulator / this.fixedDt
  this.syncVisuals(alpha)
}
```
- **Physics Gain**: Determinism, prevents tunneling at low FPS
- **Gameplay Safety**: ✅ Maintains existing feel, actually improves consistency
- **Risk Level**: Low

---

#### Opportunity #2: Contact Force Magnitude for Impact Effects
- **Category**: Response
- **Current**: `CONTACT_FORCE_EVENTS` subscribed but ignored
- **Opportunity**: Use actual impulse magnitude for hit intensity
```typescript
// In physics.ts - extend step to capture contact forces
step(callback: CollisionCallback, forceCallback?: ForceCallback): void {
  if (!this.world || !this.eventQueue) return
  this.world.step(this.eventQueue)
  this.eventQueue.drainCollisionEvents(callback)
  this.eventQueue.drainContactForceEvents(forceCallback) // Add this
}

// In game.ts - impact-aware processing
private processContactForce(h1: number, h2: number, force: number): void {
  if (force < 5) return // Ignore gentle touches
  
  const world = this.physics.getWorld()
  const b1 = world.getRigidBody(h1)
  const b2 = world.getRigidBody(h2)
  
  // Intensity-based effects
  const intensity = Math.min(force / 50, 1.0) // Normalize 0-1
  this.effects?.setBloomEnergy(intensity * 3)
  
  // Hard impacts = screen shake
  if (force > 30) {
    this.effects?.triggerCameraShake(force / 100)
  }
}
```
- **Physics Gain**: Visual feedback proportional to actual physics
- **Gameplay Safety**: ✅ Enhances existing effects without changing gameplay
- **Risk Level**: Low

---

#### Opportunity #3: Collision Groups for Filtering
- **Category**: Filtering
- **Current**: All objects collide with everything (default Rapier behavior)
- **Opportunity**: Define collision groups to reduce unnecessary pairs
```typescript
// In game-elements/types.ts or new collision-groups.ts
export enum CollisionGroup {
  BALL = 1 << 0,      // 0b0001
  WALL = 1 << 1,      // 0b0010
  BUMPER = 1 << 2,    // 0b0100
  SENSOR = 1 << 3,    // 0b1000 (hologram, death zone)
  FLIPPER = 1 << 4,   // 0b0001_0000
  TARGET = 1 << 5,    // 0b0010_0000
}

// Usage in ball-manager.ts
this.world.createCollider(
  this.rapier.ColliderDesc.ball(GameConfig.ball.radius)
    .setCollisionGroups(
      (CollisionGroup.BALL << 16) | // memberships
      (CollisionGroup.WALL | CollisionGroup.BUMPER | CollisionGroup.FLIPPER | CollisionGroup.TARGET) // filters
    )
    .setActiveEvents(...),
  ballBody
)

// Death zone only collides with balls
this.world.createCollider(
  this.rapier.ColliderDesc.cuboid(20, 2, 2)
    .setSensor(true)
    .setCollisionGroups(
      (CollisionGroup.SENSOR << 16) | 
      CollisionGroup.BALL
    )
    .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
  this.deathZoneBody
)
```
- **Physics Gain**: Reduced broad-phase pairs, clearer collision intent
- **Gameplay Safety**: ✅ No behavior change, internal optimization
- **Risk Level**: Low

---

### 🟡 MEDIUM IMPACT / LOW RISK

#### Opportunity #4: Spatial Query for Hologram Catch (Replace Height Check)
- **Category**: Spatial Queries
- **Current**: `ballPos.y > 1.5` hardcoded check
- **Opportunity**: Use actual sensor collider intersection
```typescript
// In game.ts - remove y > 1.5 check, use collision metadata
// Add user data to colliders for type identification

// In game-objects.ts - bumper creation
const bumperCollider = this.world.createCollider(
  this.rapier.ColliderDesc.ball(0.4)
    .setRestitution(this.config.physics.bumperRestitution)
    .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
  body
)
bumperCollider.setUserData({ type: 'bumper', id: index })

const sensorCollider = this.world.createCollider(
  this.rapier.ColliderDesc.cylinder(1.5, 0.5)
    .setSensor(true)
    .setTranslation(0, 2.0, 0)
    .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
  body
)
sensorCollider.setUserData({ type: 'hologram_sensor', parentBumper: index })

// In game.ts - cleaner collision handling
private processCollision(h1: number, h2: number): void {
  const world = this.world
  const c1 = world.getCollider(h1) // Note: need collider handles, not body
  const c2 = world.getCollider(h2)
  
  const data1 = c1?.getUserData() as CollisionData | undefined
  const data2 = c2?.getUserData() as CollisionData | undefined
  
  if (data1?.type === 'hologram_sensor' || data2?.type === 'hologram_sensor') {
    // Definitive hologram catch - no height approximation
    this.activateHologramCatch(ballBody, bumperBody)
  }
}
```
- **Physics Gain**: Precise spatial detection, no false positives
- **Gameplay Safety**: ✅ More accurate than current height check
- **Risk Level**: Low (requires switching to collider handles)

---

#### Opportunity #5: Body Handle Caching (Remove O(N) Lookups)
- **Category**: Optimization
- **Current**: `bumperBodies.find(b => b === b1 || b === b2)` every collision
- **Opportunity**: Map handles to collision types at startup
```typescript
// In game.ts
private collisionMap = new Map<number, CollisionInfo>()

private buildCollisionMap(): void {
  // Build once after all objects created
  const world = this.physics.getWorld()
  
  // Iterate all colliders, map handles to types
  world.forEachCollider((collider) => {
    const userData = collider.getUserData() as CollisionData | undefined
    if (userData) {
      this.collisionMap.set(collider.handle, {
        type: userData.type,
        body: collider.parent()!,
        data: userData
      })
    }
  })
}

private processCollision(h1: number, h2: number): void {
  const info1 = this.collisionMap.get(h1)
  const info2 = this.collisionMap.get(h2)
  
  if (info1?.type === 'death_zone' || info2?.type === 'death_zone') {
    const ball = info1?.type === 'death_zone' ? info2?.body : info1?.body
    if (ball) this.handleBallLoss(ball)
  }
  // ... similar for other types - O(1) lookups
}
```
- **Physics Gain**: O(1) collision identification vs O(N) array scans
- **Gameplay Safety**: ✅ Internal optimization only
- **Risk Level**: Low

---

### 🟢 MEDIUM IMPACT / MEDIUM RISK

#### Opportunity #6: Raycast Ball Trajectory Prediction
- **Category**: Prediction
- **Current**: No prediction for gameplay mechanics
- **Opportunity**: Raycast for aim assist or AI flipper timing
```typescript
// In game.ts or new trajectory-predictor.ts
checkFlipperTiming(flipperPos: Vector3): boolean {
  const ball = this.ballManager?.getBallBody()
  if (!ball) return false
  
  const vel = ball.linvel()
  const pos = ball.translation()
  
  // Ball moving toward flipper?
  if (vel.z > 0) return false // Moving away
  
  // Cast ray in velocity direction
  const rayOrigin = { x: pos.x, y: 0.5, z: pos.z }
  const rayDir = { x: vel.x, y: 0, z: vel.z }
  
  const hit = this.world.castRay(
    new this.rapier.Ray(rayOrigin, rayDir),
    10, // max distance
    true, // solid
    CollisionGroup.BALL, // filter
    null,
    null
  )
  
  if (hit) {
    const hitPoint = hit.pointOfImpact
    const timeToImpact = hit.timeOfImpact
    
    // Trigger flipper if ball will hit within reasonable window
    return timeToImpact < 0.5 && Math.abs(hitPoint.x - flipperPos.x) < 2
  }
  return false
}
```
- **Physics Gain**: Enables predictive gameplay features
- **Gameplay Safety**: ⚠️ Only for AI/assist, doesn't affect physics
- **Risk Level**: Medium (adds complexity)

---

#### Opportunity #7: Shape Casts for Flipper Validation
- **Category**: Prediction
- **Current**: Flippers can clip through ball at high velocities
- **Opportunity**: Shape cast before large flipper movements
```typescript
// In flipper control
flip(flipperJoint: RAPIER.RevoluteImpulseJoint, direction: 'up' | 'down'): void {
  const targetAngle = direction === 'up' ? Math.PI/4 : -Math.PI/4
  
  // Before applying motor, check if flipper path is clear
  const currentAngle = flipperJoint.currentAngle()
  const angularDelta = targetAngle - currentAngle
  
  if (Math.abs(angularDelta) > 0.1) {
    // Simple sphere cast at flipper tip position
    const tipPos = this.calculateFlipperTipPosition(currentAngle + angularDelta)
    const hit = this.world.castShape(
      tipPos,
      { x: 0, y: 1, z: 0, w: 0 }, // rotation
      { x: 0, y: -1, z: 0 }, // velocity
      new this.rapier.Ball(0.3), // flipper tip shape
      0.5, // max distance
      true,
      CollisionGroup.FLIPPER
    )
    
    // Even if hit, we flip - but this data could adjust flipper strength
  }
  
  flipperJoint.configureMotorPosition(targetAngle, strength, damping)
}
```
- **Physics Gain**: Better handling of rapid flipper-ball interactions
- **Gameplay Safety**: ⚠️ May slightly change flipper feel if over-constrained
- **Risk Level**: Medium

---

### 🔵 LOWER PRIORITY / HIGHER RISK

#### Opportunity #8: AABB Query for Multiball Proximity
- **Category**: Spatial Queries
- **Current**: No proximity-based gameplay features
- **Opportunity**: Detect clustered balls for combo bonuses
```typescript
// In game.ts - multiball proximity detection
checkBallClusters(): void {
  const balls = this.ballManager?.getBallBodies() || []
  if (balls.length < 2) return
  
  const clusters: RAPIER.RigidBody[][] = []
  
  for (let i = 0; i < balls.length; i++) {
    const pos = balls[i].translation()
    
    // AABB query around ball
    const aabb = new this.rapier.AABB(
      { x: pos.x - 2, y: pos.y - 1, z: pos.z - 2 },
      { x: pos.x + 2, y: pos.y + 1, z: pos.z + 2 }
    )
    
    const nearby: RAPIER.RigidBody[] = []
    this.world.intersectionsWithAABB(aabb, (collider) => {
      const body = collider.parent()
      if (body && balls.includes(body) && body !== balls[i]) {
        nearby.push(body)
      }
      return true
    })
    
    if (nearby.length >= 2) {
      this.triggerClusterBonus(nearby)
    }
  }
}
```
- **Physics Gain**: Enables new gameplay mechanics
- **Gameplay Safety**: ⚠️ New feature, not existing behavior
- **Risk Level**: Medium (new systems always have risk)

---

## 3. Recommended Implementation Order

| Priority | Opportunity | Effort | Impact | Risk |
|----------|-------------|--------|--------|------|
| 1 | **Fixed Timestep** (#1) | 2 hrs | High | Low |
| 2 | **Collision Groups** (#3) | 3 hrs | Medium | Low |
| 3 | **Body Handle Caching** (#5) | 2 hrs | Medium | Low |
| 4 | **Contact Force Effects** (#2) | 4 hrs | Medium | Low |
| 5 | **Spatial Hologram Query** (#4) | 3 hrs | Medium | Low |

### Implementation Notes

**Phase 1 (Immediate)** - Fixed Timestep:
- Replace variable `dt` with accumulator pattern
- Add optional interpolation for visual smoothness
- Test at various framerates (30, 60, 120 FPS)

**Phase 2 (Short Term)** - Collision Groups:
- Define groups in `types.ts`
- Apply to all collider creation sites
- Verify no regressions in collision behavior

**Phase 3 (Short Term)** - Handle Caching:
- Add `userData` to all colliders with type info
- Build collision map after level initialization
- Refactor `processCollision` to use map lookups

**Phase 4 (Medium Term)** - Contact Forces:
- Extend physics system to drain force events
- Implement intensity-scaled effects
- Tune thresholds for gameplay feel

**Phase 5 (Medium Term)** - Spatial Queries:
- Replace height check with collider-based detection
- Validate hologram catch behavior matches current

---

## Summary

The current collision system is functional but lacks optimization and precision features. The **fixed timestep** is the highest-value, lowest-risk improvement that should be implemented immediately. **Collision groups** and **handle caching** provide measurable performance benefits with minimal risk. Contact force integration and spatial queries add polish and precision. Predictive features (raycasts, shape casts) are nice-to-have but not critical for core gameplay.
