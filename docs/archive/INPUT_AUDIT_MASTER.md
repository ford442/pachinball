# Input Handling & Control Pipeline Audit - Master Report
## Pachinball: Perceived Latency & Tactile Feedback Analysis

---

## Executive Summary

This master audit synthesizes findings from 5 specialized input auditors examining the input handling and control pipeline for opportunities to minimize perceived latency and enhance tactile feedback across browsers and devices. The current input system demonstrates functional keyboard and touch support but presents **42 optimization opportunities** across five domains.

### Key Metrics
| Domain | Opportunities | Critical | High Impact |
|--------|--------------|----------|-------------|
| Input Latency | 8 | 1 | 5 |
| Haptic Feedback | 8 | 0 | 5 |
| Cross-Device | 9 | 1 | 6 |
| Responsiveness | 6 | 2 | 5 |
| Accessibility | 11 | 1 | 7 |
| **TOTAL** | **42** | **5** | **28** |

### Immediate Actions (Zero Risk)
1. **Fix touch release handlers** - Critical bugfix (stuck flippers)
2. **Add CSS touch-action** - Eliminate iOS 300ms delay
3. **Replace Slash with KeyM** - Fix non-QWERTY keyboard layouts
4. **Add input buffering** - Prevent dropped inputs
5. **Implement nudge system** - Currently stubbed/non-functional

### Architecture Assessment
**Strengths:**
- Clean separation in `InputHandler` class
- Event-driven architecture
- Existing accessibility foundation (reduced motion, photosensitive mode)
- Settings persistence via localStorage

**Critical Gaps:**
- Touch events lack release handlers (flippers get stuck)
- Nudge system is completely non-functional
- No input buffering (rapid presses lost)
- No haptic feedback (vibration API unused)
- Hardcoded keys break on non-QWERTY layouts

---

## 1. Input Latency Findings

### Current State
| Metric | Current | Target |
|--------|---------|--------|
| Best-case latency | ~2-5ms | ~2-5ms (good) |
| Worst-case latency | ~20ms | ~16ms (1 frame) |
| Jitter | ±16ms | ±0ms (buffered) |
| Dropped inputs | Possible | None (buffered) |

### Top 5 Latency Opportunities

#### 1. Touch Event Completion (Critical Fix) ⭐ IMPLEMENT FIRST
```typescript
// Add touchend/touchcancel handlers
leftBtn?.addEventListener('touchend', (e) => {
  e.preventDefault()
  this.onFlipperLeft(false)
})
```
- **Impact**: Fixes stuck flippers on mobile
- **Risk**: None - critical bugfix
- **Time**: 30 minutes

#### 2. 1-Frame Input Buffering
```typescript
// Buffer inputs for next physics frame
private inputBuffer: InputFrame[] = []
processBufferedInputs(): InputFrame {
  return this.drainPendingInputs()
}
```
- **Impact**: Eliminates jitter, prevents dropped inputs
- **Risk**: Low
- **Time**: 4 hours

#### 3. Frame-Aligned Processing
```typescript
// Process inputs at physics step start
private stepPhysics(): void {
  const inputFrame = this.inputHandler?.processBufferedInputs()
  if (inputFrame) this.applyInputFrame(inputFrame)
  this.physics.step(/* ... */)
}
```
- **Impact**: Consistent 16ms latency
- **Risk**: Low
- **Time**: 2 hours

#### 4. CSS Touch-Action Optimization
```css
#pachinball-canvas {
  touch-action: none;
  -webkit-touch-callout: none;
}
```
- **Impact**: Eliminates iOS 300ms delay
- **Risk**: None
- **Time**: 15 minutes

#### 5. Pointer API Migration
```typescript
// Unified mouse/touch/pen handling
canvas.addEventListener('pointerdown', (e) => {
  const x = (e.clientX - rect.left) / rect.width
  if (x < 0.5) this.onFlipperLeft(true)
  else this.onFlipperRight(true)
})
```
- **Impact**: Consistent cross-device behavior
- **Risk**: Medium
- **Time**: 3 hours

---

## 2. Haptic Feedback Findings

### Current State
| Feature | Status | Browser Support |
|---------|--------|-----------------|
| Web Vibration API | ❌ Not implemented | Chrome, Edge, Firefox, Android |
| Gamepad Haptics | ❌ Not implemented | Chrome, Edge (partial) |
| Visual Feedback | ✅ Active | All |
| Audio Feedback | ✅ Active | All |

### Top 5 Haptic Opportunities

#### 1. Flipper Activation (15ms tap) ⭐ IMPLEMENT FIRST
```typescript
private triggerHaptic(pattern: number | number[]): void {
  if (!GameConfig.accessibility.hapticsEnabled) return
  if (navigator.vibrate) navigator.vibrate(pattern)
}
// Usage: this.triggerHaptic(15) // 15ms sharp tap
```
- **Impact**: Immediate control confirmation
- **Risk**: None - additive only
- **Time**: 30 minutes

#### 2. Bumper Impact (intensity-mapped)
```typescript
const intensity = Math.floor((impulse / 30) * 50) + 10
navigator.vibrate([intensity, 5, intensity / 2])
```
- **Impact**: Physical collision sensation
- **Risk**: None
- **Time**: 1 hour

#### 3. User Preferences
```typescript
accessibility: {
  hapticsEnabled: true,
  hapticIntensity: 1.0 // 0.0 to 2.0
}
```
- **Impact**: User control, accessibility compliance
- **Risk**: None
- **Time**: 1 hour

#### 4. Plunger Release Pattern
```typescript
// Spring-tension pattern
navigator.vibrate([30, 10, 60]) // Wind-up, gap, launch
```
- **Impact**: Satisfying mechanical feel
- **Risk**: None
- **Time**: 30 minutes

#### 5. Tilt Warning Rumble
```typescript
// Low-frequency feel via rapid pulses
navigator.vibrate([20, 10, 20, 10, 20, 10, 20])
```
- **Impact**: Distinct danger signal
- **Risk**: None
- **Time**: 30 minutes

---

## 3. Cross-Device Findings

### Current Support Matrix
| Feature | Desktop | Mobile | Tablet | Gamepad |
|---------|---------|--------|--------|---------|
| Flippers | ✅ | ⚠️* | ✅ | ❌ |
| Plunger | ✅ | ✅ | ✅ | ❌ |
| Nudge | ✅ | ❌ | ❌ | ❌ |
| Pause | ✅ | ❌ | ❌ | ❌ |

*Touch lacks release handling

### Top 5 Cross-Device Opportunities

#### 1. Touch Release Handlers (Critical Fix) ⭐ IMPLEMENT FIRST
- Same as Latency Opportunity #1
- **Impact**: Prevents stuck flippers
- **Risk**: None
- **Time**: 30 minutes

#### 2. Keyboard Layout Normalization
```typescript
// Replace problematic 'Slash' with 'KeyM'
if (event.code === 'ArrowRight' || event.code === 'KeyM')
```
- **Impact**: AZERTY, QWERTZ support
- **Risk**: None
- **Time**: 5 minutes

#### 3. Gamepad API Support
```typescript
private readonly GAMEPAD_MAPPING = {
  leftFlipper: [4, 6],  // LB, LT
  rightFlipper: [5, 7], // RB, RT
  plunger: [0]          // A/Cross
}
```
- **Impact**: Xbox/PS controller support
- **Risk**: Medium
- **Time**: 3 hours

#### 4. Device Orientation for Nudge
```typescript
window.addEventListener('deviceorientation', (e) => {
  const tiltX = e.gamma || 0
  if (Math.abs(tiltX) > 15) {
    this.onNudge(new this.rapier!.Vector3(tiltX > 0 ? 0.6 : -0.6, 0, 0.3))
  }
})
```
- **Impact**: Natural mobile nudge
- **Risk**: Medium (sensitivity tuning)
- **Time**: 2 hours

#### 5. Touch Gesture System
```typescript
// Swipe detection for nudge
if (Math.abs(dx) > 50 && dt < 200) {
  const direction = dx > 0 ? 0.6 : -0.6
  this.onNudge(new this.rapier!.Vector3(direction, 0, 0.3))
}
```
- **Impact**: Intuitive mobile controls
- **Risk**: Medium
- **Time**: 2 hours

---

## 4. Control Responsiveness Findings

### Current Control State
| Control | Status | Issue |
|---------|--------|-------|
| Flippers | ⚠️ Basic | No velocity-based hit quality |
| Plunger | 🔴 Poor | No charge mechanic |
| Nudge | 🔴 **Broken** | `applyNudge()` is stub |
| Input Buffering | ❌ Missing | Drops inputs during transitions |

### Top 5 Responsiveness Opportunities

#### 1. Nudge Implementation (Critical) ⭐ IMPLEMENT FIRST
```typescript
private applyNudge(direction: RAPIER.Vector3): void {
  if (this.tiltActive) return
  
  const ballBody = this.ballManager?.getBallBody()
  if (!ballBody) return
  
  const impulse = new this.physics.getRapier()!.Vector3(
    direction.x * GameConfig.nudge.force,
    GameConfig.nudge.verticalBoost,
    direction.z * GameConfig.nudge.force
  )
  ballBody.applyImpulse(impulse, true)
}
```
- **Impact**: Restores core mechanic
- **Risk**: Low
- **Time**: 2-3 hours

#### 2. Plunger Charge Mechanic
```typescript
private plungerCharge = 0
private updatePlungerCharge(dt: number): void {
  if (this.isPlungerHeld) {
    this.plungerCharge = Math.min(
      this.plungerCharge + GameConfig.plunger.chargeRate * dt,
      GameConfig.plunger.maxImpulse
    )
  }
}
```
- **Impact**: Skill-based analog control
- **Risk**: Low
- **Time**: 3-4 hours

#### 3. Input Buffering System
```typescript
const INPUT_BUFFER_MS = 150
private inputBuffer: BufferedInput[] = []

flushBuffer(): BufferedInput[] {
  const valid = this.inputBuffer.filter(
    i => performance.now() - i.timestamp < INPUT_BUFFER_MS
  )
  this.inputBuffer = []
  return valid
}
```
- **Impact**: Eliminates missed inputs
- **Risk**: Low
- **Time**: 2 hours

#### 4. Flipper Velocity Hit Quality
```typescript
private calculateHitQuality(angle: number, velocity: number): 'sweet' | 'late' | 'early' | 'weak' {
  if (Math.abs(velocity) < minAngularVel) return 'weak'
  if (Math.abs(angle - sweetSpotAngle) < tolerance) return 'sweet'
  return angle > sweetSpotAngle ? 'late' : 'early'
}
```
- **Impact**: Rewards precise timing
- **Risk**: Medium
- **Time**: 4-6 hours

#### 5. Flipper Pre-Activation Window
```typescript
private pendingFlipperLeft = false
private pendingFlipperTimer = 0

// 50ms window for early inputs
if (!this.ready || this.state !== GameState.PLAYING) {
  this.pendingFlipperLeft = true
  this.pendingFlipperTimer = GameConfig.flipper.preActivationWindow // 50ms
}
```
- **Impact**: "Snappier" feel without unfairness
- **Risk**: Low
- **Time**: 1-2 hours

---

## 5. Input Accessibility Findings

### WCAG 2.1 Compliance
| Guideline | Level | Status |
|-----------|-------|--------|
| 2.1.1 Keyboard | A | ⚠️ Partial |
| 2.5.5 Target Size | AAA | ❌ Fail |
| 2.5.6 Concurrent Input | AAA | ❌ Fail |

### Top 5 Accessibility Opportunities

#### 1. Layout-Independent Keys (Critical Fix) ⭐ IMPLEMENT FIRST
```typescript
// Replace 'Slash' with 'KeyM' for right flipper
if (event.code === 'ArrowRight' || event.code === 'KeyM')
```
- **Impact**: International keyboard support
- **Risk**: None
- **Time**: 5 minutes

#### 2. Key Remapping System
```typescript
input: {
  keyMap: {
    flipperLeft: ['ArrowLeft', 'KeyZ'],
    flipperRight: ['ArrowRight', 'KeyM'],
    // ... user-customizable
  }
}
```
- **Impact**: User empowerment, motor accessibility
- **Risk**: Low
- **Time**: 2-3 hours

#### 3. Single-Hand Mode
```typescript
singleHandMode: {
  keyMap: {
    flipperLeft: ['KeyA'],
    flipperRight: ['KeyD'],
    plunger: ['Space', 'KeyW']
  }
}
```
- **Impact**: One-handed play
- **Risk**: Low
- **Time**: 1-2 hours

#### 4. Sticky Keys / Toggle Mode
```typescript
input: {
  stickyKeys: {
    enabled: boolean,
    toggleDuration: number // Safety auto-release
  }
}
```
- **Impact**: Hold-free operation
- **Risk**: Low
- **Time**: 2-3 hours

#### 5. Visual Input Indicators
```typescript
visualFeedback: {
  showFlipperState: true,  // "L ● R" overlay
  highContrastIndicators: true
}
```
- **Impact**: Cognitive accessibility
- **Risk**: Low
- **Time**: 3-4 hours

---

## Implementation Roadmap

### Phase 1: Critical Fixes (Week 1)
| Priority | Item | File | Effort |
|----------|------|------|--------|
| 1 | Touch release handlers | `input.ts` | 30 min |
| 2 | CSS touch-action | `style.css` | 15 min |
| 3 | Layout-independent keys | `input.ts` | 5 min |
| 4 | Nudge implementation | `game.ts` | 2-3 hrs |
| 5 | Input buffering | `input.ts` | 2 hrs |

**Expected Outcome**: Functional mobile play, restored nudge mechanic, no dropped inputs

### Phase 2: Core Improvements (Week 2)
| Priority | Item | File | Effort |
|----------|------|------|--------|
| 6 | Flipper haptics | `input.ts` | 30 min |
| 7 | Plunger charge | `game.ts` | 3-4 hrs |
| 8 | Frame-aligned processing | `game.ts` | 2 hrs |
| 9 | Key remapping UI | `config.ts` + UI | 2-3 hrs |
| 10 | Single-hand mode | `input.ts` | 1-2 hrs |

**Expected Outcome**: Professional input feel, accessibility compliance

### Phase 3: Polish (Week 3)
| Priority | Item | Impact |
|----------|------|--------|
| 11 | Gamepad support | Controller compatibility |
| 12 | Device orientation nudge | Natural mobile feel |
| 13 | Hit quality detection | Skill-based depth |
| 14 | Visual input indicators | Cognitive accessibility |
| 15 | Sticky keys | Motor accessibility |

**Expected Outcome**: Production-ready input system

---

## Testing Protocol

After each implementation phase:

1. **Mobile Test**: iOS Safari + Android Chrome
2. **Keyboard Test**: QWERTY, AZERTY, QWERTZ layouts
3. **Latency Test**: 60fps, 30fps, 120fps targets
4. **Accessibility Test**: Screen reader, keyboard-only navigation
5. **Stress Test**: Rapid inputs, edge gestures

---

## Conclusion

The Pachinball input system has a solid foundation but **5 critical gaps** that affect playability:

1. **Touch release bug** - Flippers get stuck on mobile
2. **Non-functional nudge** - Core mechanic is stubbed
3. **No input buffering** - Rapid inputs lost
4. **Non-QWERTY broken** - Slash key varies by layout
5. **Zero haptics** - Missing tactile feedback

**Immediate wins** (touch release, CSS touch-action, KeyM fix) can be implemented in under an hour with zero risk. **Core improvements** (nudge, buffering, plunger charge) require 1-2 weeks but transform the input experience from "functional" to "polished."

**Risk Assessment**: All critical input improvements are Low or Medium risk. No opportunities require breaking changes to core gameplay mechanics.

---

## Appendix: Individual Audit Reports

- [INPUT_LATENCY_AUDIT.md](INPUT_LATENCY_AUDIT.md) - Event timing and buffering
- [INPUT_HAPTIC_AUDIT.md](INPUT_HAPTIC_AUDIT.md) - Vibration API and tactile feedback
- [INPUT_CROSS_DEVICE_AUDIT.md](INPUT_CROSS_DEVICE_AUDIT.md) - Platform compatibility
- [INPUT_RESPONSIVENESS_AUDIT.md](INPUT_RESPONSIVENESS_AUDIT.md) - Control mechanics
- [INPUT_ACCESSIBILITY_AUDIT.md](INPUT_ACCESSIBILITY_AUDIT.md) - WCAG compliance

---

*Audit completed: 2026-03-19*  
*Target: Minimize perceived latency, enhance tactile feedback*  
*Constraint: No core mechanic changes*
