# Cross-Device Input Compatibility Audit: Pachinball

## 1. Current State Summary

### Device Support Matrix

| Feature | Desktop | Mobile Touch | Tablet | Gamepad | Notes |
|---------|---------|--------------|--------|---------|-------|
| **Left Flipper** | ✅ ArrowLeft/KeyZ | ✅ Touch button | ✅ | ❌ | Touch lacks release handling |
| **Right Flipper** | ✅ ArrowRight/Slash | ✅ Touch button | ✅ | ❌ | Touch lacks release handling |
| **Plunger** | ✅ Space/Enter | ✅ Touch button | ✅ | ❌ | - |
| **Nudge Left** | ✅ KeyQ | ❌ Unified only | ❌ | ❌ | Touch has single nudge direction |
| **Nudge Right** | ✅ KeyE | ❌ Unified only | ❌ | ❌ | Touch has single nudge direction |
| **Nudge Up** | ✅ KeyW | ❌ Unified only | ❌ | ❌ | - |
| **Pause** | ✅ KeyP | ❌ | ❌ | ❌ | No touch pause button |
| **Reset** | ✅ KeyR | ❌ | ❌ | ❌ | No touch reset button |
| **Camera** | ✅ Mouse drag | ✅ Pinch/pan* | ✅ | ❌ | *Babylon default, not customized |

### Platform-Specific Limitations

| Platform | Issue | Impact |
|----------|-------|--------|
| **iOS Safari** | No `touch-action: manipulation` CSS | 300ms click delay possible |
| **Android Chrome** | No vibration API usage | Missing haptic feedback |
| **All Mobile** | No `touchend` handlers | Flipper may stay "stuck" if touch slides off |
| **Non-QWERTY** | Hardcoded `KeyZ`, `Slash` | AZERTY/Dvorak users have broken defaults |
| **Hybrid 2-in-1** | No pointer detection | Touch/mouse switching not optimized |

---

## 2. Opportunities (Prioritized by Impact/Safety)

### Opportunity 1: Add Touch Release Handlers (Critical Fix)
- **Category**: Workarounds
- **Current**: Only `touchstart` handlers; no `touchend`/`touchcancel`
- **Opportunity**: Add proper touch lifecycle handling
- **Code Example**:
```typescript
// In setupTouchControls():
leftBtn?.addEventListener('touchend', (e) => {
  e.preventDefault()
  this.onFlipperLeft(false)
})
leftBtn?.addEventListener('touchcancel', (e) => {
  e.preventDefault()
  this.onFlipperLeft(false)
})
// Add :active CSS for visual feedback
```
- **Compatibility Gain**: Prevents stuck flippers on all touch devices
- **Gameplay Safety**: Critical - currently breaks game on edge gestures
- **Risk Level**: Low
- **Platform Support**: All touch devices (iOS, Android, Windows Touch)

---

### Opportunity 2: CSS Touch-Action Optimization
- **Category**: Workarounds
- **Current**: No `touch-action` declarations; overlays use `pointer-events: none`
- **Opportunity**: Add explicit touch behavior control
- **Code Example**:
```css
/* Add to style.css */
#pachinball-canvas {
  touch-action: none; /* Disable browser gestures on game area */
  -webkit-touch-callout: none; /* Disable iOS callout */
  -webkit-user-select: none;
  user-select: none;
}

.touch-btn {
  touch-action: manipulation; /* Optimize for tap responsiveness */
  -webkit-tap-highlight-color: transparent; /* Remove iOS grey flash */
  cursor: pointer;
}
```
- **Compatibility Gain**: Eliminates iOS 300ms delay, prevents accidental scroll
- **Gameplay Safety**: Faster, more responsive controls
- **Risk Level**: Low
- **Platform Support**: iOS Safari 9+, Android Chrome 36+

---

### Opportunity 3: Pointer API Migration (Touch → Unified)
- **Category**: PointerAPI
- **Current**: Separate touch events; mouse handled by Babylon.js camera
- **Opportunity**: Unified pointer handling for canvas interactions
- **Code Example**:
```typescript
// In InputHandler class
setupPointerControls(canvas: HTMLCanvasElement): void {
  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    
    // Left side = left flipper, right side = right flipper
    if (x < 0.33) this.onFlipperLeft(true)
    else if (x > 0.66) this.onFlipperRight(true)
    // Center bottom = plunger
    else if (y > 0.7) this.onPlunger()
  })
  
  canvas.addEventListener('pointerup', (e) => {
    // Release both on any pointer up
    this.onFlipperLeft(false)
    this.onFlipperRight(false)
  })
  
  // Prevent default touch actions
  canvas.style.touchAction = 'none'
}
```
- **Compatibility Gain**: Unified mouse/touch/pen; enables hybrid devices
- **Gameplay Safety**: Consistent behavior across input types
- **Risk Level**: Medium (requires canvas hit-testing logic)
- **Platform Support**: Chrome 55+, Firefox 59+, Safari 13+, Edge 12+

---

### Opportunity 4: Keyboard Layout Normalization
- **Category**: Normalization
- **Current**: Hardcoded `KeyZ`, `Slash` for QWERTY
- **Opportunity**: Use `event.key` with physical position detection via `event.code`
- **Code Example**:
```typescript
// Current (problematic for AZERTY):
if (event.code === 'KeyZ') // 'Z' on QWERTY, 'W' on AZERTY

// Improved - support both logical and physical:
private readonly leftFlipperKeys = ['z', 'Z', 'w', 'W', 'ArrowLeft']
private readonly rightFlipperKeys = ['/', 'ArrowRight', 'm', 'M'] // 'M' for AZERTY

handleKeyDown = (event: KeyboardEvent): void => {
  // Physical position for muscle memory
  if (event.code === 'KeyZ' || event.code === 'ArrowLeft') {
    this.onFlipperLeft(true)
  }
  // Logical key for printed label
  else if (this.leftFlipperKeys.includes(event.key)) {
    this.onFlipperLeft(true)
  }
  // ... etc
}
```
- **Compatibility Gain**: AZERTY, QWERTZ, Dvorak, Colemak support
- **Gameplay Safety**: Maintains muscle memory (physical) + printed labels (logical)
- **Risk Level**: Low
- **Platform Support**: All browsers with KeyboardEvent API

---

### Opportunity 5: Vibration API for Haptic Feedback
- **Category**: Workarounds
- **Current**: Audio beeps only (`playBeep()`)
- **Opportunity**: Add tactile feedback for supported devices
- **Code Example**:
```typescript
// In effects.ts or input.ts
private vibrate(pattern: number | number[]): void {
  if ('vibrate' in navigator) {
    navigator.vibrate(pattern)
  }
}

// Usage in collision handlers:
onBumperHit(): void {
  this.vibrate(50) // 50ms burst
}

onNudge(): void {
  this.vibrate([30, 30, 30]) // Triple pulse pattern
}
```
- **Compatibility Gain**: Mobile tactile feedback (Android, some iOS 17+)
- **Gameplay Safety**: Enhances immersion without affecting gameplay
- **Risk Level**: Low (graceful degradation)
- **Platform Support**: Android Chrome 30+, Firefox Mobile, iOS 17.4+ (limited)

---

### Opportunity 6: Device Orientation for Nudge
- **Category**: Orientation
- **Current**: Keyboard only (Q/E/W keys)
- **Opportunity**: Accelerometer-based nudge on mobile
- **Code Example**:
```typescript
private orientationSensitivity = 15 // degrees
private lastOrientation = { beta: 0, gamma: 0 }

setupOrientationControls(): void {
  if (!window.DeviceOrientationEvent) return
  
  window.addEventListener('deviceorientation', (e) => {
    if (this.getState() !== GameState.PLAYING) return
    if (this.getTiltActive()) return
    
    const tiltX = e.gamma || 0 // Left/right tilt (-90 to 90)
    const tiltY = e.beta || 0  // Front/back tilt (-180 to 180)
    
    // Threshold-based nudge to prevent jitter
    if (Math.abs(tiltX) > this.orientationSensitivity) {
      const direction = tiltX > 0 ? 0.6 : -0.6
      this.onNudge(new this.rapier!.Vector3(direction, 0, 0.3))
      this.lastOrientation.gamma = tiltX
    }
  })
}
```
- **Compatibility Gain**: Natural mobile nudge mechanic
- **Gameplay Safety**: Requires calibration/thresholding to prevent accidental triggers
- **Risk Level**: Medium (sensitivity tuning needed)
- **Platform Support**: iOS Safari 4+, Android Chrome (HTTPS required)

---

### Opportunity 7: Gamepad API Support
- **Category**: Gamepad
- **Current**: None
- **Opportunity**: Standard gamepad mapping for pinball controllers
- **Code Example**:
```typescript
// Standard pinball mapping
private readonly GAMEPAD_MAPPING = {
  leftFlipper: [0, 4, 6], // A, LB, L3 or left trigger
  rightFlipper: [1, 5, 7], // B, RB, R3 or right trigger
  plunger: [2, 3], // X, Y or analog pull-back
  nudge: { axes: [0, 1] } // Left stick for directional nudge
}

pollGamepad(): void {
  const gamepads = navigator.getGamepads()
  for (const gp of gamepads) {
    if (!gp) continue
    // Left flipper: button 0 (A) or 4 (LB)
    const leftPressed = [0, 4, 6].some(i => gp.buttons[i]?.pressed)
    const rightPressed = [1, 5, 7].some(i => gp.buttons[i]?.pressed)
    // ... handle state changes
  }
}
```
- **Compatibility Gain**: Xbox/PlayStation controllers, dedicated pinball controllers
- **Gameplay Safety**: True analog plunger support possible
- **Risk Level**: Medium (requires polling loop, button mapping UI)
- **Platform Support**: Chrome 21+, Firefox 29+, Edge, Safari 16.4+

---

### Opportunity 8: Touch Gesture System
- **Category**: Gestures
- **Current**: Simple button taps only
- **Opportunity**: Swipe for nudge, multi-touch for multiball activation
- **Code Example**:
```typescript
private touchStartPos = new Map<number, { x: number, y: number, time: number }>()

setupGestureControls(canvas: HTMLCanvasElement): void {
  canvas.addEventListener('touchstart', (e) => {
    for (const touch of e.changedTouches) {
      this.touchStartPos.set(touch.identifier, {
        x: touch.clientX,
        y: touch.clientY,
        time: performance.now()
      })
    }
  }, { passive: false })
  
  canvas.addEventListener('touchend', (e) => {
    for (const touch of e.changedTouches) {
      const start = this.touchStartPos.get(touch.identifier)
      if (!start) continue
      
      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y
      const dt = performance.now() - start.time
      
      // Swipe detection (quick horizontal movement)
      if (Math.abs(dx) > 50 && dt < 200) {
        const direction = dx > 0 ? 0.6 : -0.6
        this.onNudge(new this.rapier!.Vector3(direction, 0, 0.3))
      }
      
      this.touchStartPos.delete(touch.identifier)
    }
  })
}
```
- **Compatibility Gain**: Intuitive mobile nudge, faster than button
- **Gameplay Safety**: Requires careful threshold tuning
- **Risk Level**: Medium (may conflict with camera controls)
- **Platform Support**: All touch devices

---

## 3. Recommended Implementation Order

Based on **safety**, **impact**, and **effort**:

| Priority | Enhancement | Risk | Impact | Effort |
|----------|-------------|------|--------|--------|
| **1** | Add Touch Release Handlers (#1) | Low | Critical bugfix | 30 min |
| **2** | CSS Touch-Action Optimization (#2) | Low | iOS responsiveness | 15 min |
| **3** | Keyboard Layout Normalization (#4) | Low | Accessibility | 1 hour |
| **4** | Vibration API for Haptics (#5) | Low | Mobile immersion | 30 min |
| **5** | Pointer API Migration (#3) | Medium | Unified input | 2-3 hours |

---

## Summary

The current input system has a **critical gap** with missing touch release handlers that can leave flippers stuck. The **low-risk, high-impact** fixes (touch release, CSS touch-action, keyboard layout) should be implemented immediately. **Medium-term** investments in Pointer API and gamepad support will significantly expand device compatibility without breaking existing functionality.
