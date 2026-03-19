# Haptic Feedback Audit Report
## Pachinball Browser-Based Pinball Game

---

## 1. Current State Summary

### Haptic Capabilities Inventory

| Capability | Status | Notes |
|------------|--------|-------|
| **Web Vibration API** | ❌ Not implemented | No `navigator.vibrate()` usage |
| **Gamepad Haptics** | ❌ Not implemented | No `gamepad.hapticActuators` usage |
| **Touch Haptics** | ❌ Not implemented | No `ontouchstart` haptic calls |
| **Visual Feedback** | ✅ Active | Bloom, shard bursts, lighting changes |
| **Audio Feedback** | ✅ Active | Web Audio API beeps, tones, melodies |

### Current Feedback Mechanisms

**Input Handling** (`input.ts`):
- Keyboard: Arrow keys, Z, /, Space, Enter, Q, E, W
- Touch: 4 buttons (left flipper, right flipper, plunger, nudge)
- **No haptic calls on any input**

**Effects System** (`effects.ts`):
- `playBeep(freq)` - Basic tone generation
- `playSlotSpinStart()` - Rising pitch sawtooth
- `playReelStop()` - Mechanical click
- `playSlotWin()` - Arpeggio chord
- `playSlotJackpot()` - Drum roll + victory chord
- `playNearMiss()` - Descending "aww"
- `spawnShardBurst()` - Visual particle explosion
- `setBloomEnergy()` - Screen glow effect
- `setLightingMode()` - Cabinet LED color changes
- `cameraShakeIntensity` - Screen shake on impacts

**Configuration** (`config.ts`):
- Accessibility settings exist (`photosensitiveMode`, `highContrast`, `largeText`)
- **No haptic preference setting**

---

## 2. Opportunities (Prioritized by Impact/Safety)

### OPPORTUNITY 1: Flipper Activation Feedback
| Attribute | Value |
|-----------|-------|
| **Category** | VibrationAPI + Patterns |
| **Current** | Audio beep (220Hz) when tilted only; no feedback on normal flip |
| **Opportunity** | Short 15ms vibration on flipper press (keyboard + touch) |
| **Tactile Gain** | Immediate confirmation of control activation; critical for timing-based gameplay |
| **Gameplay Safety** | ✅ No gameplay logic changes |
| **Risk Level** | **Low** |
| **Browser Support** | Chrome/Edge/Firefox/Android: Full; iOS: 15ms minimum (will round up to ~16ms) |

**Implementation Code:**
```typescript
// In input.ts - handleKeyDown and handleKeyUp
private triggerHaptic(pattern: number | number[]): void {
  if (!GameConfig.haptics.enabled) return
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(pattern)
  }
}

// In handleKeyDown, line 81:
if (event.code === 'ArrowLeft' || event.code === 'KeyZ') {
  if (this.getTiltActive()) return
  this.onFlipperLeft(true)
  this.triggerHaptic(15) // 15ms sharp tap
}

// Touch controls (line 142-150):
leftBtn?.addEventListener('touchstart', (e) => {
  e.preventDefault()
  this.onFlipperLeft(true)
  this.triggerHaptic(15)
})
```

---

### OPPORTUNITY 2: Bumper Impact Feedback
| Attribute | Value |
|-----------|-------|
| **Category** | Intensity Mapping + VibrationAPI |
| **Current** | Camera shake (0.08 intensity) + shard burst + bloom (2.0) + beep (400-600Hz) |
| **Opportunity** | Map bumper restitution force to vibration intensity |
| **Tactile Gain** | Physical sensation of ball impact; intensity varies with collision energy |
| **Gameplay Safety** | ✅ No gameplay logic changes |
| **Risk Level** | **Low** |
| **Browser Support** | All Vibration API browsers |

**Implementation Code:**
```typescript
// In game.ts, around line 1098 (bumper collision handler)
private triggerImpactHaptic(impulseMagnitude: number): void {
  if (!GameConfig.haptics.enabled) return
  
  const maxVibration = GameConfig.haptics.maxIntensity // e.g., 50ms
  const minVibration = 10
  const clampedImpulse = Math.min(impulseMagnitude, 30) // Cap at reasonable max
  const intensity = Math.floor((clampedImpulse / 30) * maxVibration) + minVibration
  
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    // Sharp impact: short on, short off, short on (feels like "crack")
    navigator.vibrate([intensity, 5, intensity / 2])
  }
}
```

---

### OPPORTUNITY 3: Plunger Release Pattern
| Attribute | Value |
|-----------|-------|
| **Category** | Patterns + VibrationAPI |
| **Current** | Impulse applied (22 units), no tactile feedback |
| **Opportunity** | Spring-tension release pattern: building intensity then sharp release |
| **Tactile Gain** | Simulates mechanical spring compression/release; satisfying "ka-chunk" feeling |
| **Gameplay Safety** | ✅ No gameplay logic changes |
| **Risk Level** | **Low** |
| **Browser Support** | All Vibration API browsers |

**Implementation Code:**
```typescript
// In game.ts, handlePlunger() method (line 903)
private handlePlunger(): void {
  const rapier = this.physics.getRapier()
  const ballBody = this.ballManager?.getBallBody()
  if (!ballBody || !rapier) return
  
  const pos = ballBody.translation()
  if (pos.x > 8 && pos.z < -4) {
    // Apply impulse
    ballBody.applyImpulse(new rapier.Vector3(0, 0, GameConfig.plunger.impulse), true)
    
    // Haptic: Spring release pattern
    this.triggerHaptic([30, 10, 60]) // Short wind-up, gap, hard launch
  }
}
```

---

### OPPORTUNITY 4: User Preference & Accessibility
| Attribute | Value |
|-----------|-------|
| **Category** | Accessibility |
| **Current** | `GameConfig.accessibility.photosensitiveMode`, `highContrast`, `largeText` exist |
| **Opportunity** | Add `hapticsEnabled` and `hapticIntensity` settings |
| **Tactile Gain** | User control; essential for photosensitive users who may prefer haptics over flashing |
| **Gameplay Safety** | ✅ No gameplay logic changes |
| **Risk Level** | **Low** |
| **Browser Support** | N/A (settings only) |

**Implementation Code:**
```typescript
// In config.ts, add to accessibility section:
accessibility: {
  photosensitiveMode: false,
  highContrast: false,
  largeText: false,
  hapticsEnabled: true,      // Master haptics toggle
  hapticIntensity: 1.0,      // 0.0 to 2.0 scale multiplier
}

// Haptic utility with intensity scaling:
function triggerHaptic(pattern: number | number[]): void {
  if (!GameConfig.accessibility.hapticsEnabled) return
  
  const scale = GameConfig.accessibility.hapticIntensity
  
  // Scale the pattern values
  const scaledPattern = Array.isArray(pattern) 
    ? pattern.map(d => Math.floor(d * scale))
    : Math.floor(pattern * scale)
  
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(scaledPattern)
  }
}
```

---

### OPPORTUNITY 5: Gamepad Haptic Actuators
| Attribute | Value |
|-----------|-------|
| **Category** | Gamepad Haptics |
| **Current** | No gamepad support |
| **Opportunity** | Dual-rumble support for Xbox/PS controllers with intensity mapping |
| **Tactile Gain** | High-fidelity dual-motor feedback; low-frequency for impacts, high-frequency for flippers |
| **Gameplay Safety** | ✅ No gameplay logic changes |
| **Risk Level** | **Medium** (requires gamepad polling setup) |
| **Browser Support** | Chrome/Edge: Full; Firefox: Partial; Safari: Limited |

**Implementation Code:**
```typescript
// New file: src/game-elements/haptics.ts
export class HapticManager {
  private gamepadIndex: number | null = null
  
  constructor() {
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index
    })
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.gamepadIndex === e.gamepad.index) {
        this.gamepadIndex = null
      }
    })
  }
  
  vibrateDual(lowFreq: number, highFreq: number, duration: number): void {
    if (this.gamepadIndex === null) return
    const gamepad = navigator.getGamepads()[this.gamepadIndex]
    if (!gamepad?.vibrationActuator) {
      // Fallback to Vibration API
      if (navigator.vibrate) {
        navigator.vibrate(duration)
      }
      return
    }
    
    // Standard Gamepad Haptic Actuator
    gamepad.vibrationActuator.playEffect('dual-rumble', {
      startDelay: 0,
      duration: duration,
      weakMagnitude: highFreq / 255, // 0-1
      strongMagnitude: lowFreq / 255  // 0-1
    })
  }
  
  // Event-specific mappings
  flipperFeedback(): void {
    // High-frequency short burst for flipper
    this.vibrateDual(0, 180, 50)
  }
  
  bumperFeedback(intensity: number): void {
    // Low-frequency for impact "thud"
    const low = Math.min(intensity * 2, 255)
    this.vibrateDual(low, 50, 100)
  }
}
```

---

## 3. Recommended Implementation Order

### Top 5 Safest, Highest-Impact Haptic Improvements

| Rank | Feature | File Changes | Effort | Impact | Safety |
|------|---------|--------------|--------|--------|--------|
| **1** | **Flipper Activation** (15ms tap) | `input.ts` | Low | High | ✅ Very Safe |
| **2** | **Bumper Impact** (intensity-mapped) | `game.ts` | Low | High | ✅ Very Safe |
| **3** | **User Preferences** (enable/intensity) | `config.ts` + UI | Low | Medium | ✅ Very Safe |
| **4** | **Plunger Release** (spring pattern) | `game.ts` | Low | Medium | ✅ Very Safe |
| **5** | **Tilt Warning** (rumble pattern) | `game.ts` | Low | Medium | ✅ Very Safe |

### Implementation Path

**Phase 1: Foundation (1-2 hours)**
1. Add haptic config to `config.ts`
2. Create `src/game-elements/haptics.ts` utility module
3. Implement `triggerHaptic()` with intensity scaling

**Phase 2: Core Feedback (2-3 hours)**
4. Add flipper haptics to `input.ts`
5. Add bumper haptics to collision handler in `game.ts`
6. Add plunger haptics to `handlePlunger()`

**Phase 3: Polish (1-2 hours)**
7. Add tilt warning rumble
8. Test on Android Chrome and iOS Safari

---

## Summary

**Current Haptic State:** Zero haptic feedback implemented.

**Potential Impact:** High. Pinball is a tactile genre by nature. The existing strong visual/audio feedback (bloom, shards, camera shake, beeps) provides an excellent foundation to complement with haptics.

**Safest Entry Point:** Flipper activation (15ms vibration) - adds immediate value with zero risk.

**Key Consideration:** Always respect the existing `photosensitiveMode` and add `hapticsEnabled` preference for accessibility. The Web Vibration API is widely supported and safe to use with proper feature detection.
