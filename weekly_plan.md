# Weekly Development Plan: Gold Pachinko Balls Feature

## Overview
This week we're introducing **Gold Pachinko Balls** as special collectible items within the machine. These premium balls will add visual richness and create distinct gameplay moments as players collect and stack them.

---

## Feature: Gold Pachinko Balls

### Visual Variants

#### Gold-Plated Balls
- **Appearance:** Lighter, more reflective surface with subtle highlights
- **Material Properties:** 
  - High metallic factor
  - Lower roughness for polished look
  - Subtle specular highlights
  - Slight yellow/warm tone overlay
- **Purpose:** Common premium variant, earns standard bonus points

#### Solid Gold Balls
- **Appearance:** Deeper, richer gold color with premium material definition
- **Material Properties:**
  - Rich yellow-gold base color
  - Higher metallic saturation
  - Controlled roughness for realistic precious metal appearance
  - Strong reflectivity with warm light response
- **Purpose:** Rare jackpot variant, high-value scoring moment

### Visual Implementation
- **PBR Materials:** Leverage existing PBR system (see MATERIAL_PBR_AUDIT_REPORT.md)
- **Material Definitions:**
  - Create separate metallic material slots for each variant
  - Define albedo, normal maps, roughness, and metallic parameters
  - Ensure proper light interaction under varying cabinet lighting conditions
- **Visual Distinction:** Both variants must be instantly recognizable to players during gameplay

### Ball Stacking & Counting Mechanics
- Balls accumulate as they're collected, simulating traditional pachinko ball counting
- Stacking creates visual feedback for player progress
- Rare solid gold balls create memorable collection moments with special effects

### Integration Points
- **Scoring System:** Gold ball collection triggers bonus points
- **Game State:** Ball collection tracked and displayed
- **Visual Feedback:** Balls reflect cabinet lighting for immersive gameplay
- **Cabinet Reactions:** Lighting and effects sync with gold ball collection events

---

## Technical References
- MATERIAL_PBR_AUDIT_REPORT.md - PBR material system
- PLAN.md - Overall game architecture
- PHYSICS_AUDIT_MASTER.md - Ball physics integration

from Gemini 3.1 pro:
1. Gameplay Enhancements (The "Gold Ball" Feature)
Your weekly plan clearly outlines the introduction of premium collectible items that affect scoring and visual feedback.

Introduce Ball Tiers: You need to implement the two distinct visual variants: the "Gold-Plated" ball (a common premium variant for standard bonus points) and the rare "Solid Gold" ball (a jackpot variant for high-value scoring moments).

Implement Stacking/Counting: Instead of balls just disappearing when they drain, you need a visual representation of them accumulating. This stacking simulates traditional pachinko ball counting and gives players immediate visual feedback on their progress.

Tie Collection to Cabinet Reactions: When a player collects a rare solid gold ball, it should trigger special lighting effects and cabinet reactions to create a memorable gameplay moment.

2. Codewise Implementation Steps
To make the gameplay features above a reality, you will need to modify several core systems currently imported and initialized within src/game.ts:

Update MaterialLibrary (Visuals): You will need to define separate metallic PBR material slots for the new variants. For the Gold-Plated balls, set a high metallic factor with lower roughness and a subtle yellow tint; for Solid Gold, use a deeper yellow-gold albedo, higher metallic saturation, and strong reflectivity.

Modify BallManager: Currently, BallManager handles standard balls and skins. You must extend this class to assign types/tags to balls upon spawning (e.g., standard, gold-plated, solid-gold) and apply the correct PBR materials from the MaterialLibrary.

Update Collision and Scoring Logic: Inside src/game.ts, locate the processCollision method and the handleBallLoss method (where balls currently drain). You will need to check the "type" of the ball when it drains. If it is a gold variant, add it to a new goldBallCount variable in your game state, trigger the bonus score addition, and execute the physical stacking animation.

Integrate with EffectsSystem: When a solid gold ball is collected, call methods on your EffectsSystem (which already handles things like startJackpotSequence() and setAtmosphereState()) to sync the cabinet lighting and visual flair with the gold ball collection event.

By extending your BallManager and MaterialLibrary to support these new ball types, and updating your scoring handlers in game.ts to recognize them, you will seamlessly connect your physics engine with your new progression loops.


from gpt 5.4:
Copilot said: Here are the most obvious next steps
Here are the most obvious next steps to improve Pachinball both codewise and as a game, based on the repo context you shared.

Codewise next steps
Strengthen module boundaries

Keep game.ts thin and use the src/game-elements/ split consistently.
Verify each responsibility lives in the right file:
game-objects.ts for flippers, bumpers, walls, pins
ball-manager.ts for spawning/resetting/catching balls
display.ts for reels, score, LED/backbox
effects.ts for particles, bloom, audio triggers
physics.ts for Rapier init/step/collision wiring
adventure-mode.ts for Holo-deck mode
Add a clearer game state flow

Formalize transitions between IDLE, PLAYING, mode-specific states, and game-over/game-reset.
Make state changes event-driven so features like multiball, jackpots, or adventure mode can hook in cleanly.
Improve physics/gameplay separation

Keep all Rapier configuration in physics.ts.
Make ball and object managers consume physics services rather than configure physics themselves.
This will make tuning easier and prevent accidental coupling.
Create a unified event system

Emit game events like:
ball drained
bumper hit
jackpot reached
mode started/ended
multiball started
Let display/effects/audio subscribe to those events instead of calling each other directly.
Add tuning/config data

Move gameplay constants into config objects or JSON/TS config modules.
Examples:
bumper force
flipper impulse
ball spawn count
scoring thresholds
fever mode timing
This will make balancing much faster.
Harden async initialization

Ensure assets, Babylon meshes, and Rapier init all resolve before gameplay starts.
Add a loading phase that cleanly gates input and scene setup.
Add tests for core logic

Especially for:
state transitions
scoring rules
mode triggers
ball lifecycle
Even a small suite will help as the game gets more complex.
Add diagnostics/debug tools

On-screen debug overlay for:
current game state
physics step info
active balls
scores/multipliers
mode timers
This will make balancing and bug hunting much easier.
Game design next steps
Make the core loop more explicit

Right now the biggest opportunity is to clarify the “why” of play:
What is the main objective?
How does the player progress?
What unlocks the adventure mode?
Give the player a visible short-term and long-term goal.
Add progression and rewards

Examples:
multipliers
combo chains
mode unlocks
meta-progress between runs
achievement-style bonuses
This gives the game more staying power than just “hit things and score.”
Differentiate zones

Create distinct table regions with unique behavior:
pin field
flipper zone
bonus lanes
adventure/Holo-deck zone
jackpot path
Each zone should feel meaningfully different.
Deepen the slot-machine/backbox layer

The backbox can become a real meta-system:
award multipliers
trigger temporary rules
spawn special balls
activate fever mode
influence table behavior
This is a great place to make the hybrid identity feel unique.
Add more signature events

Big arcade games are built around memorable moments:
jackpot
multiball chaos
fever mode
mini-boss/adventure sequence
table-wide light shows
Make each one visually and sonically obvious.
Improve feedback

Use stronger feedback for:
hits
combos
mode activation
near misses
jackpots
Better feedback makes the game feel much more polished even without huge content changes.
Balance risk vs reward

Pachinko-style randomness can be fun, but players need some agency.
Ensure flippers, bumps, and skill shots can consistently influence outcomes.
Make lucky outcomes possible, but skillful play rewarding.
Expand adventure mode

Since adventure-mode.ts already exists as a distinct concept, it’s a natural place to build a second gameplay layer:
mission objectives
temporary rule changes
special targets
themed encounters
This could become the standout feature of the whole game.
Highest-value immediate priorities
If you want the best return on effort, I’d prioritize these first:

Event system
State flow cleanup
Gameplay tuning/config extraction
Backbox/reward progression
Adventure mode expansion
Debug overlay + tests
Suggested roadmap
Short term
Clean up state handling
Add event bus / signal system
Extract gameplay constants
Add debug HUD
Mid term
Improve scoring/multiplier systems
Add more distinct table zones
Strengthen backbox/slot-machine rewards
Polish audio/visual feedback
Long term
Expand adventure mode into a full secondary loop
Add missions, unlocks, and meta-progression
Add more table layouts, modes, or themes

