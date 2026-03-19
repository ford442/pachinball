# Input Latency Audit Report: Pachinball

## 1. Current State Summary

### Input System Inventory

| Input Type | Events | Bindings | Processing |
|------------|--------|----------|------------|
| **Keyboard** | `keydown`/`keyup` on `window` | Left: ArrowLeft/Z, Right: ArrowRight/Slash, Plunger: Space/Enter, Nudge: Q/E/W | Immediate callback → Physics motor |
| **Touch** | `touchstart` only (no release) | Left/Right/Plunger/Nudge buttons | `preventDefault()` → Immediate callback |
| **Pointer/Mouse** | ❌ Not implemented | — | — |
| **Gamepad** | ❌ Not implemented | — | — |

### Event Flow Analysis

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           INPUT EVENT FLOW                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Native Event          Handler           Callback           Physics         │
│  ───────────────►      ─────────►        ─────────►         ─────────►     │
│                                                                             │
│  keydown/touchstart    InputHandler      Game.handle*()     configureMotor │
│  (browser thread)      (sync)            (sync)             (queued)       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                          ┌─────────────────────┐
                          │  onBeforeRender     │
                          │  (once per frame)   │
                          │  ─────────────────► │
                          │  stepPhysics()      │
                          │  world.step()       │
                          └─────────────────────┘
```

### Latency Characteristics

| Metric | Current Value | Notes |
|--------|---------------|-------|
| **Best-case latency** | ~2-5ms | Input arrives just before physics step |
| **Worst-case latency** | ~20ms (at 60fps) | Input arrives just after physics step |
| **Jitter** | **HIGH** | ±16ms variance depending on event timing |
| **Consistency** | **LOW** | No buffering = variable input-to-response |
| **Dropped inputs** | Possible | Rapid press/release between frames may be lost |

### Key Observations

1. **No Frame Alignment**: Events processed immediately in handler, not synchronized to physics step
2. **No Input Buffering**: Single-frame press/release can be missed if between physics steps
3. **Touch Gap**: No `touchend` handling means flippers stay activated (no release mechanism shown)
4. **No Timestamps**: Cannot measure actual input-to-response latency
5. **Missing Input Modalities**: No mouse/pointer or gamepad support limits accessibility

---

## 2. Opportunities (Prioritized by Impact/Safety)

### Opportunity 1: 1-Frame Input Buffering
**Category**: Buffering  
**Current**: Events processed immediately in handler  
**Risk Level**: **Low**

```typescript
// input.ts - Add ring buffer for inputs
interface InputFrame {
  flipperLeft: boolean | null   // null = no change this frame
  flipperRight: boolean | null
  plunger: boolean
  nudge: RAPIER.Vector3 | null
  timestamp: number
}

export class InputHandler {
  private inputBuffer: InputFrame[] = []
  private readonly bufferSize = 2  // Current + previous frame
  
  handleKeyDown = (event: KeyboardEvent): void => {
    // Queue instead of immediate process
    this.queueInput('flipperLeft', true, event.timeStamp)
  }
  
  private queueInput(type: string, value: boolean, timestamp: number): void {
    // Store in buffer for next physics frame
    this.pendingInputs.push({ type, value, timestamp })
  }
  
  // Called from game.ts stepPhysics()
  processBufferedInputs(): InputFrame {
    const frame = this.drainPendingInputs()
    return frame
  }
}
```

**Latency Gain**: 
- Reduces jitter from ±16ms to near-zero
- No added latency (processes next frame)
- Prevents dropped rapid inputs

**Gameplay Safety**: Maintains existing tight feel; actually improves consistency

---

### Opportunity 2: Frame-Aligned Input Processing
**Category**: Timing  
**Current**: Physics steps at `onBeforeRenderObservable`, inputs processed ad-hoc  
**Risk Level**: **Low**

```typescript
// game.ts - Move input processing into stepPhysics
private stepPhysics(): void {
  if (this.state !== GameState.PLAYING) return
  
  // Process all buffered inputs at physics step start
  const inputFrame = this.inputHandler?.processBufferedInputs()
  if (inputFrame) {
    this.applyInputFrame(inputFrame)
  }
  
  // Now step physics with inputs applied
  this.physics.step((h1, h2, start) => {
    if (!start) return
    this.processCollision(h1, h2)
  })
}

private applyInputFrame(frame: InputFrame): void {
  // Apply all inputs atomically at physics step
  if (frame.flipperLeft !== null) {
    this.handleFlipperLeft(frame.flipperLeft)
  }
  if (frame.flipperRight !== null) {
    this.handleFlipperRight(frame.flipperRight)
  }
  if (frame.plunger) {
    this.handlePlunger()
  }
}
```

**Latency Gain**: 
- Consistent 0-16ms latency (vs variable 0-32ms)
- Eliminates "phantom" input timing issues

**Gameplay Safety**: Predictable behavior improves muscle memory

---

### Opportunity 3: Touch Event Completion
**Category**: Consistency  
**Current**: `touchstart` only, no release handling  
**Risk Level**: **Low**

```typescript
// input.ts - Complete touch handling
setupTouchControls(/* ... */): void {
  // Add touchend/touchcancel with proper options
  const options: AddEventListenerOptions = { 
    passive: false,
    capture: true  // Ensure we get events before bubbling
  }
  
  leftBtn?.addEventListener('touchstart', (e) => {
    e.preventDefault()
    this.queueInput('flipperLeft', true, e.timeStamp)
  }, options)
  
  leftBtn?.addEventListener('touchend', (e) => {
    e.preventDefault()
    this.queueInput('flipperLeft', false, e.timeStamp)
  }, options)
  
  leftBtn?.addEventListener('touchcancel', (e) => {
    this.queueInput('flipperLeft', false, e.timeStamp)
  }, options)
  
  // Prevent 300ms delay on some browsers
  leftBtn?.style.touchAction = 'none'
}
```

**Latency Gain**: 
- Eliminates 300ms touch delay on some mobile browsers
- Proper release handling prevents stuck flippers

**Gameplay Safety**: Critical fix for mobile playability

---

### Opportunity 4: Input Latency Instrumentation
**Category**: Measurement  
**Current**: No timing data collection  
**Risk Level**: **Very Low** (development-only)

```typescript
// input.ts - Add latency tracking
export class InputHandler {
  private latencyMetrics = {
    samples: [] as number[],
    lastReportTime: 0,
    maxSamples: 100
  }
  
  handleKeyDown = (event: KeyboardEvent): void => {
    const inputTime = event.timeStamp || performance.now()
    this.queueInput('flipperLeft', true, inputTime)
  }
  
  markInputProcessed(inputTime: number): void {
    const now = performance.now()
    const latency = now - inputTime
    this.latencyMetrics.samples.push(latency)
    
    if (this.latencyMetrics.samples.length > this.latencyMetrics.maxSamples) {
      this.latencyMetrics.samples.shift()
    }
    
    // Report every 5 seconds in development
    if (now - this.latencyMetrics.lastReportTime > 5000) {
      this.reportLatency()
    }
  }
  
  private reportLatency(): void {
    const samples = this.latencyMetrics.samples
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length
    const max = Math.max(...samples)
    const min = Math.min(...samples)
    console.log(`[Input Latency] Avg: ${avg.toFixed(2)}ms, Min: ${min.toFixed(2)}ms, Max: ${max.toFixed(2)}ms`)
  }
}
```

**Latency Gain**: Data-driven optimization (no direct latency reduction)

**Gameplay Safety**: Pure instrumentation, zero gameplay impact

---

### Opportunity 5: Pointer/Mouse Support
**Category**: Consistency  
**Current**: Keyboard/touch only  
**Risk Level**: **Low**

```typescript
// input.ts - Add pointer support
export class InputHandler {
  setupPointerControls(canvas: HTMLCanvasElement): void {
    // Pointer events cover mouse + touch + pen
    canvas.addEventListener('pointerdown', (e) => {
      const rect = canvas.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width  // 0-1
      
      // Left side = left flipper, right side = right flipper
      if (x < 0.5) {
        this.queueInput('flipperLeft', true, e.timeStamp)
      } else {
        this.queueInput('flipperRight', true, e.timeStamp)
      }
    }, { passive: false })
    
    canvas.addEventListener('pointerup', (e) => {
      // Release both on any up (safer)
      this.queueInput('flipperLeft', false, e.timeStamp)
      this.queueInput('flipperRight', false, e.timeStamp)
    })
    
    // Prevent default touch behaviors
    canvas.style.touchAction = 'none'
  }
}
```

**Latency Gain**: 
- Mouse players get same responsiveness as keyboard
- Consistent cross-input parity

**Gameplay Safety**: Adds option without changing existing behavior

---

### Opportunity 6: Gamepad API Polling
**Category**: Consistency  
**Current**: Not implemented  
**Risk Level**: **Low**

```typescript
// input.ts - Gamepad support
export class InputHandler {
  private gamepadIndex: number | null = null
  
  setupGamepad(): void {
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index
      console.log('Gamepad connected:', e.gamepad.id)
    })
  }
  
  // Call from game.ts stepPhysics() before processing
  pollGamepad(): void {
    if (this.gamepadIndex === null) return
    
    const gamepad = navigator.getGamepads()[this.gamepadIndex]
    if (!gamepad) return
    
    const now = performance.now()
    
    // Common mappings: LT/RT or LB/RB for flippers
    const leftTrigger = gamepad.buttons[6]?.pressed || gamepad.buttons[4]?.pressed
    const rightTrigger = gamepad.buttons[7]?.pressed || gamepad.buttons[5]?.pressed
    
    if (leftTrigger !== this.lastGamepadLeft) {
      this.queueInput('flipperLeft', leftTrigger, now)
      this.lastGamepadLeft = leftTrigger
    }
    if (rightTrigger !== this.lastGamepadRight) {
      this.queueInput('flipperRight', rightTrigger, now)
      this.lastGamepadRight = rightTrigger
    }
  }
}
```

**Latency Gain**: Comparable to keyboard (~1 frame)

**Gameplay Safety**: Standard pinball controller support

---

## 3. Recommended Implementation Order

| Priority | Opportunity | Impact | Risk | Effort |
|----------|-------------|--------|------|--------|
| **1** | Touch Event Completion | High | Very Low | 2h |
| **2** | 1-Frame Input Buffering | High | Low | 4h |
| **3** | Frame-Aligned Processing | High | Low | 2h |
| **4** | Input Latency Instrumentation | Medium | None | 2h |
| **5** | Pointer/Mouse Support | Medium | Low | 3h |

### Implementation Notes

**Phase 1 (Immediate)**:
- Fix touch release handling (Opportunity 3) - critical for mobile
- Add `{ passive: false }` to all touch handlers

**Phase 2 (Next Sprint)**:
- Implement input buffering (Opportunity 1)
- Add frame-aligned processing (Opportunity 2)
- Both together ensure consistent ~16ms latency with no dropped inputs

**Phase 3 (Polish)**:
- Add latency instrumentation for ongoing monitoring
- Implement pointer/mouse support for accessibility
- Consider gamepad support based on player feedback

**Avoid for Now**:
- Sub-frame polling (complexity vs. benefit)
- Predictive activation (risk to core gameplay feel)

---

### Summary

The current input system is functional but lacks consistency guarantees. The **highest-impact, safest improvements** are:

1. **Touch completion** - Critical mobile fix
2. **1-frame buffering** - Eliminates jitter and dropped inputs  
3. **Frame alignment** - Predictable latency for muscle memory

Together these achieve "tight" pinball feel without adding perceivable latency.
