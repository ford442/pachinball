# Adventure Goal System Integration Guide

This document describes how to integrate the Adventure Goal System into the main game loop.

## Components Overview

### 1. AdventureGoalSystem (`adventure-goal-system.ts`)
Core goal management system. Tracks goal progress and completion.

**Key Methods:**
- `initializeGoals(trackId, goals)` - Initialize goals for a track
- `updateGoal(goalId, currentValue)` - Update a goal's progress
- `incrementGoal(goalId, amount)` - Increment a goal (for counters)
- `getGoals()` - Get all goals
- `isComplete()` - Check if all goals are complete
- `getTotalReward()` - Get reward sum

### 2. AdventureTrackGoals (`adventure-track-goals.ts`)
Goal definitions for different adventure tracks.

**Features:**
- 4 tracks with 4 goals each (score, collection, survival, combo)
- Fallback goal generation for unlisted tracks
- `getGoalsForTrack(trackId)` - Get goals for a specific track

### 3. AdventureGoalTracker (`adventure-goal-tracker.ts`)
Integration layer connecting goals to game events.

**Key Methods:**
- `initializeTrack(trackId)` - Initialize tracker for a track
- `update(deltaTime)` - Update (call from game loop)
- `trackBumperHit()` - Called when ball hits bumper
- `trackBallCollected(ballType)` - Called when gold ball collected
- `trackBallDrained()` - Called when ball drains
- `updateScore(currentScore)` - Update score goal
- `getProgress()` - Get overall progress (0-1)
- `isComplete()` - Check track completion

### 4. AdventureTrackProgression (`adventure-track-progression.ts`)
Track progression, unlocking, and difficulty system.

**Key Methods:**
- `completeTrack(trackId, score, goldBalls, rewards)` - Mark track complete
- `isTrackUnlocked(trackId)` - Check if track is unlocked
- `getAvailableTracks()` - Get all unlocked tracks
- `getStats()` - Get completion statistics

### 5. AdventureCameraSystem (`adventure-camera-system.ts`)
Smooth camera transitions between tracks.

**Key Methods:**
- `setCamera(camera)` - Set the ArcRotateCamera to control
- `transitionToTrack(trackId, duration)` - Transition to track camera
- `update(deltaTime)` - Update camera transition (call from loop)
- `isTransitioning()` - Check if camera is currently moving

## Integration Checklist

### Step 1: Initialize Systems in Game.ts
```typescript
// In your Game class constructor or initialization
this.goalTracker = new AdventureGoalTracker()
this.cameraSystem = new AdventureCameraSystem()
this.progression = new AdventureTrackProgression()

// When starting adventure mode
const trackId = 'NEON_HELIX'
this.goalTracker.initializeTrack(trackId)
this.cameraSystem.setCamera(this.followCamera)
this.cameraSystem.transitionToTrack(trackId, 1.0)
```

### Step 2: Update Game Loop
```typescript
// In your main update loop
if (this.gameMode === 'ADVENTURE') {
  this.goalTracker.update(deltaTime)
  this.cameraSystem.update(deltaTime)
  
  // Update goals based on game events
  // (hook into existing event handlers)
}
```

### Step 3: Hook Game Events to Goal Tracking
When bumpers are hit, balls collected, etc.:

```typescript
// When ball hits bumper
onBumperHit() {
  this.goalTracker.trackBumperHit()
}

// When gold ball collected
onGoldBallCollected(ballType: string) {
  this.goalTracker.trackBallCollected(ballType)
}

// When ball drains
onBallDrained() {
  this.goalTracker.trackBallDrained()
}

// Every time score updates
updateScore(score: number) {
  this.goalTracker.updateScore(score)
}
```

### Step 4: Display Goals in UI
```typescript
// In your HUD/UI rendering code
const goals = this.goalTracker.getGoals()
for (const goal of goals) {
  const progress = goal.current / goal.target
  // Render goal progress bar: progress (0-1)
  // Show goal title: goal.title
  // Show current/target: ${goal.current}/${goal.target}
}

// Show overall progress
const completionPercent = this.goalTracker.getCompletionPercentage()
// Render overall progress bar
```

### Step 5: Handle Track Completion
```typescript
// Check on each update
if (this.goalTracker.isComplete()) {
  const reward = this.goalTracker.getTotalReward()
  
  // Mark track complete in progression
  this.progression.completeTrack(
    trackId,
    this.score,
    collectedGoldBalls,
    reward
  )
  
  // Show completion screen
  showTrackCompleteScreen(trackId, reward)
  
  // Unlock next track and show options
  const available = this.progression.getAvailableTracks()
  showTrackSelection(available)
}
```

## Goal Types

- **score-based**: Reach a target score
- **collection-based**: Collect a certain number of items (gold balls)
- **survival**: Maintain play for a duration (seconds)
- **combo-based**: Land consecutive hits without missing
- **hit-all**: Hit all elements of a specific type

## Example: Adding a New Track's Goals

```typescript
// In adventure-track-goals.ts
export const MY_NEW_TRACK_GOALS: AdventureGoal[] = [
  createGoal(
    'mytrack-score',
    'Reach 75,000 Points',
    'Score 75,000 points on My New Track',
    'score-based',
    75000,
    5000  // reward points
  ),
  // ... more goals
]

// Update getGoalsForTrack()
'MY_NEW_TRACK': MY_NEW_TRACK_GOALS,
```

## Example: Adding a Camera Preset

```typescript
// In adventure-camera-system.ts
MY_NEW_TRACK: {
  alpha: -Math.PI / 2,
  beta: 1.15,
  radius: 16,
  fov: 0.8,
  label: 'My New Track View'
}
```

## Performance Notes

- Goal updates are O(1) for individual goals
- Camera transitions use lerp (no expensive operations)
- All systems use event-driven updates (no polling)
- Memory footprint is minimal (goals stored as plain objects)

## Testing

Goals can be tested independently:
```typescript
const goalSystem = new AdventureGoalSystem()
const goals = getGoalsForTrack('NEON_HELIX')
goalSystem.initializeGoals('NEON_HELIX', goals)

goalSystem.updateGoal('helix-score', 50000) // Goal completes
goalSystem.updateGoal('helix-gold', 5)       // Goal completes
goalSystem.updateGoal('helix-survive', 30)   // Goal completes

assert(goalSystem.isComplete() === true)
assert(goalSystem.getTotalReward() === expected)
```

## Future Enhancements

- [ ] Goal achievement notifications/animations
- [ ] Difficulty modifiers (hard mode = increased targets)
- [ ] Leaderboard integration
- [ ] Replay system with goal tracking
- [ ] Challenge modes with custom goal sets
- [ ] Seasonal goals/events
