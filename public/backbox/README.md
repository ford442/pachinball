# Backbox Attract Media

Place static images or looped videos here to display on the head-of-table backbox screen.

## Quick Start

### Option 1: Video (Recommended)
1. Add a video file (e.g., `attract.mp4`)
2. Update `src/config.ts`:
   ```typescript
   backbox: {
     attractVideoPath: '/backbox/attract.mp4',
     videoReplacesReels: true,
   }
   ```

### Option 2: Static Image
1. Add an image (e.g., `attract.png`)
2. Update `src/config.ts`:
   ```typescript
   backbox: {
     attractVideoPath: '',  // Disable video
     attractImagePath: '/backbox/attract.png',
     imageOpacity: 0.85,
     imageBlendMode: 'normal',
   }
   ```

## Video Guidelines

### Format
- **Recommended:** MP4 (H.264) for maximum browser compatibility
- **Alternative:** WebM (VP9) for smaller file sizes
- **Avoid:** AVI, MOV, MKV (may not play in browsers)

### Resolution
- **Recommended:** 1920x1080 (16:9) or 1280x720
- **Aspect Ratio:** 16:9 matches the backbox display
- **Note:** Video will be letterboxed if aspect ratio differs

### Encoding Settings
- **Video Codec:** H.264 (avc1.42E01E baseline profile)
- **Audio:** Optional, will be muted (autoplay requirement)
- **Bitrate:** 2-5 Mbps for smooth playback
- **Loop Point:** Ensure clean loop - last frame should match first

### File Size
- **Target:** Under 50MB for fast loading
- **Max:** 100MB (larger files may cause loading delays)

### Content Ideas
- Animated game logo with glitch effects
- Cyber/neon grid animations
- Abstract data visualizations
- Retro CRT-style animations

## Image Guidelines

### Format
- **Recommended:** PNG with transparency
- **Alternative:** JPG for photos (no transparency)

### Resolution
- **Recommended:** 1920x1080 or 1024x512
- **Aspect Ratio:** 16:9

### Style Tips
- Dark backgrounds work best with cyber grid visible underneath
- Use transparency to let animated grid show through
- Avoid busy patterns that compete with gameplay UI

## Layer Architecture

The backbox has 5 layers (back to front):

```
┌─────────────────────────────────────┐  LAYER 4: UI Overlay
│  Text, scanlines, jackpot effects   │     Canvas2D dynamic
├─────────────────────────────────────┤
│  Animated cyber grid                │  LAYER 3: Grid Shader
│  (shows through transparent areas)  │     GLSL shader
├─────────────────────────────────────┤
│  [YOUR IMAGE if video disabled]     │  LAYER 2: Static Image
│                                     │     (optional fallback)
├─────────────────────────────────────┤
│  [YOUR VIDEO if configured]         │  LAYER 1: Video
│  Looped, autoplay, muted            │     VideoTexture
├─────────────────────────────────────┤
│  Slot reels / symbols               │  LAYER 0: Reels
│  (hidden if videoReplacesReels)     │     Procedural
└─────────────────────────────────────┘
```

## Priority System

The system tries media in this order:

1. **Video** - If configured and loads successfully
2. **Static Image** - If video fails or not configured
3. **Reels/Slots** - Procedural fallback (always available)

## Browser Autoplay

Browsers require videos to be muted for autoplay:
- ✅ Videos are automatically muted
- ✅ Plays inline (no fullscreen)
- ✅ Loops automatically
- ⚠️ Some browsers block autoplay until user interaction
  - System gracefully falls back to image or reels

## Blend Modes (Images Only)

| Mode | Effect | Best For |
|------|--------|----------|
| `normal` | Standard alpha blend | Most images |
| `additive` | Adds to background | Glow effects, neon art |
| `multiply` | Darkens background | Light/white images |

## Runtime Control

```typescript
// Video controls
displaySystem.playVideo()
displaySystem.pauseVideo()
displaySystem.setVideoOpacity(0.5)
displaySystem.setVideoVisible(false)

// Image controls
displaySystem.setImageVisible(false)
displaySystem.setImageOpacity(0.5)
```

## Troubleshooting

### Video Not Playing
Check browser console for:
- `Video autoplay blocked` - Browser policy, fallback will show
- `Video failed to load` - Check file path and format

### Video Looks Stretched
- Ensure video is 16:9 aspect ratio
- System maintains aspect ratio but letterboxing may occur

### Performance Issues
- Reduce video resolution (try 720p)
- Lower video bitrate
- Use image instead for low-end devices

### Fallback Not Working
- Ensure `attractImagePath` is set if video fails
- Check image exists at specified path
- Verify image format is supported

## Examples

### Cyberpunk Video Loop
```typescript
backbox: {
  attractVideoPath: '/backbox/cyber-loop.mp4',
  videoReplacesReels: true,
}
```

### Static Logo with Transparent Grid
```typescript
backbox: {
  attractVideoPath: '',
  attractImagePath: '/backbox/logo.png',
  imageOpacity: 0.9,
  imageBlendMode: 'normal',
}
```

### Reels Only (No Media)
```typescript
backbox: {
  attractVideoPath: '',
  attractImagePath: '',
}
```
