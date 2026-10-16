# Claude Haiku Task — Full EventBus Integration for New Systems (Pachinball)

**Repo**: https://github.com/ford442/pachinball  
**Focus**: Connect all recently added systems to the EventBus for reactive, decoupled gameplay.

## Goal
Wire up **Spinner Bumpers, Ball Traps, Launchers, Moving Gates, Adventure Goals, and Cinematic System** to the EventBus so they can trigger effects, scoring, lighting, sound, and other systems cleanly.

## Systems to Integrate

### 1. Spinner Bumpers
- Emit events on hit (`bumper:spinner:hit`, `bumper:spinner:full-rotation`)
- Listen for mode changes to adjust behavior or visuals

### 2. Ball Traps
- Emit `trap:ball:captured`, `trap:ball:released`
- Trigger lighting, sound, and scoring events on capture/release

### 3. Launchers
- Emit `launcher:charged`, `launcher:fired`
- Allow other systems to trigger launchers via EventBus

### 4. Moving Gates
- Emit `gate:opened`, `gate:closed`, `gate:triggered`
- Support external triggering of gate state changes

### 5. Adventure Goals & Progression
- Emit `goal:progress`, `goal:completed`, `track:completed`, `track:unlocked`
- Connect goal completion to cinematic triggers and scoring

### 6. Cinematic System
- Listen for relevant events (`goal:completed`, `jackpot:start`, `track:start`) and trigger appropriate cinematic sequences
- Emit `cinematic:started`, `cinematic:finished`

## General Requirements

- Use consistent event naming conventions
- Add proper payload data where useful (e.g., ball ID, score amount, position)
- Make sure all new systems are fully reactive and decoupled
- Add good documentation/comments for each integration point
- Ensure no circular dependencies

## Instructions for Haiku
- Work systematically through each system
- Prioritize clean, maintainable EventBus usage
- Test that events fire correctly and trigger expected behavior
- Keep performance in mind (especially with multiple events firing)

Start with Spinner Bumpers and Ball Traps, then move through the rest. Make the whole game feel much more connected and alive. Go!