# Claude Haiku Prompt — Advanced Ball Physics Mechanics (Pachinball)

You are an expert physics developer working on Pachinball (Babylon.js + Rapier 3D).

## Goal
Implement **advanced ball physics mechanics** to make the ball behavior feel more realistic, dynamic, and fun — while keeping the hybrid pachinko/pinball identity.

## Key Advanced Features

### 1. Enhanced Spin & Angular Velocity
- Improve how the ball gains and loses spin on different surfaces (bumpers, walls, flippers)
- Add visible spin effects (ball trails that react to spin)
- Allow skilled play to influence ball direction through spin

### 2. Ball "English" (Side Spin)
- On certain angled hits (especially flippers and slingshots), apply subtle side spin
- This creates more interesting and unpredictable ball paths

### 3. Surface-Specific Bounce Behavior
- Different restitution and friction values for:
  - Metal bumpers (high bounce)
  - Plastic walls (medium)
  - Rubber elements (high energy return)
  - Playfield surface (slightly grippy)

### 4. Gold Ball Differentiation
- Make gold balls feel distinct:
  - Slightly heavier (more momentum)
  - Different bounce characteristics
  - Stronger spin response
  - More dramatic trails and effects

### 5. Advanced Multi-Ball Interactions
- Better collision handling when multiple balls are in play
- Prevent balls from getting stuck together
- Add subtle "push" behavior between balls

## Technical Guidelines
- Work primarily in `BallManager`, physics controller, and Rapier configuration
- Use Rapier’s advanced contact and impulse features where helpful
- Keep everything performant (especially with 3+ balls)
- Make effects QualityTier-aware

## Instructions for Haiku
- Focus on **fun and satisfying ball behavior**
- Make changes feel natural and polished
- Add good comments explaining the physics choices
- Test extensively in browser

Start with **Enhanced Spin** and **Gold Ball Differentiation**. Make the balls feel alive. Go!