# Architecture Documentation

## Project Structure

The codebase has been refactored into a modular architecture for better maintainability and scalability.

### Main Entry Points
- `src/main.ts` - Application bootstrap and engine initialization
- `src/game.ts` - Main game orchestrator class (525 lines)

### Game Elements (`src/game-elements/`)

The game logic has been separated into focused modules:

#### Core Systems
- **`physics.ts`** (41 lines) - Rapier physics engine integration
  - Physics world management
  - Collision event handling
  - Gravity configuration

- **`types.ts`** (47 lines) - Shared TypeScript interfaces and enums
  - GameState, DisplayState enums
  - PhysicsBinding, BumperVisual, CaughtBall interfaces
  - Common type definitions

#### Game Object Management
- **`game-objects.ts`** (424 lines) - Scene objects and physics bodies
  - Ground, walls, flippers, bumpers
  - Pachinko field pins
  - Slingshots and targets
  - Collision body management

- **`ball-manager.ts`** (220 lines) - Ball lifecycle and behavior
  - Main ball creation and reset
  - Extra ball spawning
  - Ball removal and loss handling
  - Hologram catch mechanics

#### Visual & Display
- **`display.ts`** (355 lines) - Backbox display and slot machine
  - WGSL shader reels (WebGPU)
  - Canvas-based fallback reels
  - Display states (IDLE, REACH, FEVER)
  - Overlay and scanline effects

- **`effects.ts`** (167 lines) - Visual and audio effects
  - Audio beeps and feedback
  - Particle system (shards)
  - Bloom post-processing
  - Cabinet lighting animations

#### Input & Modes
- **`input.ts`** (140 lines) - Player input handling
  - Keyboard controls
  - Touch controls
  - Flipper, plunger, nudge actions
  - Game state-aware input

- **`adventure-mode.ts`** (152 lines) - Holo-deck adventure mode
  - Dynamic track generation
  - Camera management
  - Mode activation/deactivation

#### Module Exports
- **`index.ts`** (8 lines) - Central export point for all game elements

## Benefits of This Architecture

1. **Separation of Concerns** - Each module has a single, clear responsibility
2. **Maintainability** - Smaller files are easier to understand and modify
3. **Testability** - Isolated modules can be tested independently
4. **Scalability** - New features can be added without touching core game logic
5. **Reusability** - Systems can be reused or swapped out easily

## Module Dependencies

```
game.ts
  ├── physics.ts
  ├── display.ts (uses types.ts)
  ├── effects.ts (uses types.ts)
  ├── game-objects.ts (uses types.ts, physics)
  ├── ball-manager.ts (uses types.ts, physics)
  ├── adventure-mode.ts (uses physics)
  └── input.ts (uses types.ts)
```

## Adding New Features

To add new game mechanics:

1. Determine which module(s) are affected
2. Add necessary types to `types.ts` if needed
3. Implement feature in the appropriate module
4. Update `game.ts` to orchestrate the new feature
5. Export new classes/functions from `index.ts` if they're used elsewhere

## Code Organization Principles

- **Keep modules focused** - Each file should handle one aspect of the game
- **Use dependency injection** - Pass required dependencies to constructors
- **Maintain clear interfaces** - Public methods should be well-documented
- **Minimize coupling** - Modules should depend on interfaces, not implementations
