# EventBus Integration Guide - Full Implementation

This guide walks through integrating the EventBus system with all gameplay systems (obstacles, goals, cinematics, effects).

## Architecture Overview

```
Obstacles (Spinners, Traps, Launchers, Gates)
         ↓ emit events
    EventBus
         ↓ broadcast to listeners
    ├─→ Scoring System (award points)
    ├─→ Effects System (flash, bloom, shake)
    ├─→ Audio System (play sounds, adjust music)
    └─→ Adventure Goals (track progress)

Adventure System (Goals, Progression)
         ↓ emit events
    EventBus
         ↓ broadcast to listeners
    ├─→ Cinematics (trigger sequences)
    ├─→ Scoring (award bonuses)
    └─→ Effects (celebrate completions)
```

## Phase 1: Update Obstacle Builders

### Spinner Bumper Integration

```typescript
// In object-spinner-bumpers.ts

import type { EventBus } from '../game/event-bus'
import { ObstacleEventBusIntegration } from '../game-elements/obstacle-eventbus-integration'

export class SpinnerBumperBuilder {
  private eventBus: ObstacleEventBusIntegration | null = null

  setEventBus(eventBus: EventBus | null): void {
    this.eventBus = eventBus ? new ObstacleEventBusIntegration(eventBus) : null
  }

  // In createSpinnerBumper(), after setting up physics:
  private triggerCollision(spinnerId: string, position: Vector3, force: number): void {
    if (this.eventBus) {
      // Emit spinner hit event
      this.eventBus.emitSpinnerHit(spinnerId, {
        x: position.x,
        y: position.y,
        z: position.z
      }, force)
      
      // Emit points
      this.eventBus.emitPointsAwarded(100, 'spinner-hit')
      
      // Emit effect
      this.eventBus.emitFlashEffect(0.5, '#00ffff')
      this.eventBus.emitPlaySound('bump-spinner')
    }
  }

  updateSpinner(state: SpinnerBumperVisual, dt: number): void {
    // ... existing rotation logic ...
    
    // Emit rotation progress
    const rotationProgress = (state.rotationSpeed % (Math.PI * 2)) / (Math.PI * 2)
    this.eventBus?.emitSpinnerRotation('spinner-id', state.rotationSpeed, rotationProgress)
    
    // Check for full rotation
    if (state.angularVelocity > 10) {
      this.eventBus?.emitSpinnerFullRotation('spinner-id', 1)
    }
  }
}
```

### Ball Trap Integration

```typescript
// In object-ball-traps.ts

export class BallTrapBuilder {
  private eventBus: ObstacleEventBusIntegration | null = null

  setEventBus(eventBus: EventBus | null): void {
    this.eventBus = eventBus ? new ObstacleEventBusIntegration(eventBus) : null
  }

  catchBall(state: BallTrapState, ballId: string, position: Vector3): void {
    // ... existing catch logic ...
    
    if (this.eventBus) {
      this.eventBus.emitTrapBallCaptured('trap-1', ballId, {
        x: position.x,
        y: position.y,
        z: position.z
      })
      this.eventBus.emitPointsAwarded(50, 'ball-captured')
      this.eventBus.emitPlaySound('trap-catch')
    }
  }

  releaseBallWithBoost(state: BallTrapState, exitVelocity: Vector3): void {
    // ... existing release logic ...
    
    if (this.eventBus) {
      this.eventBus.emitTrapBallReleased('trap-1', 'ball-id', {
        x: exitVelocity.x,
        y: exitVelocity.y,
        z: exitVelocity.z
      })
      this.eventBus.emitPointsAwarded(100, 'ball-released')
      this.eventBus.emitPlaySound('trap-release')
      this.eventBus.emitFlashEffect(0.3, '#ffff00')
    }
  }
}
```

### Launcher Integration

```typescript
// In object-launchers.ts

export class LauncherBuilder {
  private eventBus: ObstacleEventBusIntegration | null = null

  setEventBus(eventBus: EventBus | null): void {
    this.eventBus = eventBus ? new ObstacleEventBusIntegration(eventBus) : null
  }

  updateLauncher(state: LauncherState, dt: number): void {
    // ... existing charge logic ...
    
    if (this.eventBus && state.isCharging) {
      this.eventBus.emitLauncherCharged('launcher-1', state.chargeLevel)
    }
  }

  fireLauncher(state: LauncherState): { force: { x: number; y: number; z: number }; wasCharged: boolean } {
    const result = { /* ... */ }
    
    if (this.eventBus) {
      this.eventBus.emitLauncherFired('launcher-1', 'ball-id', result.force, 
        state.isCharging ? state.chargeLevel : 1.0)
      this.eventBus.emitPointsAwarded(50, 'launcher-fire')
      this.eventBus.emitPlaySound('launcher-fire')
    }
    
    return result
  }
}
```

### Moving Gate Integration

```typescript
// In object-moving-gates.ts

export class MovingGateBuilder {
  private eventBus: ObstacleEventBusIntegration | null = null

  setEventBus(eventBus: EventBus | null): void {
    this.eventBus = eventBus ? new ObstacleEventBusIntegration(eventBus) : null
  }

  openGate(state: MovingGateState, duration: number = 0.5): void {
    state.isOpen = true
    
    if (this.eventBus) {
      this.eventBus.emitGateOpened('gate-1', state.openDuration)
      this.eventBus.emitPlaySound('gate-open')
      this.eventBus.emitFlashEffect(0.4, '#00ff00')
    }
    
    this.animateGateOpening(state, duration)
  }

  closeGate(state: MovingGateState, duration: number = 0.5): void {
    state.isOpen = false
    
    if (this.eventBus) {
      this.eventBus.emitGateClosed('gate-1')
      this.eventBus.emitPlaySound('gate-close')
    }
    
    this.animateGateClosing(state, duration)
  }
}
```

## Phase 2: Adventure System Integration

### Goal Tracker with EventBus

```typescript
// In adventure-goal-tracker.ts

export class AdventureGoalTracker {
  private eventBusIntegration: AdventureEventBusIntegration | null = null

  setEventBus(eventBus: EventBus | null): void {
    this.eventBusIntegration = eventBus 
      ? new AdventureEventBusIntegration(eventBus) 
      : null
  }

  update(deltaTime: number): void {
    // ... existing update ...
    
    this.goalSystem.onProgress((goal) => {
      if (this.eventBusIntegration) {
        this.eventBusIntegration.emitGoalProgress(
          goal.id,
          this.currentTrackId,
          goal.current,
          goal.target,
          goal.title
        )
      }
    })

    this.goalSystem.onComplete((goal) => {
      if (this.eventBusIntegration) {
        this.eventBusIntegration.emitGoalCompleted(
          goal.id,
          this.currentTrackId,
          goal.title,
          goal.reward
        )
        this.eventBusIntegration.emitPointsAwarded(goal.reward, 'goal-complete')
        this.eventBusIntegration.emitPlaySound('goal-complete')
      }
    })
  }
}
```

### Cinematic Triggers with EventBus

```typescript
// In adventure-cinematic-triggers.ts

export class AdventureCinematicTriggers {
  private cinematics: AdventureCinematicSystem
  private eventBusIntegration: AdventureEventBusIntegration | null = null

  setEventBus(eventBus: EventBus | null): void {
    this.eventBusIntegration = eventBus 
      ? new AdventureEventBusIntegration(eventBus) 
      : null
  }

  update(): void {
    // ... existing trigger logic ...
    
    // Listen for goal completion and trigger cinematic
    if (this.goalTracker.isComplete()) {
      this.cinematics.playTrackComplete('Current Track')
      
      if (this.eventBusIntegration) {
        this.eventBusIntegration.emitCinematicStarted('track-complete', 2.5)
      }
    }
  }

  onTrackStart(trackName: string): void {
    this.cinematics.playTrackStart(trackName)
    
    if (this.eventBusIntegration) {
      this.eventBusIntegration.emitCinematicStarted('track-start', 2.0)
      this.eventBusIntegration.emitPlaySound('track-intro')
    }
  }
}
```

## Phase 3: Game.ts Integration

### Setup EventBus Listeners

```typescript
// In game.ts constructor or initialization

private setupEventBusListeners(): void {
  // Obstacle events → Effects
  (this.eventBus as any).on?.('bumper:spinner:hit', (data: any) => {
    this.effects?.playScreenFlash(new Color3(0, 1, 1), 0.5)
    this.sound?.play('bump')
  })

  // Goal completion → Scoring and Effects
  (this.eventBus as any).on?.('goal:completed', (data: any) => {
    this.score += data.reward
    this.effects?.playScreenFlash(new Color3(1, 1, 0), 0.6)
    this.sound?.play('goal-complete')
  })

  // Cinematic events → UI and Time Control
  (this.eventBus as any).on?.('cinematic:started', (data: any) => {
    this.isGameplayActive = false
    this.pauseGameplay()
  })

  (this.eventBus as any).on?.('cinematic:finished', (data: any) => {
    this.isGameplayActive = true
    this.resumeGameplay()
  })

  // Points awarded → Score update
  (this.eventBus as any).on?.('points:awarded', (data: any) => {
    this.score += data.amount * (data.multiplier ?? 1)
    this.updateHUD()
  })

  // Effects → Apply visual feedback
  (this.eventBus as any).on?.('effect:flash', (data: any) => {
    const color = data.color ? Color3.FromHexString(data.color) : Color3.White()
    this.effects?.flashScreen(color, data.intensity, data.duration)
  })

  (this.eventBus as any).on?.('effect:shake', (data: any) => {
    this.camera?.shake(data.amount, data.duration)
  })
}
```

### Wire Up Builders with EventBus

```typescript
// In game.ts initialization

this.spinnerBuilder = new SpinnerBumperBuilder(scene, world, rapier)
this.spinnerBuilder.setEventBus(this.eventBus)

this.trapBuilder = new BallTrapBuilder(scene, world, rapier)
this.trapBuilder.setEventBus(this.eventBus)

this.launcherBuilder = new LauncherBuilder(scene, world, rapier)
this.launcherBuilder.setEventBus(this.eventBus)

this.gateBuilder = new MovingGateBuilder(scene, world, rapier)
this.gateBuilder.setEventBus(this.eventBus)

// Adventure systems
this.goalTracker = new AdventureGoalTracker()
this.goalTracker.setEventBus(this.eventBus)

this.cinematicTriggers = new AdventureCinematicTriggers(this.cinematicSystem)
this.cinematicTriggers.setEventBus(this.eventBus)
```

## Event Flow Examples

### Example 1: Ball Hits Spinner → Chain Reaction

```
Ball hits spinner
  ↓
SpinnerBumper emits 'bumper:spinner:hit'
  ↓
EventBus broadcasts to listeners
  ├─→ Effects System plays flash + shake
  ├─→ Audio System plays bump sound
  ├─→ Scoring System awards 100 points
  └─→ Adventure Goal Tracker increments bumper hit count
         ↓
      If combo count reaches 3:
         ├─→ Emit 'combo:extended' event
         ├─→ Increase point multiplier
         └─→ Play combo sound
```

### Example 2: Goal Complete → Cinematic → Effects Chain

```
Last goal completed
  ↓
AdventureGoalTracker emits 'goal:completed'
  ↓
EventBus broadcasts
  ├─→ Scoring System awards 5000 points
  ├─→ Cinematic System triggers celebration sequence
  │     ├─→ Camera zooms in
  │     ├─→ Emits 'cinematic:started' event
  │     └─→ Screen flashes with celebratory colors
  │
  └─→ When cinematic finishes:
         ├─→ Emits 'cinematic:finished'
         ├─→ Game resumes normal play
         └─→ Track unlocks next adventure track
             └─→ Emits 'track:unlocked'
```

## Testing Event Chains

```typescript
// Unit test for event chain
import { EventBus } from './game/event-bus'

const eventBus = new EventBus()
const integration = new ObstacleEventBusIntegration(eventBus)

let eventsFired: string[] = []

(eventBus as any).on?.('bumper:spinner:hit', () => {
  eventsFired.push('spinner-hit')
})

(eventBus as any).on?.('points:awarded', () => {
  eventsFired.push('points')
})

(eventBus as any).on?.('effect:flash', () => {
  eventsFired.push('flash')
})

integration.emitSpinnerHit('spinner-1', { x: 0, y: 0, z: 0 }, 10)
integration.emitPointsAwarded(100, 'spinner-hit')
integration.emitFlashEffect(0.5, '#00ffff')

expect(eventsFired).toEqual(['spinner-hit', 'points', 'flash'])
```

## Best Practices

1. **Always check for null**: EventBus integration is optional
   ```typescript
   if (this.eventBus) {
     this.eventBus.emitSomething(...)
   }
   ```

2. **Use consistent naming**: `object:action:state`
   - `bumper:spinner:hit`
   - `trap:ball:captured`
   - `gate:state-changed`

3. **Include rich payload data**: More data enables more flexible listeners
   - Position for location-based effects
   - Force for intensity scaling
   - Duration for animation length

4. **Avoid circular dependencies**: Don't emit events in response to events
   - Use callbacks instead for synchronous reactions
   - Emit events for asynchronous/external system updates

5. **Keep event handlers fast**: Listeners shouldn't do heavy computation
   - Offload to next frame or async tasks
   - EventBus should emit in < 1ms total

## Debugging Events

Add a debug listener to see all events:

```typescript
if (DEBUG_EVENTS) {
  (this.eventBus as any).on?.('*', (eventName: string, data: unknown) => {
    console.log(`[EVENT] ${eventName}:`, data)
  })
}
```

Or listen to specific events:

```typescript
const hookEvent = (eventName: string) => {
  (this.eventBus as any).on?.(eventName, (data: any) => {
    console.log(`[${eventName}]`, data)
  })
}

hookEvent('bumper:spinner:hit')
hookEvent('goal:completed')
hookEvent('cinematic:started')
```
