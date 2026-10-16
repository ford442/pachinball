# Claude Haiku Task — Launchers & Moving Gates (Pachinball)

**Repo**: https://github.com/ford442/pachinball  
**Focus**: Add Launchers and Moving Gates for dynamic gameplay.

## Goal
Implement **Launchers** and **Moving Gates** to create more interactive and strategic play.

## Features to Implement

### 1. Launchers
- Create `object-launchers.ts`
- High-powered launchers that shoot the ball in a specific direction with high velocity
- Can be triggered by hitting a target, entering a lane, or via EventBus
- Visual charging animation + powerful launch effect
- Configurable direction, force, and cooldown

### 2. Moving Gates
- Create `object-moving-gates.ts`
- Gates/walls that open and close on timers or triggers
- Smooth animation (slide, rotate, or lift)
- Can block or redirect ball paths
- Different types: timed gates, event-triggered gates, player-controlled gates (optional)

### 3. Integration
- Full EventBus support (can trigger scoring, lighting, modes, etc.)
- Proper physics colliders that update with gate movement
- QualityTier handling for visual complexity

### 4. Gameplay Value
- Create interesting shot opportunities and blocking strategies
- Use in adventure tracks or special modes for variety

## Instructions
- Focus on smooth animation and satisfying feel
- Make sure physics interactions remain stable
- Add good visual and audio feedback
- Keep the code clean and expandable

Start with Launchers, then add Moving Gates. Make the tables feel much more alive. Go!