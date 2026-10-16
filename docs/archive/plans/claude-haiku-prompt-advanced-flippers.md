# Claude Haiku Prompt — Advanced Flipper Mechanics (Pachinball)

You are an expert pinball physics developer working on Pachinball.

## Goal
Implement **advanced flipper mechanics** to make flipper play feel much more skillful, responsive, and satisfying — moving beyond basic flipper physics.

## Key Advanced Features to Add

### 1. Variable Flipper Strength (Hold-Time Based)
- Short tap = quick, weaker flip (good for precision)
- Longer hold = stronger, more powerful flip
- Add a small "charge" visual or audio cue

### 2. Live Catch / Post-Pass Mechanics
- Allow skilled players to "catch" the ball on the flipper and control its position
- Add slight upward impulse when the ball is caught at the right angle

### 3. Improved Ball-Flipper Collision Response
- Better spin transfer and angle control when the ball hits the flipper
- Prevent "dead bounces" (ball stopping dead on the flipper)
- Add subtle "nudge" effect when the ball is hit at different flipper positions

### 4. Flipper Timing Windows (Optional but nice)
- Add a small "perfect timing" bonus (extra power or different sound) when the player flips at the ideal moment

### 5. QualityTier Handling
- Make advanced behaviors available on MEDIUM and HIGH tiers
- LOW tier uses simpler, more forgiving flipper behavior

## Technical Notes
- Work in the existing flipper/input system (`inputActions`, physics controller)
- Use Rapier’s contact events and impulse application
- Keep the code clean and performant
- Test extensively for feel — this is critical

## Instructions for Haiku
- Prioritize **satisfying gameplay feel** and player skill expression
- Make changes incremental and testable
- Add clear comments explaining the advanced mechanics
- Run visual + physics tests after each major feature

Start with **Variable Flipper Strength** + **Improved Collision Response**. Make the flippers feel professional. Go!