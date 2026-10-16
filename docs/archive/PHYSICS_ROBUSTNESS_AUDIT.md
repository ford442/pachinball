## Physics Robustness Audit Report

### 1. Current State Summary

**Existing Robustness Measures:**

| Area | Current Implementation | Coverage |
|------|----------------------|----------|
| **Physics Init** | Basic try/catch during import+init (lines 14-15, physics.ts) | ⚠️ Partial - no fallback, no retry |
| **Collision Safety** | Null checks for `world`, `b1`, `b2` (lines 1000-1004, game.ts) | ✅ Good - early returns prevent crashes |
| **Ball Lifecycle** | `removeBall()` with array splice synchronization (lines 173-185, ball-manager.ts) | ⚠️ Adequate - no verification of removal |
| **Body Type Transition** | Kinematic/Dynamic switch in `activateHologramCatch()` (line 205, ball-manager.ts) | ⚠️ Risky - no validation of transition success |
| **Caught Ball Update** | Timer-based with interpolation (lines 215-239, ball-manager.ts) | ⚠️ No bounds checking on interpolation |
| **Mesh-Physics Sync** | Direct position/rotation copy (lines 929-937, game.ts) | ❌ No NaN/Infinity checks |

**Critical Gaps Identified:**

1. **No stuck-ball detection** - Balls can freeze/escape playfield indefinitely
2. **No physics state validation** - NaN/Infinity velocities unchecked
3. **No emergency reset mechanism** - WASM errors or corruption unrecoverable
4. **Missing collider handle validation** - Collision events use unchecked handles
5. **No bounds enforcement** - Caught balls can interpolate to invalid positions
6. **Silent failures** - Missing bodies in arrays don't trigger warnings

---

### 2. Opportunities (Prioritized by Impact/Safety)

#### OP1: Stuck Ball Detection with Auto-Reset
- **Category**: Detection / Recovery
- **Current**: No stuck detection; balls can remain motionless or escape bounds
- **Opportunity**: Add position/velocity monitoring with timeout-based reset
```typescript
// Add to ball-manager.ts
interface BallTracker {
  body: RAPIER.RigidBody;
  lastPosition: Vector3;
  stuckTimer: number;
  outOfBoundsTimer: number;
}

private ballTrackers = new Map<RAPIER.RigidBody, BallTracker>();
private readonly STUCK_THRESHOLD = 0.05; // meters
private readonly STUCK_TIMEOUT = 5.0; // seconds
private readonly OUT_OF_BOUNDS_TIMEOUT = 3.0; // seconds
private readonly PLAYFIELD_BOUNDS = { minY: -2, maxY: 15, minX: -15, maxX: 15, minZ: -20, maxZ: 20 };

updateBallTracking(dt: number): void {
  for (const [body, tracker] of this.ballTrackers) {
    const pos = body.translation();
    const vel = body.linvel();
    const speed = Math.sqrt(vel.x**2 + vel.y**2 + vel.z**2);
    
    // Stuck detection: very low movement over time
    const distMoved = Math.sqrt(
      (pos.x - tracker.lastPosition.x)**2 +
      (pos.y - tracker.lastPosition.y)**2 +
      (pos.z - tracker.lastPosition.z)**2
    );
    
    if (distMoved < STUCK_THRESHOLD && speed < 0.1) {
      tracker.stuckTimer += dt;
      if (tracker.stuckTimer > STUCK_TIMEOUT) {
        this.resetBall(); // Safe reset to spawn
        tracker.stuckTimer = 0;
      }
    } else {
      tracker.stuckTimer = 0;
    }
    
    // Out of bounds detection
    if (pos.y < PLAYFIELD_BOUNDS.minY || pos.y > PLAYFIELD_BOUNDS.maxY ||
        pos.x < PLAYFIELD_BOUNDS.minX || pos.x > PLAYFIELD_BOUNDS.maxX ||
        pos.z < PLAYFIELD_BOUNDS.minZ || pos.z > PLAYFIELD_BOUNDS.maxZ) {
      tracker.outOfBoundsTimer += dt;
      if (tracker.outOfBoundsTimer > OUT_OF_BOUNDS_TIMEOUT) {
        this.removeBall(body); // Safe removal
      }
    } else {
      tracker.outOfBoundsTimer = 0;
    }
    
    tracker.lastPosition.set(pos.x, pos.y, pos.z);
  }
}
```
- **Robustness Gain**: High - Prevents soft-locks from stuck/escaped balls
- **Gameplay Safety**: High - Graceful auto-reset preserves game flow
- **Risk Level**: **Low** - Non-invasive, read-only monitoring with safe actions

---

#### OP2: Physics State Validation (NaN/Infinity Guards)
- **Category**: Validation
- **Current**: No validation of physics body state; NaN can propagate
- **Opportunity**: Add validation checks before/after physics step
```typescript
// Add to physics.ts
private isValidVector3(v: { x: number, y: number, z: number }): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

private isValidQuaternion(q: { x: number, y: number, z: number, w: number }): boolean {
  return Number.isFinite(q.x) && Number.isFinite(q.y) && 
         Number.isFinite(q.z) && Number.isFinite(q.w);
}

validateBodyState(body: RAPIER.RigidBody): boolean {
  const pos = body.translation();
  const rot = body.rotation();
  const vel = body.linvel();
  const angVel = body.angvel();
  
  if (!this.isValidVector3(pos) || !this.isValidQuaternion(rot) ||
      !this.isValidVector3(vel) || !this.isValidVector3(angVel)) {
    console.error('[Physics] Invalid body state detected, resetting:', {
      pos, rot, vel, angVel
    });
    return false;
  }
  return true;
}

sanitizeBody(body: RAPIER.RigidBody, rapier: typeof RAPIER): void {
  body.setTranslation(new rapier.Vector3(0, 5, 0), true);
  body.setLinvel(new rapier.Vector3(0, 0, 0), true);
  body.setAngvel(new rapier.Vector3(0, 0, 0), true);
}
```
- **Robustness Gain**: High - Prevents physics corruption cascade
- **Gameplay Safety**: Medium - May cause visible "teleport" but prevents crash
- **Risk Level**: **Low** - Read-only validation with controlled reset

---

#### OP3: Safe Collision Event Processing
- **Category**: Edge Cases
- **Current**: Handle lookup returns potentially invalid/freed bodies
- **Opportunity**: Add collider validation and event deduplication
```typescript
// In game.ts processCollision() (lines 998-1071)
private processCollision(h1: number, h2: number): void {
  const world = this.physics.getWorld();
  if (!world) return;
  
  // NEW: Validate handles are non-zero and different
  if (h1 === 0 || h2 === 0 || h1 === h2) return;
  
  const b1 = world.getRigidBody(h1);
  const b2 = world.getRigidBody(h2);
  if (!b1 || !b2) return;
  
  // NEW: Validate bodies are still in our tracking
  const allBodies = this.ballManager?.getBallBodies() || [];
  const isKnownBody1 = allBodies.includes(b1) || this.isStaticBody(b1);
  const isKnownBody2 = allBodies.includes(b2) || this.isStaticBody(b2);
  if (!isKnownBody1 || !isKnownBody2) {
    console.warn('[Collision] Unknown body in collision event');
    return;
  }
  
  // NEW: Debounce rapid collisions (prevents physics spam)
  const now = performance.now();
  const key = h1 < h2 ? `${h1}-${h2}` : `${h2}-${h1}`;
  const lastCollision = this.collisionDebounce.get(key);
  if (lastCollision && now - lastCollision < 16) return; // Skip if < 1 frame
  this.collisionDebounce.set(key, now);
  
  // ... rest of collision handling
}
```
- **Robustness Gain**: Medium - Prevents ghost collisions and event spam
- **Gameplay Safety**: High - Silent filtering doesn't affect gameplay
- **Risk Level**: **Low** - Additional guards only, no behavior change

---

#### OP4: Safe Body Type Transitions (Caught Balls)
- **Category**: Cleanup / Edge Cases
- **Current**: Direct kinematic/dynamic switch without validation (lines 205, 228)
- **Opportunity**: Add transition state validation and rollback capability
```typescript
// In ball-manager.ts activateHologramCatch()
activateHologramCatch(ball: RAPIER.RigidBody, targetPos: Vector3, duration: number): boolean {
  // NEW: Validate ball is not already caught
  if (this.caughtBalls.some(cb => cb.body === ball)) {
    console.warn('[BallManager] Ball already caught, ignoring');
    return false;
  }
  
  // NEW: Verify body is dynamic before transition
  const originalType = ball.bodyType();
  if (originalType !== this.rapier.RigidBodyType.Dynamic) {
    console.warn('[BallManager] Cannot catch non-dynamic body');
    return false;
  }
  
  try {
    ball.setBodyType(this.rapier.RigidBodyType.KinematicPositionBased, true);
    
    // NEW: Verify transition succeeded
    if (ball.bodyType() !== this.rapier.RigidBodyType.KinematicPositionBased) {
      throw new Error('Body type transition failed');
    }
    
    this.caughtBalls.push({ 
      body: ball, 
      targetPos: targetPos.clone(), 
      timer: duration,
      originalType // Store for rollback
    });
    return true;
  } catch (e) {
    console.error('[BallManager] Failed to catch ball:', e);
    return false;
  }
}

// In updateCaughtBalls() - add safety clamp
const nextX = Math.max(-20, Math.min(20, current.x + (target.x - current.x) * 5 * dt));
const nextY = Math.max(-2, Math.min(15, current.y + (target.y - current.y) * 5 * dt));
const nextZ = Math.max(-25, Math.min(25, current.z + (target.z - current.z) * 5 * dt));
```
- **Robustness Gain**: Medium - Prevents transition glitches
- **Gameplay Safety**: High - Graceful failure with boolean return
- **Risk Level**: **Low** - Adds validation without changing core logic

---

#### OP5: Defensive Mesh-Physics Sync
- **Category**: Validation
- **Current**: Direct assignment without validation (lines 931-937)
- **Opportunity**: Add NaN/Infinity guards to sync loop
```typescript
// In game.ts update loop (lines 926-938)
for (const { mesh, rigidBody: body } of this.bindings) {
  const pos = body.translation();
  const rot = body.rotation();

  // NEW: Validate before assignment
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z) ||
      !Number.isFinite(rot.x) || !Number.isFinite(rot.y) || 
      !Number.isFinite(rot.z) || !Number.isFinite(rot.w)) {
    console.error('[Sync] Invalid transform for', mesh.name, '- skipping frame');
    continue;
  }

  // NEW: Warn on extreme values (indicates physics instability)
  if (Math.abs(pos.x) > 1000 || Math.abs(pos.y) > 1000 || Math.abs(pos.z) > 1000) {
    console.warn('[Sync] Extreme position detected:', pos);
  }

  mesh.position.set(pos.x, pos.y, pos.z);

  if (!mesh.rotationQuaternion) {
    mesh.rotationQuaternion = new Quaternion(rot.x, rot.y, rot.z, rot.w);
  } else {
    mesh.rotationQuaternion.set(rot.x, rot.y, rot.z, rot.w);
  }
}
```
- **Robustness Gain**: Medium - Prevents visual glitches and Babylon.js errors
- **Gameplay Safety**: High - Skips one frame rather than crashing
- **Risk Level**: **Low** - Non-blocking validation

---

#### OP6: Emergency Physics Reset
- **Category**: Recovery
- **Current**: No recovery from WASM errors or world corruption
- **Opportunity**: Add graceful degradation with world rebuild
```typescript
// Add to physics.ts
private resetCount = 0;
private readonly MAX_RESETS = 3;

async emergencyReset(): Promise<boolean> {
  if (this.resetCount >= MAX_RESETS) {
    console.error('[Physics] Max emergency resets exceeded');
    return false; // Signal game to show error state
  }
  
  console.warn('[Physics] Performing emergency reset...');
  this.resetCount++;
  
  try {
    this.world?.free();
    const gravity = { x: GRAVITY.x, y: GRAVITY.y, z: GRAVITY.z };
    this.world = new this.rapier!.World(gravity);
    this.eventQueue = new this.rapier!.EventQueue(true);
    return true;
  } catch (e) {
    console.error('[Physics] Emergency reset failed:', e);
    return false;
  }
}

resetResetCounter(): void {
  this.resetCount = 0; // Call on successful game restart
}
```
- **Robustness Gain**: High - Recovery path for critical failures
- **Gameplay Safety**: Medium - Requires ball/score preservation logic
- **Risk Level**: **Medium** - Complex state reconstruction needed

---

#### OP7: Cleanup Safety (Disposal Order)
- **Category**: Cleanup
- **Current**: `dispose()` only frees world; bodies may leak
- **Opportunity**: Structured cleanup with reference tracking
```typescript
// In ball-manager.ts - improve disposal
dispose(): void {
  // Remove all balls before world disposal
  for (const body of [...this.ballBodies]) {
    try {
      this.world.removeRigidBody(body);
    } catch (e) {
      console.warn('[BallManager] Failed to remove body during dispose:', e);
    }
  }
  this.ballBodies = [];
  this.caughtBalls = [];
  this.ballTrackers.clear();
  
  // Dispose meshes
  for (const binding of this.bindings) {
    binding.mesh.dispose(false, true); // Dispose material+textures
  }
  this.bindings = [];
}

// In physics.ts - ensure proper order
dispose(): void {
  // World frees automatically remove remaining bodies
  this.world?.free();
  this.world = null;
  this.eventQueue = null;
  this.rapier = null;
}
```
- **Robustness Gain**: Medium - Prevents memory leaks
- **Gameplay Safety**: High - Safe during shutdown only
- **Risk Level**: **Low** - Cleanup path only

---

### 3. Recommended Implementation Order

| Priority | Opportunity | Effort | Impact | Risk |
|----------|-------------|--------|--------|------|
| 1 | **OP3: Safe Collision Events** | Low | Medium | Low |
| 2 | **OP5: Defensive Sync** | Low | Medium | Low |
| 3 | **OP1: Stuck Ball Detection** | Medium | High | Low |
| 4 | **OP4: Safe Body Transitions** | Low | Medium | Low |
| 5 | **OP2: State Validation** | Low | High | Low |

**Rationale for Order:**
1. **OP3 First** - Collision safety guards affect all other systems; foundational
2. **OP5 Second** - Prevents visual corruption that confuses debugging
3. **OP1 Third** - High user impact (fixes common "stuck ball" complaint)
4. **OP4 Fourth** - Caught ball stability improves feature reliability
5. **OP5 Fifth** - Foundation for detecting physics corruption early

**Defer to Later (if needed):**
- **OP6 (Emergency Reset)** - Only needed if experiencing WASM crashes; higher complexity
- **OP7 (Cleanup Safety)** - Important for memory but not runtime stability
