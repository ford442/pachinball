# Backbox Video Implementation Guide

## Overview

The backbox display now supports looped video playback using BabylonJS VideoTexture, with automatic fallback to static images or procedural reels.

## Architecture

### Media Priority Stack
```
1. VIDEO (if configured + loads + autoplays)
   └─ Falls back to image if blocked/fails
   
2. STATIC IMAGE (if configured + loads)
   └─ Falls back to reels if fails
   
3. REELS/SLOTS (procedural fallback)
   └─ Always available
```

### Layer Stack (back to front)
```
LAYER 0: Reels/Slots (deepest)
LAYER 1: Video (if playing)
LAYER 2: Image (if video disabled/failed)
LAYER 3: Animated Grid Shader
LAYER 4: UI Overlay + Scanlines (closest)
```

## Implementation Details

### Video Element Configuration
The HTML5 video element is configured with these attributes for maximum autoplay compatibility:
```javascript
video.loop = true        // Loop continuously
video.muted = true       // Required for autoplay
video.playsInline = true // Required for mobile
video.crossOrigin = 'anonymous'  // For texture access
video.preload = 'auto'   // Start loading immediately
```

### Autoplay Handling
Browsers have strict autoplay policies. The implementation handles this gracefully:

1. **Success Path**: Video loads → autoplay succeeds → hides reels (if configured)
2. **Blocked Path**: Video loads → autoplay rejected → disposes video → falls back to image/reels
3. **Error Path**: Video fails to load → disposes video → falls back to image/reels

### Aspect Ratio Handling
- VideoTexture automatically maintains the video's aspect ratio
- Display plane is 20x12 units (16:9)
- Letterboxing occurs automatically if video aspect differs
- Use 16:9 source video for best results

## Configuration

### config.ts
```typescript
backbox: {
  // Video path (relative to public/)
  attractVideoPath: '/backbox/attract.mp4',
  
  // If true, hides reels when video plays
  // If false, video overlays reels
  videoReplacesReels: true,
  
  // Fallback image (used if video fails)
  attractImagePath: '/backbox/attract.png',
  imageOpacity: 0.85,
  imageBlendMode: 'normal',
}
```

## File Placement

```
public/
└── backbox/
    ├── attract.mp4     # Video (checked first)
    ├── attract.png     # Image (fallback)
    └── README.md       # Documentation
```

## Runtime API

```typescript
// Playback control
displaySystem.playVideo()      // Resume playback
displaySystem.pauseVideo()     // Pause playback

// Visual control
displaySystem.setVideoOpacity(0.5)     // 0.0 - 1.0
displaySystem.setVideoVisible(false)   // Show/hide

// Image controls (fallback)
displaySystem.setImageVisible(true)
displaySystem.setImageOpacity(0.85)
```

## Browser Compatibility

### Supported Formats
- **MP4 (H.264)**: Universal support - RECOMMENDED
- **WebM (VP9)**: Good support, smaller files
- **AV1**: Emerging, not recommended yet

### Autoplay Policies
| Browser | Muted Autoplay | Notes |
|---------|---------------|-------|
| Chrome | ✅ Allowed | May block based on engagement |
| Firefox | ✅ Allowed | Generally permissive |
| Safari | ✅ Allowed | iOS requires playsinline |
| Edge | ✅ Allowed | Same as Chrome |

### Fallback Behavior
If autoplay is blocked, the system:
1. Logs warning to console
2. Disposes video resources
3. Attempts to load static image (if configured)
4. Falls back to reels if image also fails

## Performance Considerations

### Memory
- Video texture: ~8MB for 1080p
- Video element: Browser managed
- Total: Typically under 50MB

### CPU/GPU
- Video decoding: Hardware accelerated (GPU)
- Texture upload: Automatic, optimized
- Impact: Minimal on modern devices

### Recommendations
- Use 720p for lower-end devices
- Keep file size under 50MB
- Encode with H.264 baseline profile
- Avoid 4K (overkill for backbox display)

## Troubleshooting

### Video Not Playing
Check console for:
- `Video autoplay blocked` - Browser policy, using fallback
- `Video failed to load` - Check file path/format
- `Video load timeout` - File too large or network issue

### Video Looks Wrong
| Issue | Solution |
|-------|----------|
| Stretched | Ensure video is 16:9 aspect ratio |
| Pixelated | Increase resolution (1080p recommended) |
| Choppy | Reduce bitrate or resolution |
| No color | Check video encoding (H.264 baseline) |

### Fallback Issues
If video fails but fallback doesn't appear:
1. Check `attractImagePath` is set in config
2. Verify image file exists at path
3. Check browser Network tab for 404 errors

## Scanline/CRT Effects

The existing scanline post-process continues to work over video:
- Applied as post-process on head camera
- Affects all layers including video
- Maintains retro CRT aesthetic

To disable scanlines on video (not recommended):
- Would require separate render pipeline
- Current implementation keeps consistent look

## Examples

### Basic Video Setup
```typescript
// config.ts
backbox: {
  attractVideoPath: '/backbox/loop.mp4',
  videoReplacesReels: true,
  attractImagePath: '/backbox/fallback.png',
}
```

### Video with Reels Visible Behind
```typescript
// config.ts
backbox: {
  attractVideoPath: '/backbox/overlay.mp4',
  videoReplacesReels: false,  // Reels show through
  attractImagePath: '',
}
```

### Image-Only (No Video)
```typescript
// config.ts
backbox: {
  attractVideoPath: '',
  attractImagePath: '/backbox/attract.png',
  imageOpacity: 0.9,
}
```

### Procedural Only (No Media)
```typescript
// config.ts
backbox: {
  attractVideoPath: '',
  attractImagePath: '',
}
```
