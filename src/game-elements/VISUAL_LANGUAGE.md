# Visual Language System

A unified design system for Pachinball that ensures visual consistency across all game systems, materials, lighting, and effects.

## Design Philosophy

- **CYBER/ARCADE/SCI-FI** identity
- **Dark structural surfaces** with **vibrant energy accents**
- **Cool vs Warm** temperature contrast (cyan vs magenta/gold)
- **Layered readability**: background < interactive < highlight < energy

## Quick Reference

```typescript
import { 
  PALETTE,      // Accent colors
  SURFACES,     // Structural colors  
  INTENSITY,    // Emissive power levels
  STATE_COLORS, // Game state mapping
  color,        // Hex → Color3 helper
  emissive,     // Hex + intensity helper
} from './visual-language'
```

## Color Palette

### Primary Accents (Energy & Interactive)

| Color | Hex | Usage |
|-------|-----|-------|
| **Cyan** | `#00d9ff` | Idle state, main interactive color |
| **Magenta** | `#ff00aa` | Jackpot, reward states |
| **Purple** | `#8800ff` | Deep energy, feeders |
| **Gold** | `#ffd700` | Fever mode, high energy |
| **Alert** | `#ff4400` | Danger, warning, reach state |
| **Matrix** | `#00ff44` | Adventure mode, cyber green |
| **White** | `#ffffff` | Pure energy, flash effects |
| **Ambient** | `#001133` | Subtle background glow |

### Surface Colors (Structural)

| Color | Hex | Usage |
|-------|-----|-------|
| **Void** | `#050505` | Deepest black, background |
| **Dark** | `#0a0a0a` | Cabinet panels |
| **Metal Dark** | `#151515` | Brushed metal, rails |
| **Metal Light** | `#888888` | Chrome, polished |
| **Playfield** | `#080818` | Table surface (blue tint) |
| **Glass** | `#001122` | Smoked glass, barriers |

## Intensity Levels

Standardized emissive power multipliers:

```typescript
INTENSITY.AMBIENT  // 0.2 - Background elements
INTENSITY.NORMAL   // 0.5 - Operational glow
INTENSITY.ACTIVE   // 1.0 - Interactive engaged
INTENSITY.HIGH     // 1.5 - Fever, jackpot
INTENSITY.FLASH    // 2.0 - Impacts, transitions
INTENSITY.BURST    // 3.0 - Bloom spikes
```

## State Colors

All game states map to consistent colors:

```typescript
STATE_COLORS.IDLE      // Cyan
STATE_COLORS.REACH     // Alert red
STATE_COLORS.FEVER     // Gold
STATE_COLORS.JACKPOT   // Magenta
STATE_COLORS.ADVENTURE // Matrix green
```

## Helper Functions

### `color(hex: string): Color3`
Converts hex string to Babylon Color3:
```typescript
const cyan = color(PALETTE.CYAN) // Color3(0, 0.85, 1)
```

### `emissive(hex: string, intensity: number): Color3`
Gets emissive color with intensity applied:
```typescript
const glow = emissive(PALETTE.CYAN, INTENSITY.HIGH)
```

### `stateEmissive(state, intensity): Color3`
Gets state color with intensity:
```typescript
const feverGlow = stateEmissive('FEVER', INTENSITY.HIGH)
```

### `pulse(time, speed, min, max): number`
Animation helper for breathing effects:
```typescript
const breath = pulse(time, 0.7, 0.2, 0.8)
mat.emissiveColor = emissive(PALETTE.CYAN, breath)
```

## Material Categories

Visual categories ensure consistent treatment:

```typescript
CATEGORIES.STRUCTURAL   // Cabinet, walls
CATEGORIES.METALLIC     // Rails, trim
CATEGORIES.PLAYFIELD    // Table surface
CATEGORIES.INTERACTIVE  // Bumpers, flippers
CATEGORIES.ENERGY       // Holograms, beams
CATEGORIES.DISPLAY      // Backbox
CATEGORIES.GLASS        // Transparent
CATEGORIES.ALERT        // Warning states
```

Each category defines:
- Albedo color
- Roughness & metallic values
- Emissive color & intensity
- Clear coat settings

## Usage Examples

### Creating a Material
```typescript
import { getMaterialLibrary } from './material-library'
import { PALETTE, INTENSITY } from './visual-language'

const matLib = getMaterialLibrary(scene)
const bumperMat = matLib.getNeonBumperMaterial(PALETTE.MAGENTA)
```

### State-Based Lighting
```typescript
import { STATE_COLORS, emissive, INTENSITY } from './visual-language'

// In update loop
switch (gameState) {
  case 'FEVER':
    light.diffuse = emissive(STATE_COLORS.FEVER, INTENSITY.HIGH)
    break
  case 'REACH':
    light.diffuse = emissive(STATE_COLORS.REACH, INTENSITY.FLASH)
    break
}
```

### Animation
```typescript
import { pulse, emissive, PALETTE } from './visual-language'

// Breathing idle glow
const brightness = pulse(time, 0.7, 0.2, 0.5)
mat.emissiveColor = emissive(PALETTE.CYAN, brightness)
```

## Feeder Color System

Each feeder has a defined color identity:

```typescript
FEEDER_STYLES.MAG_SPIN     // Cyan/blue
FEEDER_STYLES.NANO_LOOM    // Green/teal
FEEDER_STYLES.PRISM_CORE   // Rainbow/multi
FEEDER_STYLES.GAUSS_CANNON // Orange/industrial
FEEDER_STYLES.QUANTUM_TUNNEL // Purple/cyan
```

## Adventure Mode Themes

Track-specific color pairs:

```typescript
ADVENTURE_THEMES.NEON_HELIX      // { cyan, magenta }
ADVENTURE_THEMES.CYBER_CORE      // { purple, cyan }
ADVENTURE_THEMES.FIREWALL_BREACH // { alert, gold }
// ... etc
```

## Migration Guide

### Before (inconsistent):
```typescript
// Different files using different colors
mat.emissiveColor = Color3.FromHexString("#00aaff") // effects.ts
mat.emissiveColor = Color3.FromHexString("#00d9ff") // display.ts
mat.emissiveColor = Color3.FromHexString("#00eeff") // game-objects.ts
```

### After (unified):
```typescript
// All files use same palette
mat.emissiveColor = emissive(PALETTE.CYAN, INTENSITY.NORMAL)
```

### Before (hardcoded intensities):
```typescript
mat.emissiveColor.scale(0.3)  // Random value
mat.emissiveColor.scale(1.5)  // Different random value
```

### After (standardized):
```typescript
emissive(PALETTE.CYAN, INTENSITY.AMBIENT)  // 0.2
emissive(PALETTE.CYAN, INTENSITY.HIGH)     // 1.5
```

## Future Art Asset Notes

**Can Stay Procedural:**
- Grid textures (unified purple/cyan)
- LED strips (using PALETTE colors)
- Hologram effects (wireframe + emissive)
- Particle bursts (using PALETTE)

**Needs Real Assets:**
- Playfield texture (detailed art)
- Cabinet side art (custom graphics)
- Bumper models (3D detail)
- Video loops (attract mode)
- Character/enemy models (adventure mode)

## Contributing

When adding new visual elements:

1. **Use the palette** - Don't introduce new hex colors
2. **Use intensity levels** - Don't hardcode scale values
3. **Use state colors** - Map game states to STATE_COLORS
4. **Use material categories** - Pick appropriate CATEGORIES values
5. **Add to feeders** - If creating new feeders, define in FEEDER_STYLES
6. **Document in themes** - If adding adventure tracks, add to ADVENTURE_THEMES
