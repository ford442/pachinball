# Adventure Cinematic System Integration Guide

This document describes how to integrate the Adventure Cinematic System for dramatic moments and polish.

## Components Overview

### 1. AdventureCinematicSystem (`adventure-cinematic-system.ts`)
Core cinematic sequencing and effect system for dramatic camera moments.

**Key Methods:**
- `setCamera(camera)` - Set the ArcRotateCamera to control
- `playSequence(sequence)` - Play a custom cinematic sequence
- `playTrackStart(trackName)` - Play track start cinematic
- `playGoalComplete(goalTitle)` - Play goal completion cinematic
- `playTrackComplete(trackName)` - Play full track completion cinematic
- `playJackpot(points)` - Play jackpot celebration cinematic
- `update(deltaTime)` - Update cinematic (call from game loop)
- `isPlaying()` - Check if cinematic is active
- `skipCinematic()` - Skip to end of current sequence

**Features:**
- Configurable camera paths with easing
- Bloom effects and color flashes
- Screen shake and slow-motion effects
- UI text overlays during cinematics
- Effect callbacks for integration with game systems

### 2. AdventureCinematicTriggers (`adventure-cinematic-triggers.ts`)
Automatic cinematic triggering based on game events.

**Key Methods:**
- `setGoalTracker(tracker)` - Link to goal tracker for monitoring
- `configure(config)` - Configure which cinematics are enabled
- `onTrackStart(trackName)` - Call when adventure track starts
- `update()` - Call from game loop to check for cinematic triggers
- `triggerJackpot(points)` - Manually trigger jackpot cinematic
- `onUserInput()` - Call on user input to allow skipping

**Auto-Triggers:**
- Track start cinematic (on mode entry)
- Goal completion cinematics (when each goal completes)
- Track completion cinematic (when all goals complete)
- Jackpot cinematics (on jackpot events)

## Integration Checklist

### Step 1: Initialize Systems in Game.ts
```typescript
// In your Game class
import { AdventureCinematicSystem } from './game-elements/adventure-cinematic-system'
import { AdventureCinematicTriggers } from './game-elements/adventure-cinematic-triggers'

// In constructor/init
this.cinematicSystem = new AdventureCinematicSystem()
this.cinematicTriggers = new AdventureCinematicTriggers(this.cinematicSystem)

// Set camera
this.cinematicSystem.setCamera(this.followCamera)

// Link to goal tracker
this.cinematicTriggers.setGoalTracker(this.goalTracker)

// Configure which cinematics are enabled
this.cinematicTriggers.configure({
  trackStartEnabled: true,
  goalCompleteEnabled: true,
  trackCompleteEnabled: true,
  jackpotEnabled: true,
  skipOnUserInput: true
})
```

### Step 2: Register Effect Callbacks
```typescript
// Register callback to handle cinematic effects
this.cinematicSystem.onEffect((effectName, value) => {
  switch (effectName) {
    case 'color-flash':
      // Trigger screen flash
      this.effects?.playScreenFlash(value.color, value.intensity)
      break
    case 'bloom':
      // Adjust bloom intensity
      this.postProcessing?.setBloomIntensity(value.intensity)
      break
    case 'screen-shake':
      // Apply camera shake
      this.camera?.position.addInPlace(
        new Vector3(value.amount * 0.1, value.amount * 0.05, 0)
      )
      break
    case 'slow-motion':
      // Adjust game time scale
      this.timeScale = value.timeScale
      break
  }
})

// Register start/complete callbacks
this.cinematicSystem.onStart((eventType) => {
  console.log('Cinematic started:', eventType)
  // Pause gameplay, disable input, etc.
})

this.cinematicSystem.onComplete((eventType) => {
  console.log('Cinematic complete:', eventType)
  // Resume gameplay, re-enable input, etc.
})
```

### Step 3: Update in Game Loop
```typescript
// In your main update loop
if (this.gameMode === 'ADVENTURE') {
  this.cinematicSystem.update(deltaTime)
  this.cinematicTriggers.update()
  
  // Disable normal input during cinematics
  if (this.cinematicSystem.isPlaying()) {
    // Skip input processing
    return
  }
}
```

### Step 4: Hook Game Events
```typescript
// When adventure track starts
startAdventureTrack(trackName: string) {
  this.cinematicTriggers.onTrackStart(trackName)
}

// When jackpot happens
onJackpot(points: number) {
  this.cinematicTriggers.triggerJackpot(points)
}

// On user input (spacebar, touch, etc.)
onUserInput() {
  this.cinematicTriggers.onUserInput()
}
```

### Step 5: Handle Cinematic State
```typescript
// Check if cinematic is playing before allowing gameplay
isGameplayActive(): boolean {
  return !this.cinematicSystem.isPlaying()
}

// Get cinematic progress for UI
getCinematicProgress(): number {
  return this.cinematicSystem.getProgress()
}
```

## Creating Custom Cinematics

```typescript
// Define a custom cinematic sequence
const customCinematic: CinematicSequence = {
  type: 'special-moment',
  duration: 2.5,
  cameraPath: {
    startAlpha: -Math.PI / 2,
    startBeta: 1.0,
    startRadius: 16,
    endAlpha: -Math.PI / 2.5,
    endBeta: 0.9,
    endRadius: 12
  },
  effects: {
    slowMotion: 0.6,
    bloomIntensity: 0.7,
    colorFlash: Color3.FromHexString('#00ff00'),
    flashDuration: 0.5,
    screenShake: 0.2
  },
  ui: {
    titleText: 'Special Moment!',
    subtitleText: 'Something awesome happened',
    showDuration: 2.0
  },
  audio: {
    musicIntensity: 1.4
  },
  easing: this.cinematicSystem.easeInOutCubic // Use provided easing
}

// Play the custom cinematic
this.cinematicSystem.playSequence(customCinematic)
```

## Cinematic Configuration Options

```typescript
interface CinematicTriggerConfig {
  trackStartEnabled: boolean    // Show intro when track starts
  goalCompleteEnabled: boolean  // Show celebration when each goal completes
  trackCompleteEnabled: boolean // Show finale when all goals complete
  jackpotEnabled: boolean       // Show jackpot animation
  skipOnUserInput: boolean      // Allow user to skip cinematics
}
```

## Effect Callbacks Reference

### color-flash
```typescript
{
  color: Color3,      // Color to flash
  intensity: number   // 0-1, starts at 1, fades to 0
}
```

### bloom
```typescript
{
  intensity: number   // 0-1 bloom intensity
}
```

### screen-shake
```typescript
{
  amount: number      // -1 to 1, shake offset
}
```

### slow-motion
```typescript
{
  timeScale: number   // 0-1, multiplier for game time
}
```

## Performance Considerations

- Cinematics use lightweight lerp calculations
- No additional geometry or mesh loading
- Effect callbacks are optional (implement only what you need)
- Memory footprint: < 50KB for entire system
- Update cost: < 1ms per frame during playback

## Best Practices

1. **Keep Cinematics Short**: 1-3 seconds for goal completions, 2-4 seconds for major moments
2. **Don't Overuse**: Use cinematics sparingly to maintain their impact
3. **User Control**: Always allow skipping cinematics with a button press
4. **Pause Gameplay**: Automatically pause gameplay during cinematics
5. **Audio Sync**: Coordinate with audio/music system for maximum impact
6. **State Management**: Disable input/interactions while cinematic plays
7. **Fallback**: Design sequences to work with or without certain effects

## Testing Cinematics

```typescript
// Test individual cinematics without full game setup
const cinematic = new AdventureCinematicSystem()
cinematic.setCamera(testCamera)

let effectsTriggered: string[] = []
cinematic.onEffect((name) => {
  effectsTriggered.push(name)
})

cinematic.playTrackStart('Test Track')
cinematic.update(2.0) // Simulate 2 seconds of playback

assert(effectsTriggered.includes('color-flash'))
assert(effectsTriggered.includes('bloom'))
```

## Integration Example

See `docs/adventure-goal-integration.md` for complete game loop integration showing how goals and cinematics work together.
