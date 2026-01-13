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

## 8. Visual Storytelling: The Jackpot Sequence
To elevate the "Fever" state from a simple light show to a narrative event, we will implement a scripted "Cyber-Shock" sequence.

### A. The Concept
The player has breached the system's "Core". The machine shouldn't just award points; it should look like it's overloading and breaking containment.

### B. The Sequence Script
1.  **Phase 1: The Breach (0.0s - 2.0s)**
    *   **Trigger:** `JACKPOT_TRIGGER` event (e.g., hitting Center Target during Multiball).
    *   **Audio:** Alarm siren followed by a deep sub-bass drop.
    *   **Backbox (Main):** Video cuts to static interference, then flashes a "WARNING: CORE UNSTABLE" red alert message.
    *   **Backbox (Overlay):** A "Cracked Glass" shader effect spreads from the center.
    *   **Cabinet Lights:** Rapid Red pulsing (4Hz).
2.  **Phase 2: The Critical Error (2.0s - 5.0s)**
    *   **Audio:** Rising "turbine spin-up" sound (pitch scaling).
    *   **Backbox (Main):** A digital countdown "3... 2... 1..." overlaid with heavy glitch artifacts.
    *   **Backbox (Overlay):** Hexagonal "shield" tiles peel away from the center, revealing blinding white light.
    *   **Cabinet Lights:** Strobing White/Gold (10Hz).
3.  **Phase 3: The Meltdown (Jackpot Award) (5.0s - 10.0s)**
    *   **Audio:** Explosion sound + Heavy Techno music drop.
    *   **Backbox (Main):** "JACKPOT" text in 3D chrome font, spinning and exploding with gold particles.
    *   **Backbox (Overlay):** Radial shockwaves (Gold/Cyan) ripple outwards from the center.
    *   **Cabinet Lights:** "Rainbow Wave" pattern running top-to-bottom.
    *   **Gameplay:** All bumpers light up; Flashers fire continuously.

### C. Technical Specifications (Shader & Logic)
*   **Shader Name:** `JackpotOverlayShader` (applies to Layer 3 Transparent Mesh).
*   **Uniforms Needed:**
    *   `uTime` (float): Global animation time.
    *   `uPhase` (int): 0 (Idle), 1 (Breach), 2 (Error), 3 (Meltdown).
    *   `uGlitchIntensity` (float): 0.0 to 1.0 (Controls vertex displacement magnitude).
    *   `uCrackProgress` (float): 0.0 to 1.0 (Controls visibility of fracture lines).
    *   `uShockwaveRadius` (float): Distance of the ripple from center.
*   **Helper Variables (in `EffectsSystem`):**
    *   `jackpotTimer`: Tracks the 10s sequence.
    *   `isJackpotActive`: Boolean flag to override standard display logic.

## 9. Adventure Track: "The Quantum Grid"
A precision platforming level inspired by retro grid-runners. Unlike the continuous ramps of the Helix or Descent, this track features flat, narrow pathways and sharp 90-degree turns that require careful momentum management.

### A. Concept
The ball enters a flat, neon-grid plane. The challenge is navigation, not speed. The walls are non-existent or very low, making "ring-outs" the primary threat.

### B. Layout Definition
1.  **The Initialization Vector:**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 10 units
    *   Incline: 0 degrees (Flat)
    *   Width: 4 units
    *   WallHeight: 0.0 (No walls!)
2.  **The Logic Gate (Zig-Zag):**
    *   Type: `STRAIGHT_RAMP` x 3
    *   Pattern: Forward 5, Left 90, Forward 5, Right 90, Forward 5.
    *   Width: 3 units (Very Narrow)
3.  **The Processor Core (Orbit):**
    *   Type: `CURVED_RAMP`
    *   Radius: 6 units
    *   Angle: 270 degrees
    *   Incline: 5 degrees (Slight Upward Spiral)
    *   WallHeight: 0.5 (Low Curb)
4.  **The Upload Gap:**
    *   Type: `GAP`
    *   Length: 4 units
    *   TargetElevation: -1 units
5.  **Target (Goal):**
    *   Type: `BUCKET`

### C. Technical Variables
*   `gridWidth` = 3.0 (Hard mode width)
*   `turnSharpness` = 1.0 (Multiplier for corner friction)
*   `gridMaterialColor` = "#00FF00" (Matrix Green)

## 10. Adventure Track: "The Singularity Well"
A physics-heavy track simulating a black hole's gravity well. The ball orbits a central point, spiraling inward as it gains speed, requiring perfect timing to exit.

### A. Concept
A large, multi-tiered funnel. The ball starts at the rim and must traverse three concentric rings of decreasing radius. The challenge is managing the increasing velocity to avoid flying off the track while ensuring enough momentum to clear the gaps between rings.

### B. Layout Definition
1.  **Event Injection:**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 12 units
    *   Incline: -15 degrees (Steep Entry)
    *   Width: 6 units
2.  **The Outer Rim (Horizon):**
    *   Type: `CURVED_RAMP`
    *   Radius: 14 units
    *   Angle: 180 degrees
    *   Incline: -5 degrees
    *   WallHeight: 4.0 (High safety wall)
3.  **Transfer Orbit (Gap):**
    *   Type: `GAP`
    *   Length: 4 units
    *   TargetElevation: -2 units (Drop to inner ring)
4.  **The Accretion Disk:**
    *   Type: `CURVED_RAMP`
    *   Radius: 8 units
    *   Angle: 270 degrees
    *   Incline: -10 degrees
    *   WallHeight: 1.0 (Dangerous low wall)
5.  **The Singularity (Goal):**
    *   Type: `BUCKET` (Placed at center bottom)

### C. Technical Variables
*   `wellGravity` = 1.5 (High gravity to pull ball down)
*   `orbitalFriction` = 0.05 (Very low friction for speed)
*   **Feature Request:** `bankingAngle` support for curved ramps to tilt the floor inward (Roll).

## 11. Adventure Track: "The Glitch Spire"
An erratic, vertically complex track that simulates a corrupted data upload. It features sharp angular turns, sudden drops, and a "vertical crossover" where the path intersects itself at different elevations.

### A. Concept
A fractured data spire. The geometry is unstable, with missing walls and "glitch" artifacts (floating platforms). The player must navigate a path that zig-zags aggressively upwards before plunging into the core.

### B. Layout Definition
1.  **The Uplink (Ascent):**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 15 units
    *   Incline: 20 degrees (Steep Climb)
    *   Width: 4 units
    *   WallHeight: 1.0 (Low safety)
2.  **The Packet Loss (Gap):**
    *   Type: `GAP`
    *   Length: 6 units
    *   TargetElevation: -4 units (Significant Drop)
    *   Note: The landing zone is offset slightly requiring a clean jump.
3.  **The Jitter Turn (Chicane):**
    *   Type: `STRAIGHT_RAMP` x 2 with Sharp Turns.
    *   Sequence: Land -> Turn Right 90 -> Forward 5 -> Turn Left 90 -> Forward 5.
    *   Width: 3 units (Narrow)
    *   WallHeight: 0.0 (No walls - "Corrupted Geometry")
4.  **The Stack Overflow (Vertical Crossover):**
    *   Type: `CURVED_RAMP` (Spiral Down)
    *   Radius: 8 units
    *   Angle: 360 degrees
    *   Incline: -10 degrees
    *   Note: The exit of this spiral crosses *under* the entry point, creating a visual knot.
5.  **System Restore (Goal):**
    *   Type: `BUCKET`
    *   Location: At the bottom of the spiral.

### C. Technical Variables
*   `glitchFrequency` = 0.5 (Controls visual stutter/offset intensity in shader)
*   `platformStability` = 0.8 (If < 1.0, platforms might slowly rotate or tilt)
*   `corruptionColor` = "#FF00FF" (Magenta)

## 12. The "Nano-Loom" Feeder System (Left Wall)
To complement the "Mag-Spin" on the right, we introduce a chaos-engine on the left wall. The Nano-Loom is a vertical Pachinko pegboard that "weaves" the ball's path, acting as a randomizer.

### A. Mechanic: The Vertical Weave
A transparent, wall-mounted pegboard located on the Left Wall.
1.  **Intake:** A "Weaver's Shuttle" vacuum tube located at mid-field (Left).
2.  **Lift:** The ball is sucked up a tube to the top of the loom.
3.  **Process:** The ball drops through a dense hex-grid of "Nano-Pins".
4.  **Output:** The ball exits at the bottom with randomized velocity, aiming for the center field.

### B. Logic State Machine
1.  **IDLE:** Intake vacuum active (Particle suction effect).
2.  **LIFT:**
    *   Trigger: Ball enters `loomIntakeRadius`.
    *   Action: Physics -> Kinematic. Animate ball up the tube path.
    *   Visual: Blue "Data Stream" particles trailing the ball.
3.  **WEAVE:**
    *   Trigger: Ball reaches top.
    *   Action: Physics -> Dynamic.
    *   Visual: Pins light up when hit (Cyan/Magenta flash).
4.  **EJECT:**
    *   Trigger: Ball exits the bottom sensor.
    *   Action: Apply slight forward impulse to clear the wall.

### C. Technical Specification
*   **Loom Position:** `loomPosition` = `{ x: -13.0, y: 4.0, z: 2.0 }` (Centered on Left Wall).
*   **Intake Position:** `intakePosition` = `{ x: -12.0, y: 0.5, z: 2.0 }`.
*   **Dimensions:** Width 2.0, Height 6.0, Depth 1.0.
*   **Pin Grid:**
    *   `pinRows` = 8
    *   `pinCols` = 4
    *   `pinSpacing` = 0.6
    *   `pinBounciness` = 0.8 (High chaos).
*   **Timing:** `liftDuration` = 1.5s.

## 13. The "Prism-Core" Feeder System (Center)
To provide a central goal and a "Multiball" mechanic, we introduce the Prism-Core at the top-center of the playfield.

### A. Mechanic: The Crystal Lock
A rotating crystalline structure that acts as a ball lock.
1.  **Lock:** Captures up to 3 balls.
2.  **Charge:** Visuals intensify as more balls are locked.
3.  **Overload:** Releasing the 3rd ball triggers a "Multiball" event.

### B. Logic State Machine
1.  **IDLE (Empty):**
    *   Visual: Rotating slow, Green pulsing light.
    *   Action: Ready to capture.
2.  **LOCKED_1 (1 Ball):**
    *   Trigger: Ball enters `captureRadius`.
    *   Action: Ball 1 is hidden/disabled.
    *   Visual: Rotate faster, Yellow light. Spawn a new ball at Plunger.
3.  **LOCKED_2 (2 Balls):**
    *   Trigger: Ball enters `captureRadius`.
    *   Action: Ball 2 is hidden/disabled.
    *   Visual: Rotate very fast, Red light, electrical arcs. Spawn a new ball at Plunger.
4.  **OVERLOAD (Multiball Start):**
    *   Trigger: Ball enters `captureRadius` (3rd Ball).
    *   Action:
        *   Release Ball 1 & 2 (Restore Physics, apply impulse).
        *   Release Ball 3 immediately.
        *   Trigger `EVENT_MULTIBALL_START`.
    *   Visual: White explosion, shockwave.

### C. Technical Specification
*   **Position:** `prismPosition` = `{ x: 0.0, y: 0.5, z: 12.0 }` (Top Center).
*   **Capture Zone:** `captureRadius` = 1.2 units.
*   **Physics:**
    *   `ejectForce` = 20.0 (Explosive release).
    *   `ejectSpread` = 45 degrees (Cone of release).
*   **Visuals:** Needs a custom shader for the crystal (refraction).

## 14. Adventure Track: "The Retro-Wave Hills"
A rhythmic, momentum-based track inspired by 80s "Outrun" aesthetics. Unlike the technical precision of the Grid or the speed of the Descent, this track requires "flowing" with the terrain.

### A. Concept
A rolling "Vaporwave" highway featuring a series of sinusoidal hills and banked turns, culminating in a massive jump into a "Setting Sun" bucket.

### B. Layout Definition
   (Side View of Hills)
      /\      /\
     /  \    /  \
   _/    \__/    \__ ... -> Jump

1.  **The Fade In:**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 10 units
    *   Incline: 0 degrees
    *   Width: 6 units
2.  **The Modulation (The Hills):**
    *   *Hill 1:* Rise (Len 8, Inc -15°) -> Fall (Len 8, Inc +15°)
    *   *Hill 2:* Rise (Len 8, Inc -20°) -> Fall (Len 8, Inc +20°)
    *   Note: Smooth transitions are key.
3.  **The Carrier Wave (Banked Turn):**
    *   Type: `CURVED_RAMP`
    *   Radius: 12 units
    *   Angle: 180 degrees
    *   Incline: 0 degrees (Level turn)
    *   Banking: -15 degrees (Inward Tilt)
    *   WallHeight: 2.0
4.  **The High Pass Filter (The Jump):**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 12 units
    *   Incline: -25 degrees (Steep Ramp Up)
    *   Width: 4 units
5.  **The Sunset (Goal):**
    *   Type: `BUCKET`
    *   Location: 15 units forward, 5 units up from jump release.
    *   Visual: "Sun" holographic shader.

### C. Technical Variables
*   `hillAmplitude` = 2.0
*   `waveFrequency` = 1.0
*   `sunColor` = "#FF8800" (Orange)
*   `gridColor` = "#FF00FF" (Magenta)
