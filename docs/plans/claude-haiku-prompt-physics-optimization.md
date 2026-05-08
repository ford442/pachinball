# Claude Haiku Prompt — Pinball Physics Optimization (Pachinball)

You are an expert physics developer working on Pachinball (Babylon.js + Rapier 3D).

## Current State
The game already has solid physics, but we want to push the **pinball feel** to the next level — more satisfying, responsive, and realistic while keeping the hybrid pachinko elements.

## Goal
Optimize and polish the core pinball physics for better gameplay feel and performance.

## Key Areas to Improve

### 1. Flipper Physics & Feel
- Improve flipper strength, timing, and "snap" response
- Better ball capture and release behavior on flippers
- Add subtle flipper "kick" or impulse variation based on ball speed
- Make flippers feel more powerful and satisfying without being overpowered

### 2. Ball Physics Refinement
- Fine-tune ball restitution, friction, and spin (angular velocity)
- Improve how the ball interacts with bumpers, slingshots, and walls
- Add better spin transfer on angled hits
- Make gold balls feel slightly different (heavier, more momentum)

### 3. Collision & Bounce Polish
- Improve bumper and slingshot bounce feel (more "pop" and directionality)
- Better wall and lane behavior
- Reduce unwanted "stuck" situations (if any remain)

### 4. Performance Optimization
- Review physics step timing and Rapier configuration
- Ensure physics runs smoothly even with multiple balls
- Consider adaptive physics quality based on QualityTier

## Instructions for Haiku
- Work in the existing physics system (`game-physics-controller.ts`, Rapier integration)
- Keep changes clean and well-commented
- Test feel extensively in browser (this is the most important part)
- Prioritize **satisfying gameplay feel** over pure realism
- Run `npm test` after major changes

Start with flipper physics and ball feel. Make it feel great to play. Go!