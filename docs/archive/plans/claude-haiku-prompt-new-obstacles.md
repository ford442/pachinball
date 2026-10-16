# Claude Haiku Prompt — New Physics-Based Obstacles & Mechanisms (Pachinball)

You are an expert gameplay and physics developer working on Pachinball.

## Goal
Design and implement **new bumpers, traps, and physics-based obstacles/mechanisms** to add variety, strategy, and excitement to the tables.

## Suggested New Elements (Pick 2–4 to implement)

### 1. Advanced Bumper Types
- **Rotating / Spinner Bumpers** — Bumpers that spin when hit and deflect the ball in different directions
- **Multi-Hit Bumpers** — Bumpers that require 2–3 hits to activate a special effect or jackpot
- **Explosive / Chain Bumpers** — When hit hard, they trigger a chain reaction with nearby bumpers

### 2. Traps & Ball Control
- **Ball Traps** — Temporary traps that catch and hold a ball for a short time, then release it with extra speed
- **Magnetic / Attractor Traps** — Pull the ball toward a certain area for a limited time
- **Drop Targets** — Targets that lower when hit and can trigger events when all are down

### 3. Dynamic Mechanisms
- **Moving Walls / Gates** — Walls or gates that open/close on timers or when triggered
- **Launchers / Catapults** — Mechanisms that launch the ball with high force in a specific direction
- **Flipper Gates** — Small flipper-like gates that can redirect the ball

### 4. Hybrid Pachinko-Pinball Elements
- **Pin Rows with Physics** — Rows of small pins that the ball bounces through (classic pachinko feel)
- **Spinning Reels / Wheels** — Large spinning wheels that the ball can interact with

## Instructions for Haiku
- Focus on **fun, fair, and satisfying** gameplay
- Make sure new elements integrate well with existing physics and scoring
- Use the EventBus for triggering effects and scoring
- Keep everything performant (especially with multiple balls)
- Add nice visual and audio feedback
- Make them QualityTier-aware if possible

## Output Expectations
- Clean, well-commented code
- Good balance between new mechanics and existing gameplay
- Test thoroughly for fun factor and fairness

Start with **1–2 new bumper types** and **1 trap mechanism**. Make the tables feel much more dynamic and interesting. Go!