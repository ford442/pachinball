# Claude Haiku Prompt — Reactive Cabinet Lighting (Pachinball)

You are an expert Babylon.js developer working on Pachinball (a 3D hybrid pachinko + pinball game).

## Goal
Add beautiful, reactive RGB-style cabinet and edge lighting that feels premium and modern — inspired by 2025–2026 high-end pinball machines and modern Japanese pachinko cabinets.

## Design Direction (Modern Premium Look)
- Dark, glossy cabinet with vibrant, dynamic lighting
- Lighting should feel **alive** and tied to gameplay
- Use soft, high-quality glows rather than harsh retro effects
- Support QualityTier (rich effects on HIGH, simplified on LOW)

## Specific Features to Implement

### 1. RGB Edge Lighting (Cabinet Sides + Top)
- Add subtle RGB LED-style strips along the left, right, and top edges of the cabinet
- Colors should change based on game state:
  - IDLE → calm deep blue / purple
  - FEVER → warm pulsing gold + orange
  - JACKPOT → bright cyan + white flash
  - ADVENTURE → rich purple + cyan
- Gentle pulsing or breathing effect when in high-intensity modes

### 2. Under-Cabinet Glow
- Soft RGB strip under the main table
- Pulses or changes intensity based on ball hits, bumper activity, or current mode
- Creates a nice "floating table" effect

### 3. Backbox Screen Border Lighting
- Thin glowing border around the backbox display screen
- Color and intensity should sync with the current DisplayState (IDLE / FEVER / JACKPOT / etc.)

### 4. Event-Driven Reactions
- When big events happen (jackpot, fever start, gold ball collect, adventure start), trigger nice lighting bursts or color waves that travel along the edges

## Technical Guidelines
- Use Babylon.js PointLight + emissive materials or a lightweight custom shader
- Integrate with the existing EventBus (listen to `fever:start`, `jackpot:start`, `display:set`, etc.)
- Make it performant and QualityTier-aware
- Keep the code clean and well-organized

## Output Expectations
- Clean, commented code
- Nice visual result that feels modern and premium
- Works well with the current visual style of the game

Start with the RGB Edge Lighting system. Make it look fantastic. Go!