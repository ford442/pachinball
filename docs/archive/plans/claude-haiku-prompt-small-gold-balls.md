# Claude Haiku Prompt — Multiple Small Gold Balls Mechanic (Pachinball)

You are an expert gameplay and physics developer working on Pachinball.

## Goal
Implement a fun and chaotic **"Swarm of Small Gold Balls"** mechanic as an alternative (or addition) to the single heavy gold ball.

## Concept
When a gold ball is collected or triggered, instead of one big gold ball, spawn **3–5 smaller gold balls** that behave differently.

## Key Features to Implement

### 1. Spawning System
- When a gold ball trigger happens, spawn multiple smaller gold balls
- Spawn them with slight random velocity and direction for natural spread
- Nice spawn visual effect (burst of particles + glow)

### 2. Physics Differentiation
- Smaller gold balls should feel:
  - Lighter and faster
  - More bouncy (higher restitution)
  - More chaotic movement
  - Stronger spin response

### 3. Visual Polish
- Smaller size with bright gold material + strong emissive glow
- Beautiful particle trails (different from normal balls)
- Subtle pulsing glow effect
- When they stack or group, nice visual feedback

### 4. Gameplay & Scoring
- Each small gold ball gives points when collected
- Bonus multiplier if the player collects all of them quickly
- Possible combo chaining if they hit bumpers in quick succession

### 5. Performance & Cleanup
- Limit maximum number of small gold balls at once
- Auto-cleanup after a certain time or when they go out of bounds
- Keep everything performant even with multiple balls active

## Instructions for Haiku
- Work in `BallManager` and the gold ball spawning system
- Make the small gold balls feel distinct and exciting
- Add good visual feedback
- Keep the code clean and performant
- Test the fun factor extensively

Start with the spawning system and physics differentiation. Make collecting gold balls feel explosive and rewarding. Go!