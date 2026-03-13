# Backbox Display Media System

The head-of-table backbox display is a **layered media presentation system** that supports video, images, procedural reels, and shader backgrounds. It reacts to game states (idle, fever, jackpot, adventure) to show different content.

## Quick Start

### 1. Add Media Files

Place your media files in this directory:

```
public/backbox/
├── attract-loop.mp4      # Main attract mode video
├── attract-fallback.png  # Fallback image if video fails
├── jackpot-explosion.mp4 # Jackpot state video
└── adventure-overlay.png # Adventure mode overlay
```

### 2. Configure Display Mode

Edit `src/config.ts`:

```typescript
import { DisplayMode, type DisplayConfig } from './game-elements/display-config'

export const GameConfig = {
  // ... other config ...
  
  display: {
    mode: DisplayMode.HYBRID,  // See mode options below
    
    defaultMedia: {
      videoPath: '/backbox/attract-loop.mp4',
      imagePath: '/backbox/attract-fallback.png',
      showShaderBackground: true,
      showReels: false,
      opacity: 0.9,
    },
    
    // Optional: per-state media overrides
    stateMedia: {
      [DisplayState.JACKPOT]: {
        videoPath: '/backbox/jackpot-explosion.mp4',
        showShaderBackground: false,
        shaderParams: { speed: 20, color: '#ff00ff' },
      },
      [DisplayState.ADVENTURE]: {
        imagePath: '/backbox/adventure-overlay.png',
        showReels: false,
        shaderParams: { speed: 1, color: '#00aa00' },
      },
    },
  } as DisplayConfig,
}
```

### 3. Display Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `DisplayMode.SHADER_ONLY` | Procedural reels + animated grid | No external media, maximum compatibility |
| `DisplayMode.IMAGE` | Static image over shader | Logo, attract art, screenshot |
| `DisplayMode.VIDEO` | Looping video | Animated attract loop, trailers |
| `DisplayMode.HYBRID` | All layers active | Maximum flexibility, state transitions |

## Layer Architecture (Back to Front)

```
┌─────────────────────────────────────┐  Layer 5: UI Overlay
│  Text, scanlines, status messages   │     Canvas2D → always visible
├─────────────────────────────────────┤
│  [STATE VIDEO] if configured        │  Layer 4: Video (optional)
│  Looped, autoplay, muted            │     VideoTexture
├─────────────────────────────────────┤
│  [STATE IMAGE] if video missing     │  Layer 3: Image (optional)
│  Static fallback or overlay         │     Texture
├─────────────────────────────────────┤
│  Animated cyber grid                │  Layer 2: Shader Background
│  Color/speed change per state       │     GLSL shader
├─────────────────────────────────────┤
│  Slot reels / symbols               │  Layer 1: Procedural Reels
│  Spin during fever/reach states     │     WGSL or Canvas2D
├─────────────────────────────────────┤
│  Screen glass reflection            │  Layer 0: Physical Bezel
└─────────────────────────────────────┘
```

## State-Based Media

The display reacts to game states. Each state can have custom media:

| State | Trigger | Default Behavior |
|-------|---------|------------------|
| `IDLE` | No game active | Shows attract media |
| `REACH` | Target activated | Fast red grid, spinning reels |
| `FEVER` | Bonus mode | Gold grid, reels spinning fast |
| `JACKPOT` | Big win | Magenta grid, jackpot overlay |
| `ADVENTURE` | Holo-deck mode | Green grid, mission UI |

### Adding Per-State Media

```typescript
stateMedia: {
  [DisplayState.FEVER]: {
    // Override video for fever mode
    videoPath: '/backbox/fever-loop.mp4',
    
    // Hide reels, show only video + shader
    showReels: false,
    showShaderBackground: true,
    
    // Custom shader color (gold)
    shaderParams: { 
      speed: 10, 
      color: '#ffd700' 
    },
  },
}
```

## Media File Guidelines

### Video

**Recommended Format:**
- MP4 (H.264) for maximum compatibility
- WebM (VP9) for smaller files
- Resolution: 1920x1080 or 1280x720
- Aspect ratio: 16:9

**Encoding Settings:**
- Video codec: H.264 baseline profile
- Audio: Optional (will be muted)
- Bitrate: 2-5 Mbps
- Loop: Ensure clean loop point

**File Size:**
- Target: Under 50MB
- Max: 100MB

### Images

**Formats:**
- PNG with transparency (recommended)
- JPG for photos

**Resolution:**
- 1920x1080 or 1024x512
- 16:9 aspect ratio

**Style Tips:**
- Dark backgrounds work best
- Use transparency for overlays
- Avoid busy patterns

## Configuration Reference

### DisplayConfig Interface

```typescript
interface DisplayConfig {
  // Base display mode
  mode: DisplayMode
  
  // Default media (IDLE state)
  defaultMedia?: StateMediaConfig
  
  // Per-state overrides
  stateMedia?: Partial<Record<DisplayState, StateMediaConfig>>
  
  // Image settings
  imageSettings?: {
    blendMode?: 'normal' | 'additive' | 'multiply'
    defaultOpacity?: number
  }
  
  // Video settings
  videoSettings?: {
    loop?: boolean
    muted?: boolean
    loadTimeout?: number  // ms
  }
  
  // Transition settings
  transitions?: {
    fadeDuration?: number  // seconds
    animateShaderParams?: boolean
  }
}
```

### StateMediaConfig Interface

```typescript
interface StateMediaConfig {
  videoPath?: string           // Path to video file
  imagePath?: string           // Path to image file
  showShaderBackground?: boolean
  showReels?: boolean
  opacity?: number             // 0.0 - 1.0
  shaderParams?: {
    speed?: number             // Grid animation speed
    color?: string             // Hex color code
  }
}
```

## Fallback Chain

If media fails to load, the system gracefully falls back:

```
Video configured? 
  → Yes: Try video → Fail? → Try image → Fail? → Show reels
  → No: Try image → Fail? → Show reels
```

Always shows at minimum: **reels + shader grid + UI overlay**

## Extending the System

### Adding a New Display State

1. Add state to `DisplayState` enum in `src/game-elements/display-config.ts`
2. Add default shader params to `DEFAULT_DISPLAY_CONFIG`
3. Update `updateSlotModeForState()` in `DisplaySystem` if reels should behave differently
4. Add overlay rendering in `updateOverlay()`

### Adding Media Transition Effects

The `transitions` config supports fade duration. For custom transitions:

```typescript
// In DisplaySystem.update()
if (this.currentState.isTransitioning) {
  // Custom transition logic
  const progress = this.currentState.transitionProgress
  
  // Example: slide video in
  if (this.layers.video) {
    const startX = -20
    const endX = 0
    this.layers.video.position.x = lerp(startX, endX, progress)
  }
}
```

### Adding Playlist Support (Future)

For attract mode playlists, extend `StateMediaConfig`:

```typescript
interface StateMediaConfig {
  // ... existing ...
  playlist?: string[]     // Array of video/image paths
  playlistInterval?: number  // Seconds between items
}
```

Then update `DisplaySystem` to cycle through items on a timer.

## Troubleshooting

### Video Not Playing
- Check browser console for errors
- Ensure video is muted (autoplay requirement)
- Verify file path is correct (relative to `public/`)
- Try a smaller/lower bitrate video

### Media Looks Stretched
- Ensure 16:9 aspect ratio
- Check resolution matches other layers

### Performance Issues
- Reduce video resolution
- Lower shader complexity
- Disable unnecessary layers

### State Not Changing
- Verify `setDisplayState()` is being called
- Check state name matches enum value
- Look for console warnings

## Examples

### Cyberpunk Attract Loop
```typescript
display: {
  mode: DisplayMode.VIDEO,
  defaultMedia: {
    videoPath: '/backbox/cyber-attract.mp4',
    showShaderBackground: false,
    showReels: false,
  },
}
```

### Logo with Transparent Grid
```typescript
display: {
  mode: DisplayMode.IMAGE,
  defaultMedia: {
    imagePath: '/backbox/logo.png',
    showShaderBackground: true,
    opacity: 0.9,
  },
  imageSettings: {
    blendMode: 'normal',
  },
}
```

### State-Responsive System
```typescript
display: {
  mode: DisplayMode.HYBRID,
  defaultMedia: {
    showShaderBackground: true,
    showReels: true,
  },
  stateMedia: {
    [DisplayState.IDLE]: {
      videoPath: '/backbox/attract-loop.mp4',
      showReels: false,
    },
    [DisplayState.FEVER]: {
      videoPath: '/backbox/fever-intense.mp4',
      shaderParams: { speed: 15, color: '#ffaa00' },
    },
    [DisplayState.JACKPOT]: {
      showReels: false,
      shaderParams: { speed: 25, color: '#ff00ff' },
    },
  },
}
```
