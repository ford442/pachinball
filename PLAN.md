# PACHINBALL DEVELOPMENT PLAN: "CYBER-SHOCK" UPDATE

## 1. Multi-Layered Display System (The "Pachinko Screen")
Pachinko machines often create depth by layering a transparent LCD over physical props or another screen. We will simulate this in Babylon.js using multiple render planes.

* **Layer 1 (Background / Physical):** The deepest layer. This renders the "physical" mechanical elements inside the backbox (e.g., rotating physical drums, moving plastic figures, or a static high-quality background art).
* **Layer 2 (Main Display):** A standard screen playing the primary video loops (waterfalls, tigers, character animations).
* **Layer 3 (Transparent LCD Overlay):** The front-most screen. This plane will use an alpha-channel video or dynamic canvas texture to render UI elements, "Reach" text, and flashy effects *over* the main video, simulating the "glass" screen effect found in modern machines.

## 2. Context-Aware Display States
The screens must react to the gameplay, not just play a loop. We will implement a `DisplayState` machine separate from the `GameState`.

* **Idle / Normal Mode:** Peaceful background video (e.g., clouds, distant city) with occasional random character walk-bys on the Transparent Layer.
* **Reach / Anticipation:** Triggered when the ball enters specific "start" pockets (the center catcher). The screens darken, lighting turns red, and a specific "battle" or "slot spin" animation plays.
* **Fever / Jackpot:** Synchronized explosion of light and sound. The Transparent Layer plays high-energy overlay effects (coins, sparks) while the Main Display shows the "Victory" video.

## 3. Hardware Case Lighting (Synchronized Illumination)
The cabinet itself needs to feel alive. We will add emissive strips to the outer cabinet mesh that sync with the screen events.

* **Cabinet LED Strips:** Add neon-like strips running along the side and top edges of the cabinet model.
* **Reactive Materials:** Create a `CabinetLightManager` script.
    * *Normal Play:* Slow, breathing color shift (Blue/Teal).
    * *Bumper Hit:* Flash bright white/silver instantly, then fade.
    * *Fever Mode:* Rapid strobing rainbow or pulsing red/gold.
* **Light Casting:** Ensure these strips actually cast light onto the playfield (using PointLights or SpotLights bound to the strip's location) so the ball changes color as it rolls near the edges.

## 4. Refined Playfield (The "Concept" Look)
* **Holographic Pillars:** Keep and refine the wireframe holograms over the bumpers.
* **Physical/Digital Blend:** Ensure the "Nails" (Pachinko pins) look metallic and physical to contrast with the digital screen elements.

## 5. The "Mag-Spin" Feeder System (Pachinko Mechanics)
To enhance the "Pachinko" feel of the game, we will introduce a magnetic feeder mechanism that catches the ball, energizes it, and releases it back into play. This breaks up the flow and adds anticipation.

### A. Mechanic: The "Mag-Spin" Well
Located on the upper-right playfield wall (replacing a standard rebound bumper). When the ball enters its proximity, it is magnetically captured, spun up to high speed, and then shot out towards the center bumpers.

### B. Logic State Machine
1.  **IDLE:** The well is inactive, pulsing slowly with a blue light.
2.  **CATCH:**
    *   Trigger: Ball enters `catchRadius`.
    *   Action: Physics body switches to `KinematicPositionBased`. Ball lerps to the center of the well.
    *   Visual: Light turns purple/magenta.
3.  **SPIN (Charging):**
    *   Action: Ball rotates rapidly on its axis. Sound pitch rises.
    *   Duration: `spinDuration` (e.g., 1.5 seconds).
4.  **RELEASE:**
    *   Action: Physics body restores to `Dynamic`.
    *   Force: Apply impulse `releaseForce` in direction `targetDirection` +/- `releaseAngleVariance`.
    *   Visual: Bright flash, shockwave particle effect.
5.  **COOLDOWN:**
    *   Action: Ignore collisions for `cooldown` seconds to prevent immediate re-catch.

### C. Technical Specification
*   **Location:** `feederPosition` (Vector3) - Suggested: Upper Right Wall.
*   **Capture Zone:** `catchRadius` = 1.5 units.
*   **Timing:** `spinDuration` = 1.2s, `cooldown` = 3.0s.
*   **Physics:**
    *   `releaseForce` = 25.0 (Impulse magnitude).
    *   `releaseAngleVariance` = 0.25 radians (approx 15 degrees).
*   **Visuals:** Needs a ring of emissive meshes that rotate during the SPIN phase.

## 6. Adventure Track: "The Neon Helix"
A procedural "Holo-Deck" level designed to test ball control and momentum.

### A. Concept
A vertical spiral tower floating in a digital void. The ball must ascend a translucent energy ramp, jump a central gap, and land in the "Data Core" bucket.

### B. Layout Definition (Procedural Steps)
1.  **The Entry Ramp:**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 20 units
    *   Incline: 15 degrees
    *   Width: 4 units (Narrow)
2.  **The Spiral Ascent (Segment 1):**
    *   Type: `CURVED_RAMP`
    *   Radius: 10 units
    *   Angle: 90 degrees
    *   Incline: 10 degrees
    *   WallHeight: 2.0 (Safe)
3.  **The Spiral Ascent (Segment 2 - The Hazard):**
    *   Type: `CURVED_RAMP`
    *   Radius: 10 units
    *   Angle: 90 degrees
    *   Incline: 15 degrees
    *   WallHeight: 0.5 (Dangerous - Easy to fall off)
4.  **The Void Jump:**
    *   Type: `GAP`
    *   Length: 5 units
    *   TargetElevation: +2 units relative to launch
5.  **The Data Core (Goal):**
    *   Type: `BUCKET`
    *   Diameter: 6 units
    *   Trigger: `MISSION_COMPLETE`

### C. Technical Variables (for `AdventureMode.ts`)
*   `helixRadius` = 10.0
*   `rampWidth` = 4.0
*   `segmentResolution` = 10 (steps per 90 degrees)
*   `voidGapSize` = 5.0
*   `gravityMultiplier` = 0.8 (Low gravity feeling)

## 7. Adventure Track: "The Cyber-Core Descent"
A high-velocity plunge through a corrupted data stream. Unlike the "Neon Helix" ascent, this track focuses on speed, momentum, and precision braking.

### A. Concept
The ball is "injected" into a server shaft and must spiral down to the root directory. The visual theme uses dark red and glitchy "corruption" effects.

### B. Layout Definition
1.  **The Injection Drop:**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 15 units
    *   Incline: -20 degrees (Down)
    *   Width: 6 units
2.  **Velocity Curve (The Bank):**
    *   Type: `CURVED_RAMP`
    *   Radius: 15 units
    *   Angle: 180 degrees
    *   Incline: -5 degrees
    *   WallHeight: 3.0 (High outer wall to catch speed)
3.  **The Firewall Gap:**
    *   Type: `GAP`
    *   Length: 8 units
    *   TargetElevation: -2 units relative to launch (Slight drop)
4.  **The Corkscrew:**
    *   Type: `CURVED_RAMP`
    *   Radius: 8 units
    *   Angle: 270 degrees
    *   Incline: -15 degrees
    *   WallHeight: 1.0 (Narrow margin for error)
5.  **Root Access (Goal):**
    *   Type: `BUCKET`
    *   Trigger: `MISSION_COMPLETE`

### C. Technical Variables
*   `descentGravity` = 1.2 (Heavier gravity for speed)
*   `wallFriction` = 0.1 (Slippery walls)
*   `gapAssist` = 1.1 (Slight velocity boost on jumps)
