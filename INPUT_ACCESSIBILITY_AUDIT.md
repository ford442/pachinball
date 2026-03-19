# Input Accessibility Audit Report: Pachinball

## 1. Current State Summary

### Accessibility Inventory

| Feature | Status | Implementation Location |
|---------|--------|------------------------|
| Reduced Motion | ✅ Implemented | `config.ts` → disables camera shake, fog |
| Photosensitive Mode | ✅ Implemented | `config.ts` → disables particles/flashing |
| High Contrast | ⚠️ Defined only | `config.ts` → flag exists, unused |
| Large Text | ⚠️ Defined only | `config.ts` → flag exists, unused |
| Settings Persistence | ✅ Implemented | `settings.ts` → localStorage |
| System Preference Detection | ✅ Implemented | `prefers-reduced-motion` media query |

### Input System Analysis

**Current Controls (Hardcoded in `input.ts`):**
| Action | Primary Key | Alt Key | Issues |
|--------|-------------|---------|--------|
| Left Flipper | `ArrowLeft` | `KeyZ` | ✅ Good |
| Right Flipper | `ArrowRight` | `Slash` | ⚠️ **Slash varies by layout** (UK: `/`, FR: `!`, DE: `#`) |
| Plunger | `Space` | `Enter` | ✅ Good |
| Nudge Left | `KeyQ` | — | ❌ No alternative |
| Nudge Right | `KeyE` | — | ❌ No alternative |
| Nudge Up | `KeyW` | — | ❌ No alternative |
| Pause | `KeyP` | — | ✅ Game state appropriate |
| Reset | `KeyR` | — | ⚠️ Only in PLAYING state |
| Adventure Toggle | `KeyH` | — | ❌ Hidden feature |
| Track Next | `BracketRight` | — | ❌ Hard to reach |
| Track Prev | `BracketLeft` | — | ❌ Hard to reach |
| Jackpot (Debug) | `KeyJ` | — | ❌ Debug only |

**Touch Controls:** Left, Right, Plunger, Nudge buttons available

### WCAG 2.1 Compliance Gaps

| Guideline | Level | Status | Gap |
|-----------|-------|--------|-----|
| 2.1.1 Keyboard | A | ⚠️ Partial | No alternative for nudge, track cycling hard to reach |
| 2.1.2 No Keyboard Trap | A | ✅ Pass | Tab navigation works, Escape closes overlays |
| 2.1.4 Character Key Shortcuts | A | ✅ Pass | No single-character shortcuts without modifiers |
| 2.5.1 Pointer Gestures | A | ✅ Pass | Simple taps only |
| 2.5.2 Pointer Cancellation | A | ⚠️ Partial | Touch uses `preventDefault` but no visual feedback |
| 2.5.5 Target Size | AAA | ❌ Fail | Touch buttons likely < 44×44px (needs CSS verification) |

---

## 2. Opportunities (Prioritized by Impact/Safety)

### Opportunity 1: Key Remapping System
- **Category**: Remapping
- **Current**: All keys hardcoded in `input.ts`; users cannot customize
- **Opportunity**: Add configurable key map with UI in settings panel

```typescript
// config.ts addition
input: {
  keyMap: {
    flipperLeft: ['ArrowLeft', 'KeyZ'],
    flipperRight: ['ArrowRight', 'KeyM'], // Replace problematic Slash
    plunger: ['Space', 'Enter'],
    nudgeLeft: ['KeyQ', 'KeyA'], // Add left-hand alt
    nudgeRight: ['KeyE', 'KeyD'], // Add left-hand alt
    pause: ['KeyP', 'Escape'],
  }
}
```

- **Accessibility Gain**: Users with motor disabilities can choose ergonomic keys; international keyboard users avoid layout issues
- **Gameplay Safety**: Neutral - same input latency, user preference only
- **Risk Level**: Low
- **WCAG Reference**: 2.1.1 Keyboard (A)

---

### Opportunity 2: Single-Hand Mode
- **Category**: SingleHand
- **Current**: Requires both hands (left side: Z/Q, right side: Slash/E/M)
- **Opportunity**: One-handed control scheme using only left side of keyboard

```typescript
// Single-hand mode key mapping
singleHandMode: {
  enabled: boolean
  keyMap: {
    flipperLeft: ['KeyA'],
    flipperRight: ['KeyD'],
    plunger: ['Space', 'KeyW'],
    nudge: ['KeyS'] // Single nudge key (auto-direction or fixed)
  }
}
```

- **Accessibility Gain**: Enables play for users with one functional hand; supports left/right hand preference
- **Gameplay Safety**: Neutral - no timing advantage, just key position change
- **Risk Level**: Low
- **WCAG Reference**: 2.1.1 Keyboard (A) - ensures keyboard operable with limited dexterity

---

### Opportunity 3: Sticky Keys / Toggle Mode
- **Category**: Timing
- **Current**: Flipper requires key hold; rapid repeated presses for some actions
- **Opportunity**: Allow flippers to toggle on/off with single press

```typescript
// config.ts
input: {
  stickyKeys: {
    enabled: boolean,
    toggleDuration: number // ms before auto-release (safety)
  }
}

// input.ts modification
handleKeyDown(event: KeyboardEvent): void {
  if (isFlipperKey(event.code)) {
    if (GameConfig.input.stickyKeys.enabled) {
      const isActive = this.toggleFlipperState(side)
      this.onFlipperLeft(isActive)
    } else {
      this.onFlipperLeft(true)
    }
  }
}
```

- **Accessibility Gain**: Essential for users who cannot hold keys; reduces fatigue
- **Gameplay Safety**: Neutral to slight disadvantage - toggle slower than hold for rapid flips
- **Risk Level**: Low
- **WCAG Reference**: 2.5.1 Pointer Gestures (A), 2.5.6 Concurrent Input Mechanisms (AAA)

---

### Opportunity 4: Switch Access Support
- **Category**: AlternativeInput
- **Current**: Only keyboard and touch supported
- **Opportunity**: Support for adaptive switches (single/multiple)

```typescript
// Switch access using standard gamepad API mapped to switches
// Or: Dedicated switch input via serial/WebHID for specialized hardware

input: {
  switchAccess: {
    enabled: boolean,
    mode: 'scanning' | 'direct', // Scanning cycles through actions
    scanSpeed: number, // ms between focus changes
    switches: {
      primary: number,   // Gamepad button index or key code
      secondary: number, // Optional second switch
    }
  }
}
```

- **Accessibility Gain**: Enables play for users with severe motor limitations who use single-switch or dual-switch scanning
- **Gameplay Safety**: Neutral to slight disadvantage - scanning is inherently slower
- **Risk Level**: Medium - requires UI feedback for scan position
- **WCAG Reference**: 2.1.1 Keyboard (A), 2.5.6 Concurrent Input Mechanisms (AAA)

---

### Opportunity 5: Input Timing Adjustments
- **Category**: Timing
- **Current**: Immediate response, no debounce or repeat control
- **Opportunity**: Configurable debounce, hold-to-repeat, and input delay

```typescript
input: {
  timing: {
    debounceMs: number,        // Prevent accidental double-presses
    repeatDelayMs: number,     // Delay before hold-repeat starts
    repeatIntervalMs: number,  // Speed of repeat
    inputBufferMs: number      // Window for "generous" input timing
  }
}
```

- **Accessibility Gain**: Essential for users with tremors, spasms, or imprecise motor control
- **Gameplay Safety**: Neutral - can be tuned to not exceed human reaction time advantage
- **Risk Level**: Low
- **WCAG Reference**: 2.5.6 Concurrent Input Mechanisms (AAA)

---

### Opportunity 6: Visual Input Indicators
- **Category**: Visual
- **Current**: No on-screen feedback for key presses
- **Opportunity**: Optional HUD overlay showing active inputs

```typescript
// Visual feedback system
visualFeedback: {
  enabled: boolean,
  showFlipperState: boolean,  // Highlight when flipper is active
  showInputOverlay: boolean,  // Display recent key presses
  highContrastIndicators: boolean // Use patterns, not just color
}

// Example: Corner overlay showing "L ● R" with dots for active flippers
// Example: Plunger charge indicator with pattern fill
```

- **Accessibility Gain**: Helps users with cognitive disabilities confirm their input; assists deaf/hard-of-hearing users who miss audio feedback
- **Gameplay Safety**: Neutral - information already available through other means
- **Risk Level**: Low
- **WCAG Reference**: 1.3.3 Sensory Characteristics (A), 1.4.1 Use of Color (A)

---

### Opportunity 7: Gamepad API Support
- **Category**: AlternativeInput
- **Current**: No gamepad support
- **Opportunity**: Standard gamepad input with customizable mapping

```typescript
input: {
  gamepad: {
    enabled: boolean,
    mapping: {
      flipperLeft: 4,   // L1
      flipperRight: 5,  // R1
      plunger: 0,       // A/Cross
      nudge: [12,13,14,15], // D-pad
      pause: 9,         // Start/Options
    },
    deadzone: 0.1,      // Analog stick threshold
    vibration: boolean  // Haptic feedback (respect reduced motion)
  }
}
```

- **Accessibility Gain**: Many accessibility controllers present as gamepads (Xbox Adaptive Controller, etc.)
- **Gameplay Safety**: Neutral - standard input method
- **Risk Level**: Medium - requires polling loop, button conflict resolution
- **WCAG Reference**: 2.5.6 Concurrent Input Mechanisms (AAA)

---

### Opportunity 8: Layout-Independent Keys (Critical Fix)
- **Category**: Remapping (Critical Fix)
- **Current**: `Slash` key used for right flipper varies by keyboard layout
- **Opportunity**: Replace `Slash` with layout-independent `KeyM` or `KeyC`

```typescript
// Immediate fix in input.ts
// Line 84, 129: Change 'Slash' to 'KeyM' (works on all layouts)

if (event.code === 'ArrowRight' || event.code === 'KeyM') {
  if (this.getTiltActive()) return
  this.onFlipperRight(true)
}
```

- **Accessibility Gain**: International users (AZERTY, QWERTZ, etc.) can play without remapping
- **Gameplay Safety**: Neutral - same key position, just reliable code
- **Risk Level**: Low
- **WCAG Reference**: 2.1.1 Keyboard (A)

---

## 3. Recommended Implementation Order

### Top 5 Safest, Highest-Impact Improvements

| Priority | Feature | Effort | Impact | Safety | Rationale |
|----------|---------|--------|--------|--------|-----------|
| **1** | **Layout-Independent Keys** | 5 min | High | Very Safe | Fixes broken experience for non-QWERTY users; zero risk |
| **2** | **Key Remapping System** | 2-3 hrs | High | Safe | Enables all keyboard customization needs; user empowerment |
| **3** | **Single-Hand Mode** | 1-2 hrs | High | Safe | Expands user base significantly; simple preset approach |
| **4** | **Sticky Keys / Toggle** | 2-3 hrs | High | Safe | Essential for motor accessibility; well-understood pattern |
| **5** | **Visual Input Indicators** | 3-4 hrs | Medium | Safe | Aids cognitive access; assists when audio is off |

### Implementation Notes for Top 5

**1. Layout-Independent Keys (Immediate)**
```typescript
// In input.ts - Line 84
// BEFORE: event.code === 'Slash'
// AFTER:  event.code === 'KeyM'
```
This is a bug fix, not a feature. The `Slash` key produces different `event.code` values on different keyboard layouts.

**2. Key Remapping System**
- Add `InputConfig` interface to `config.ts`
- Create `InputSettings` UI component (similar to existing settings)
- Modify `InputHandler` to read from config instead of hardcoded values
- Persist to localStorage via `SettingsManager`

**3. Single-Hand Mode**
- Add preset toggle in settings: "Left Hand Mode" / "Right Hand Mode"
- Predefined keymaps for each mode
- No need for full custom mapping UI initially

**4. Sticky Keys**
- Add toggle in accessibility settings
- Track flipper state in `InputHandler`
- Add optional auto-release timer for safety (prevents stuck flippers)

**5. Visual Input Indicators**
- Add overlay divs for flipper status (corner of screen, low opacity)
- Use CSS classes for active state styling
- Respect `prefers-reduced-motion` for indicator animations

---

## Summary

The Pachinball input system has a solid foundation with touch and keyboard support, but lacks the flexibility required for inclusive play. The **Slash key bug** is the most critical issue affecting international users. Beyond that, **key remapping** and **single-hand mode** offer the highest impact for users with motor disabilities at low implementation risk.

The current accessibility settings (reduced motion, photosensitive mode) are well-implemented and provide a good template for expanding input accessibility options.
