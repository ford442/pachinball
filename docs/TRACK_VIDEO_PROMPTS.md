# Track Video Prompts

Collection of **Grok Imagine** (and compatible) video-generation prompts for backbox media and short cinematics that match Pachinball adventure track themes.

These are written to produce seamless or near-seamless 16:9 loops suitable for the head-of-table backbox LCD (see `docs/BACKBOX_VIDEO_GUIDE.md` and `public/backbox/`) or for promotional/campaign clips. Prefer muted output; the game mutes video for autoplay.

## Guidelines

| Requirement | Target |
|-------------|--------|
| Aspect ratio | 16:9 |
| Resolution | 720p–1080p |
| Duration | 4–8 s seamless loop preferred |
| Style | Cyber-pachinko / holographic neon, matching track palette |
| Audio | None (or strip on encode) |
| File | H.264 MP4, ≤50 MB, place under `public/backbox/` or track-specific subfolder |

**Palette source of truth:** `src/adventure/track-theme-profiles.ts` and `TRACK_THEME_OVERRIDES` in `src/adventure/track-theming-system.ts`.

**Usage tip:** Append camera motion and loop notes as needed, e.g.  
`seamless looping video, slow orbital camera, no text, no logos, 16:9`.

---

## Campaign Spine Tracks

### NEON_HELIX — Neon Helix (cyan / magenta spiral)

**Atmosphere:** Vertical energy spiral, low fog, cyan key light, magenta rim, neon-flicker particles.

1. **Helix Ascent Loop**  
   Seamless looping cinematic of a glowing cyan-and-magenta energy spiral ramp floating in a dark digital void. Translucent holographic ramp segments wind upward, thin neon rails, occasional gold energy sparks. Soft volumetric fog, bloom, slow orbital camera circling the helix. Cyber-pachinko aesthetic, 16:9.

2. **Data Core Approach**  
   Close tracking shot of a chrome ball rolling up a translucent cyan helix ramp, magenta rim lights pulsing. Particle trails, low-gravity feel, holographic grid floor far below. Seamless loop, no text.

### PACHINKO_HALL — Pachinko Hall (gold / magenta parlor hub)

**Atmosphere:** Warm gold key light, magenta accents, neon-flicker, parlor corridor feel.

1. **Parlor Corridor**  
   Seamless looping wide shot of a neon pachinko parlor hallway. Rows of glowing gold and magenta machines, pin forests, conveyor chutes, holographic signage. Warm volumetric light, subtle camera dolly forward. Cyber-Japanese aesthetic, 16:9.

2. **Gold Cascade**  
   Macro of gold-plated pachinko balls cascading through a dense pin field under magenta rim lighting. Reflective surfaces, bloom, slow motion, seamless loop.

### CYBER_CORE — Cyber Shock (magenta / cyan electric)

**Atmosphere:** Hot magenta primary, electric cyan arcs, tiger-orange energy, high bloom, electric-arc particles.

1. **Electric Core Breach**  
   Seamless looping cinematic of a dark server shaft with violent magenta and cyan electrical arcs. Orange energy bursts, glitch distortion, high bloom, rim-lit chrome surfaces. Camera slowly descending. Cyber-shock aesthetic, 16:9.

2. **Arc Storm**  
   Close-up of chrome ball bouncing through dense electric-arc fields, magenta/cyan lightning, particle sparks. High contrast, bloom, seamless loop.

### QUANTUM_GRID — Mega Grid (purple / white pixel)

**Atmosphere:** Deep purple structure, white accents, pixel-scan ambient, glass surfaces.

1. **Logic Grid**  
   Seamless looping top-down / slight angle of a flat neon-purple grid plane with sharp white pathways and pixel-scan light sweeps. Narrow platforms, no walls, digital void below. Clean geometric aesthetic, 16:9.

2. **Processor Orbit**  
   Chrome ball tracing a tight curved path on a glowing purple grid, white rim lights, subtle scanline overlay. Seamless loop.

### STORM_LATTICE — Storm Lattice (cyan storm)

**Atmosphere:** Stormy cyan, electric-arc particles, high rim intensity, deep blue fog.

1. **Lattice Storm**  
   Seamless looping shot of a steep pin-lattice board under cyan lightning and crosswinds. Floating force-field volumes, rain-like particle streaks, high-contrast rim lighting. Dramatic atmosphere, 16:9.

2. **Updraft Shaft**  
   Chrome ball rising through a glowing cyan updraft column amid pin lattice, electric arcs, volumetric fog. Seamless loop.

### GLITCH_SPIRE — Ghost Spire (matrix green / cyan mist)

**Atmosphere:** Ghost-mist ambient, matrix green structure, cyan accents, high vignette, low key light.

1. **Corrupted Spire**  
   Seamless looping cinematic of a fractured data spire with missing walls and floating glitch platforms. Matrix-green and pale cyan mist, occasional magenta corruption flashes. Slow upward camera. Ethereal, unstable geometry, 16:9.

2. **Packet Loss Drop**  
   Chrome ball jumping a wide gap between glitching platforms, mist trails, scanline artifacts. Seamless loop.

### Additional Spine Tracks (shorter starters)

**SINGULARITY_WELL** (alert red / deep ambient)  
Seamless looping orbital shot of concentric funnel rings collapsing toward a dark central singularity. High gravity feel, sparse red rim lights, deep fog, chrome ball spiraling inward.

**RETRO_WAVE_HILLS** (magenta / cyan vaporwave)  
Seamless looping tracking shot along rolling vaporwave hills and banked neon highways at dusk. Magenta sun, cyan grid horizon, chrome ball flowing over sinusoidal terrain.

**HYPER_DRIFT** (cyan / white speed)  
Seamless high-speed tracking of a chrome ball drifting through long banked curves with heavy motion blur and cyan light streaks. Clean, fast, 16:9.

**CHRONO_CORE** (gold / alert)  
Seamless looping of interlocking golden gears and clockwork ramps under warm key light with red alert accents. Mechanical precision, subtle time-distortion shimmer.

**CRYO_CHAMBER** (white / cyan ice)  
Seamless looping crystalline ice chamber with frosted glass ramps, soft cyan rim lights, floating ice particles, cold volumetric fog.

**FIREWALL_BREACH** (alert red / gold)  
Seamless looping of a digital firewall being breached: red energy barriers cracking, gold particles erupting, intense bloom and glitch.

---

## Parallel / Optional Tracks

**PACHINKO_SPIRE** (gold / alert)  
Vertical gold pin tower under alert-red lighting, dense cascading balls, warm bloom.

**TIDAL_NEXUS** (cyan / matrix underwater)  
Underwater caustic lighting, cyan-green currents, translucent ramps, floating bubbles and data particles.

**SOLAR_FLARE** (gold / alert)  
Intense solar plasma, gold and red energy ribbons, high bloom, chrome ball riding a solar wind ramp.

**DIGITAL_ZEN_GARDEN** (matrix / purple)  
Minimal holographic garden of floating stones and soft purple light, slow camera, peaceful particle mist.

---

## Shared / State Clips (backbox attract, fever, jackpot, reach)

These can be used independently of any single track.

| State | Prompt idea |
|-------|-------------|
| **Attract** | Seamless looping wide shot of a dark cyber pachinko cabinet with cyan/magenta neon trim breathing slowly, holographic backbox glow, floating chrome ball, low fog, 16:9. |
| **Reach** | Fast red-alert grid, spinning holographic reels, tension, magenta/cyan pulses, seamless loop. |
| **Fever** | Intense gold and magenta particle storm, rapid light pulses, high bloom, chrome balls multiplying, seamless loop. |
| **Jackpot** | Explosive gold particle burst, "CORE BREACH" style energy overload (no readable text), radial shockwaves, high contrast bloom, seamless loop. |

---

## Workflow Notes

1. Generate with the prompts above (or variants).
2. Encode to H.264 16:9 MP4 ≤50 MB, strip audio if present.
3. Drop into `public/backbox/` (or `public/backbox/<track-id>/`).
4. Wire via `GameConfig.backbox` getters or `StateMediaConfig` (see `docs/BACKBOX_VIDEO_GUIDE.md`).
5. Prefer seamless loops; use ffmpeg cross-fade or generative loop tools if needed.

Contributions welcome — add new prompt variants or track sections as themes evolve.
