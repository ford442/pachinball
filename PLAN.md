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

## 15. Adventure Track: "The Chrono-Core"
A mechanical, timing-based level inspired by the inside of a giant clock. Unlike the flow of the Helix or the speed of the Descent, this track requires *patience* and precise timing to navigate rotating platforms.

### A. Concept
The ball enters a massive clockwork mechanism. The floor itself is alive—rotating gears act as islands in the void. The player must ride the gears and transfer between them when the paths align.

### B. Layout Definition
1.  **The Escapement (Entry):**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 10 units
    *   Incline: -10 degrees (Slope Down)
    *   Width: 5 units
2.  **Gear One (The Minute Hand):**
    *   Type: `ROTATING_PLATFORM`
    *   Radius: 8 units
    *   Rotation: Clockwise (30 deg/sec)
    *   Note: The ball must land on this, ride it for ~180 degrees, and exit.
3.  **The Transfer Bar (Bridge):**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 12 units
    *   Width: 3 units (Narrow)
    *   Incline: 0 degrees
    *   Alignment: Connects Gear One (at 6 o'clock relative position) to Gear Two.
4.  **Gear Two (The Hour Hand):**
    *   Type: `ROTATING_PLATFORM`
    *   Radius: 10 units
    *   Rotation: Counter-Clockwise (20 deg/sec)
    *   Feature: "Teeth" (Partial walls) on the perimeter with gaps for entry/exit.
5.  **The Mainspring (Goal):**
    *   Type: `BUCKET`
    *   Location: Suspended above the center of Gear Two.
    *   Access: A small ramp jump from the Gear surface.

### C. Technical Variables
*   `gearRotationSpeed` = 0.5 (Radians per second)
*   `gearFriction` = 1.0 (High friction to prevent slipping)
*   `clockworkColor` = "#FFD700" (Gold)

## 16. Adventure Track: "The Hyper-Drift"
A high-speed racing track inspired by futuristic anti-gravity racers. Unlike the platforming of the Grid or the verticality of the Helix, this track is about maintaining maximum velocity through wide, banked turns.

### A. Concept
A neon-lit highway floating in a void. The track is wide but features extreme banking angles (up to 45 degrees). The player must use momentum to "drift" along the walls without flying off.

### B. Layout Definition
1.  **Gravity Injection (Launch):**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 15 units
    *   Incline: -20 degrees (Down)
    *   Width: 8 units (Wide)
2.  **Alpha Turn (Drift Left):**
    *   Type: `CURVED_RAMP`
    *   Radius: 15 units
    *   Angle: 90 degrees
    *   Incline: -5 degrees
    *   Banking: -30 degrees (Inward)
    *   WallHeight: 2.0
3.  **Beta Turn (Drift Right - S-Curve):**
    *   Type: `CURVED_RAMP`
    *   Radius: 15 units
    *   Angle: 90 degrees
    *   Incline: -5 degrees
    *   Banking: 30 degrees (Inward relative to turn)
    *   WallHeight: 2.0
4.  **The Corkscrew (Inversion):**
    *   Type: `CURVED_RAMP`
    *   Radius: 10 units
    *   Angle: 360 degrees
    *   Incline: -10 degrees
    *   Banking: -45 degrees (Steep)
5.  **Nitro Jump (Goal Approach):**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 10 units
    *   Incline: 30 degrees (Up)
    *   Width: 6 units
6.  **Finish Line (Goal):**
    *   Type: `BUCKET`
    *   Location: At the end of the jump trajectory.

### C. Technical Variables
*   `driftBankingMax` = 45.0 (Degrees)
*   `trackWidthWide` = 8.0
*   `boostGravity` = 1.2 (Slightly higher gravity to stick to track)
*   `neonColor` = "#00FFFF" (Cyan)

## 17. Adventure Track: "The Pachinko Spire"
A tribute to the game's roots. This vertical-scrolling track turns the adventure mode into a massive, perilous Pachinko board. The ball falls down a steep incline filled with pins, requiring nudging to avoid "Dead Zones".

### A. Concept
A giant, glowing vertical board. The camera looks down (or sideways?). The ball tumbles through a forest of neon pegs.

### B. Layout Definition
1.  **The Drop Gate:**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 5 units
    *   Incline: -45 degrees
    *   Width: 6 units
2.  **The Pin Field (Main Body):**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 30 units (Very Long)
    *   Incline: -75 degrees (Almost Vertical)
    *   Width: 12 units (Wide)
    *   Feature: "Peg Grid" - Static Cylinder Obstacles spaced every 2 units.
3.  **The Mill (Mid-Field Hazard):**
    *   Type: `ROTATING_PLATFORM` x 2
    *   Radius: 3 units
    *   Rotation: Opposing directions.
    *   Location: Embedded in the ramp surface (half-submerged?).
4.  **The Catch Basins (Bottom):**
    *   Type: `BUCKET` x 3
    *   Left: "Reset" (Teleport back to top).
    *   Center: "Goal" (Mission Complete).
    *   Right: "Reset".

### C. Technical Variables
*   `pinDensity` = 0.5 (Pins per unit area)
*   `boardIncline` = 75.0
*   `pinBounciness` = 0.6
*   `boardColor` = "#FFFFFF" (Silver/Chrome)

## 18. Adventure Track: "The Orbital Junkyard"
A chaotic, zero-G simulation where the player must navigate through a dense field of static debris. Unlike the clean lines of other tracks, this level is messy and cluttered, requiring fine control to avoid getting stuck or bouncing into the void.

### A. Concept
A floating graveyard of old satellites and space rocks. The path is not a clean ramp but a wide, slightly sloped field littered with static geometric obstacles.

### B. Layout Definition
1.  **Launch Tube:**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 8 units
    *   Incline: -10 degrees
    *   Width: 4 units
    *   Visual: "Tunnel" rings.
2.  **The Debris Field:**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 25 units
    *   Incline: -5 degrees (Gentle Slope)
    *   Width: 10 units (Wide)
    *   Feature: "Space Junk" - 20-30 static obstacles (cubes, tetrahedrons) placed randomly on the surface.
    *   Walls: Low (0.5) and broken (gaps).
3.  **The Crusher (Hazard):**
    *   Type: `ROTATING_PLATFORM` (Vertical orientation?) or just a narrow gap.
    *   Let's use a "Choke Point".
    *   Two large static blocks creating a narrow 2-unit wide gap in the center.
4.  **Escape Pod (Goal):**
    *   Type: `BUCKET`
    *   Location: At the end of the debris field.

### C. Technical Variables
*   `debrisDensity` = 1.0 (Obstacles per unit area)
*   `debrisScale` = 0.5 to 1.5 (Random size variance)
*   `junkColor` = "#888888" (Grey/Rusty)

## 19. Adventure Track: "The Firewall Breach"
A kinetic, destructible environment where the player must smash through physical barriers to progress. Unlike the static obstacles of the Junkyard, these barriers are dynamic physics objects that react to impact.

### A. Concept
A security tunnel filled with "Data Blocks" (Crates). The ball acts as a battering ram. The player must build enough speed on the entry ramp to scatter the lightweight debris, then find the weak points in the heavier "Firewall" panels.

### B. Layout Definition
      [Entry Ramp]
           \
            \  (Steep Drop -25°)
             \
    [Zone 1: Debris]      [Chicane]      [Zone 2: Heavy Wall]    [Goal]
    +--------------+    +-----------+    +------------------+    +----+
    | . . . . . .  | -> |  |     |  | -> |    [###] [###]   | -> | () |
    | . . . . . .  |    |  |     |  |    |    [###] [###]   |    +----+
    +--------------+    +-----------+    +------------------+

1.  **Packet Stream (Launch):**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 20 units
    *   Incline: -25 degrees (Steep drop for max speed)
    *   Width: 6 units
2.  **Security Layer 1 (Debris Field):**
    *   Type: `STRAIGHT_RAMP` (Flat)
    *   Length: 15 units
    *   Width: 8 units
    *   Feature: "Data Blocks" - A 4x5 grid of small, lightweight dynamic boxes (Mass 0.5) stacked loosely.
    *   Visuals: Blue semi-transparent cubes.
3.  **The Chicane (Filter):**
    *   Type: `CURVED_RAMP` (S-Bend)
    *   Radius: 10 units
    *   Angle: 90 degrees Left then 90 degrees Right.
    *   Feature: Static pillars forcing the ball to realign and lose some speed, increasing the challenge for the next wall.
4.  **Security Layer 2 (The Heavy Wall):**
    *   Type: `STRAIGHT_RAMP` (Flat)
    *   Length: 10 units
    *   Feature: "Firewall Panels" - 3 large, heavy dynamic blocks (Mass 5.0) placed side-by-side, blocking the path.
    *   Mechanic: They are heavy but not fixed. A high-speed impact is required to push them off the edge.
5.  **Root Access (Goal):**
    *   Type: `BUCKET`
    *   Location: Behind Layer 2.

### C. Technical Variables
*   `blockMassLight` = 0.5
*   `blockMassHeavy` = 5.0
*   `wallFriction` = 0.1 (Low friction floor to help sliding)
*   `firewallColor` = "#FF4400" (Orange/Red)
*   `debrisColor` = "#0088FF" (Cyan/Blue)

## 20. Adventure Track: "The CPU Core"
A hardware-themed track that simulates navigating the intricate pathways of a motherboard. The player must traverse data buses, bypass logic gates, and survive the high-speed cooling fan to reach the central processor.

### A. Concept
A flat, geometric "City of Circuits" floating in a dark void. The path is defined by gold traces on a green PCB background. The main hazard is the "Cooling Fan", a high-speed rotating platform that can fling the ball into the void if not timed correctly.

### B. Layout Definition
1.  **The Front Side Bus (Entry):**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 15 units
    *   Incline: 0 degrees (Flat)
    *   Width: 6 units (Wide)
    *   WallHeight: 1.0
2.  **The Logic Gate (Chicane):**
    *   Type: `STRAIGHT_RAMP` x 3
    *   Sequence: Forward 5 -> Left 90 (Sharp) -> Forward 5 -> Right 90 (Sharp) -> Forward 5.
    *   Width: 3 units (Narrow)
    *   WallHeight: 0.0 (No walls - Precision required)
3.  **The Heatsink (Hazard):**
    *   Type: `ROTATING_PLATFORM`
    *   Radius: 8 units
    *   Rotation: Clockwise (90 deg/sec - Fast)
    *   Feature: "Fan Blades" (Teeth) - 4 large blades that act as sweeping walls.
4.  **The Thermal Bridge:**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 10 units
    *   Incline: 0 degrees
    *   Width: 2 units (Very Narrow)
    *   Connection: From the edge of the Fan to the Die.
5.  **The Processor Die (Goal):**
    *   Type: `BUCKET`
    *   Location: At the end of the bridge.
    *   Visual: Square "Chip" socket.

### C. Technical Variables
*   `fanSpeed` = 1.5 (Radians per second)
*   `pcbColor` = "#004400" (Dark Green)
*   `traceColor` = "#FFD700" (Gold)
*   `busWidth` = 6.0
*   `bridgeWidth` = 2.0

## 21. Adventure Track: "The Cryo-Chamber"
A frozen, frictionless expanse where momentum is king. The ball slides effortlessly, making braking impossible. Precision is required to navigate the "Slalom" gates without sliding off the narrow "Ice Bridge".

### A. Concept
A low-friction environment using an "Ice" aesthetic (Cyan/White, High Specular). The challenge is not speed generation but speed *control* and directional steering on slippery surfaces.

### B. Layout Definition
1.  **Flash Freeze (Entry):**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 15 units
    *   Incline: -20 degrees (Down)
    *   Width: 6 units
    *   Friction: 0.0 (Zero Friction)
2.  **The Slalom (Chicane):**
    *   Type: `CURVED_RAMP` x 3 (Connected)
    *   Sequence: Left 45 -> Right 90 -> Left 45.
    *   Radius: 10 units
    *   Feature: "Ice Pillars" (Static Cylinders) placed at the apex of each turn to force tight lines.
3.  **The Ice Bridge (Hazard):**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 12 units
    *   Width: 2.5 units (Narrow)
    *   WallHeight: 0.0 (No Walls)
    *   Note: Banking is critical here.
4.  **The Avalanche (Descent):**
    *   Type: `CURVED_RAMP`
    *   Radius: 10 units
    *   Angle: 180 degrees
    *   Incline: -15 degrees
    *   Banking: -20 degrees (Steep Inward Tilt)
5.  **Absolute Zero (Goal):**
    *   Type: `BUCKET`
    *   Location: At the bottom of the spiral.

### C. Technical Variables
*   `iceFriction` = 0.001 (Near zero)
*   `iceColor` = "#A5F2F3" (Ice Blue)
*   `pillarCount` = 6
*   `bridgeWidth` = 2.5

## 22. Adventure Track: "The Bio-Hazard Lab"
A toxic waste processing facility where the environment itself is the enemy. The ball must navigate high-speed centrifuges and narrow pipelines without falling into the radioactive sludge.

### A. Concept
A neon-green industrial zone. The "Sludge" is a visual hazard (and potentially sticky physics surface). The core mechanic is the "Centrifuge", a high-speed rotating ring that acts as a gravity well, flinging the ball outward if it doesn't maintain speed.

### B. Layout Definition
1.  **The Sludge Chute (Entry):**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 15 units
    *   Incline: -20 degrees (Steep Drop)
    *   Width: 6 units
    *   Friction: 0.1 (Slippery)
2.  **The Centrifuge (Hazard):**
    *   Type: `ROTATING_PLATFORM`
    *   Radius: 10 units
    *   Rotation: Counter-Clockwise (High Speed: 3.0 rad/s)
    *   Feature: "Containment Wall" - Outer rim wall is only 0.5 units high. High speed risks flying over.
3.  **The Pipeline (Tunnel):**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 12 units
    *   Width: 2.5 units (Very Narrow)
    *   WallHeight: 4.0 (Full Tube effect)
    *   Incline: 0 degrees
4.  **The Mixing Vats (Chicane):**
    *   Type: `CURVED_RAMP` (S-Bend)
    *   Radius: 8 units
    *   Angle: 90 Left then 90 Right
    *   Feature: Gaps in the floor ("Open Vats") requiring velocity to cross.
5.  **Containment Unit (Goal):**
    *   Type: `BUCKET`
    *   Location: At the end of the chicane.

### C. Technical Variables
*   `hazardColor` = "#39FF14" (Lime Green)
*   `warningColor` = "#FFFF00" (Yellow)
*   `sludgeFriction` = 0.05
*   `centrifugeSpeed` = 3.0

## 23. Adventure Track: "The Gravity Forge" [IMPLEMENTED]
A heavy industrial zone where raw data is forged into hardened packets. The environment is dominated by crushing pistons, conveyor belts, and molten data streams. Unlike the speed of the Descent or the precision of the Grid, this track is about *timing* and surviving heavy machinery.

### A. Concept
A rust-and-steel factory floating in the void. The "Floor" is often moving (conveyor belts). The main hazards are massive hydraulic pistons that crush anything in their path.

### B. Layout Definition
1.  **The Feed Chute (Entry):**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 12 units
    *   Incline: -30 degrees (Steep Drop)
    *   Width: 6 units
    *   Feature: "Conveyor Floor" - Texture scrolls downwards, and physics applies a constant forward impulse (Force +5.0 Z).
2.  **The Crusher Line (Hazard):**
    *   Type: `STRAIGHT_RAMP` (Flat)
    *   Length: 20 units
    *   Width: 8 units
    *   Feature: "Hydraulic Pistons" - 3 Large Kinematic Boxes (Width 6, Depth 3, Height 4) suspended above the track.
    *   Motion: Vertical Sinusoidal (`y = 2.0 + sin(t * freq) * 2.0`).
    *   Timing: Staggered (0.0, 1.5, 3.0 sec offsets).
    *   Mechanic: The pistons slam down to the floor (Gap 0.2). If the ball is underneath, it is crushed (Reset).
3.  **The Slag Bridge (Chicane):**
    *   Type: `CURVED_RAMP` (S-Bend)
    *   Radius: 10 units
    *   Angle: 90 Left then 90 Right.
    *   Incline: 0 degrees.
    *   Width: 2 units (Very Narrow Beam).
    *   WallHeight: 0.0 (No Walls).
    *   Visual: The floor is a grate; below is a glowing orange "Molten Data" pool.
4.  **The Centrifugal Caster (Turn):**
    *   Type: `ROTATING_PLATFORM`
    *   Radius: 10 units.
    *   Rotation: High Speed (2.0 rad/s).
    *   WallHeight: 3.0 (To keep ball in).
    *   Exit: A 30-degree gap in the wall that aligns with the goal ramp once per rotation.
5.  **The Quenching Tank (Goal):**
    *   Type: `BUCKET`
    *   Location: 5 units below the Caster exit.
    *   Visual: Blue liquid surface with steam particles.

### C. Technical Variables
*   `pistonFreq` = 1.0 (Hz)
*   `conveyorSpeed` = 5.0
*   `forgeColor` = "#FF4500" (Molten Orange)
*   `steelColor` = "#333333" (Dark Steel)
*   `rustColor` = "#8B4513" (Rust)

## 24. Adventure Track: "The Tidal Nexus"
A hydro-dynamic level focusing on fluid forces. The ball is not just subject to gravity, but to strong "Currents" (Conveyor Forces) that push and pull it. The environment is a stylized cyber-ocean.

### A. Concept
A series of aqueducts and reservoirs floating in a deep blue void. The "Water" is simulated by low-friction blue surfaces with invisible conveyor sensors applying directional force.

### B. Layout Definition
1.  **The Spillway (Injection):**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 15 units
    *   Incline: -20 degrees (Down)
    *   Width: 6 units
    *   Feature: "Rapids" - Conveyor Force (+8.0 Z) accelerates the ball beyond normal gravity.
2.  **The Turbine (Hazard):**
    *   Type: `ROTATING_PLATFORM`
    *   Radius: 8 units
    *   Rotation: Clockwise (1.5 rad/s)
    *   Feature: "Paddle Wheels" - 4 rotating walls that sweep across the platform.
3.  **The Riptide (Turn):**
    *   Type: `CURVED_RAMP`
    *   Radius: 12 units
    *   Angle: 180 degrees
    *   Incline: -5 degrees
    *   Banking: -10 degrees (Inward)
    *   Feature: "Cross-Current" - Conveyor Force pushes *Outward* (Towards the wall), fighting the banking.
4.  **The Wave Pool (Chicane):**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 20 units
    *   Width: 8 units
    *   Feature: "Tidal Pistons" - 5 rows of kinematic boxes moving in a sine-wave pattern (`sin(t + z)`), creating a rippling floor.
5.  **The Abyssal Drop (Goal):**
    *   Type: `BUCKET`
    *   Location: At the bottom of a steep waterfall drop.
    *   Visual: Deep Blue fog/glow.

### C. Technical Variables
*   `currentStrength` = 8.0
*   `waterFriction` = 0.1
*   `waterColor` = "#0066FF" (Deep Sky Blue)
*   `foamColor` = "#E0FFFF" (Light Cyan)
*   `waveAmplitude` = 1.5

## 25. Adventure Track: "The Digital Zen Garden"
A serene, high-friction track emphasizing precision rolling over speed. The aesthetic combines stark white "gravel" grids with neon cherry-blossom pink accents.

### A. Concept
A minimalist sanctuary in the void. The ball rolls heavily on "raked sand" surfaces (high friction), requiring deliberate force. The hazards are static "Data Rocks" and a flowing "Stream" of data.

### B. Layout Definition
1.  **The Raked Path (Entry):**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 15 units
    *   Incline: -15 degrees
    *   Width: 8 units
    *   Friction: 0.8 (High drag - simulates sand/gravel)
    *   Visual: Texture scrolling slowly backward to simulate raking.
2.  **The Rock Garden (Obstacles):**
    *   Type: `STRAIGHT_RAMP` (Flat)
    *   Length: 20 units
    *   Width: 12 units (Wide)
    *   Feature: "Meditative Stones" - 3 Large Static Geospheres (Radius 2.0) positioned to block direct paths.
    *   Layout: Triangular formation (One central, two flankers).
3.  **The Stream Crossing (Hazard):**
    *   Type: `CURVED_RAMP` (Gentle Turn)
    *   Radius: 15 units
    *   Angle: 90 degrees
    *   Incline: 0 degrees
    *   Friction: 0.1 (Slippery "Water")
    *   Feature: "Current" - Conveyor Force (+3.0 X) pushing towards the outer edge (The Waterfall).
4.  **The Moon Bridge (Vertical Arch):**
    *   Type: `STRAIGHT_RAMP` (Modified)
    *   Length: 10 units
    *   Width: 3 units (Narrow)
    *   Shape: Parabolic Arch (Rise 3 units then Fall 3 units).
    *   WallHeight: 1.0 (Low rails).
5.  **The Lotus Shrine (Goal):**
    *   Type: `BUCKET`
    *   Location: Floating just beyond the bridge.
    *   Visual: Blooming holographic flower.

### C. Technical Variables
*   `sandFriction` = 0.8
*   `waterFriction` = 0.1
*   `currentForce` = 3.0
*   `gardenColor` = "#FFFFFF" (White)
*   `accentColor` = "#FF69B4" (Hot Pink)
*   `rockScale` = 2.0

## 26. The "Gauss-Cannon" Feeder System
To balance the playfield and provide a recovery mechanic on the lower-left side, we introduce a kinetic launcher.

### A. Mechanic: The Auto-Turret
A mounted electromagnetic railgun located on the lower-left wall.
1.  **Catch:** Catches balls draining down the left outlane or specifically targeted shots.
2.  **Aim:** The turret pivots automatically, sweeping the upper playfield.
3.  **Fire:** Launches the ball at high velocity.

### B. Logic State Machine
1.  **IDLE:** Breech open, sweeping slowly (visuals only).
2.  **LOAD:**
    *   Trigger: Ball enters `gaussIntakeRadius`.
    *   Action: Physics -> Kinematic. Ball moves to "Breech" position.
    *   Visual: Charging coils glow (Orange/Blue).
3.  **AIM (Oscillation):**
    *   Action: Cannon rotates between `minAngle` and `maxAngle`.
    *   Duration: 2.0s (Player can time this?).
4.  **FIRE:**
    *   Trigger: Timer expires OR Player hits Action Key.
    *   Action: Apply Impulse.
    *   Visual: Muzzle flash, chromatic aberration shockwave.
5.  **COOLDOWN:**
    *   Action: Ignore collisions.

### C. Technical Specification
*   **Position:** `gaussPosition` = `{ x: -12.0, y: 0.5, z: -8.0 }`.
*   **Intake Radius:** 1.0 units.
*   **Physics:**
    *   `muzzleVelocity` = 30.0.
    *   `minAngle` = 30 degrees (Towards Center).
    *   `maxAngle` = 60 degrees (Towards Upper Right).
    *   `sweepSpeed` = 1.0 (Radians/sec).

## 27. Adventure Track: "The Synthwave Surf"
A rhythmic, musical track where the environment pulses to the beat. The obstacles are audio visualizations brought to life.

### A. Concept
A neon highway shaped like an audio waveform. The key mechanic is timing: the "Equalizer" pistons block and clear paths rhythmically.

### B. Layout Definition
      [The Bass Drop]
           \
            \ (Steep -25°)
             \
    [The Equalizer]       [High-Pass Turn]      [Sub-Woofer]
    +-------------+       /              \       /   \
    | || || || || | ---> |                | ->  | (O) |
    | || || || || |      |                |      \   /
    +-------------+       \              /        ---
    (Pistons Wave)         --------------

1.  **The Bass Drop (Entry):**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 15 units
    *   Incline: -25 degrees
    *   Width: 8 units
    *   Visual: Pulsing "Chevron" arrows on the floor.
2.  **The Equalizer (Hazard):**
    *   Type: `STRAIGHT_RAMP` (Flat)
    *   Length: 20 units
    *   Width: 10 units
    *   Feature: "EQ Bars" - 5 Rows of 4 Pistons (Width 1.5, Height 3.0) across the track.
    *   Pattern: They rise and fall in a "Spectrum Analyzer" wave pattern (`y = abs(sin(t + x))`).
    *   Note: The ball must navigate the "troughs" of the wave.
3.  **The High-Pass Filter (Turn):**
    *   Type: `CURVED_RAMP`
    *   Radius: 12 units
    *   Angle: 180 degrees
    *   Incline: 5 degrees (Uphill)
    *   Banking: -15 degrees (Inward)
    *   Visual: The floor texture is a frequency grid.
4.  **The Sub-Woofer (Goal Approach):**
    *   Type: `CURVED_RAMP` (Spiral)
    *   Radius: 6 units
    *   Angle: 360 degrees
    *   Incline: -15 degrees (Down)
    *   Banking: -30 degrees (Steep Inward)
    *   Visual: "Speaker Cone" texture.
5.  **The Mic Drop (Goal):**
    *   Type: `BUCKET`
    *   Location: At the bottom of the spiral.

### C. Technical Variables
*   `bpm` = 120 (Controls piston speed)
*   `barColor` = "#00FF00" to "#FF0000" (Gradient)
*   `floorColor` = "#110022" (Dark Purple)
*   `gridColor` = "#00FFFF" (Cyan)

## 28. Adventure Track: "The Solar Flare"
A blazing journey across the surface of a star. The environment is hostile, with "Solar Wind" pushing the ball off-course and "Magnetic Loops" defying gravity. The aesthetic is blindingly bright (Orange/Yellow) with plasma shockwaves.

### A. Concept
A high-energy, high-risk track. The "Solar Wind" forces the player to fight against lateral movement, while the "Sunspot Fields" act as reverse bumpers (gravity wells) that trap the ball.

### B. Layout Definition
1.  **Coronal Mass Ejection (Launch):**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 15 units
    *   Incline: -20 degrees (Down)
    *   Width: 6 units
    *   Feature: "Plasma Boost" - Conveyor Force (+10.0 Z) for extreme acceleration.
2.  **The Prominence (Vertical Arch):**
    *   Type: `STRAIGHT_RAMP` (Modified)
    *   Length: 20 units
    *   Width: 4 units
    *   Shape: Parabolic Arch (Rise 8 units, Fall 8 units).
    *   WallHeight: 0.5 (Low - Risk of falling).
    *   Visual: Glowing magnetic field lines.
3.  **The Sunspot Field (Hazard):**
    *   Type: `STRAIGHT_RAMP` (Flat)
    *   Length: 25 units
    *   Width: 12 units
    *   Feature: "Gravity Wells" - 3 Large Sensor Zones.
    *   Mechanic: If ball enters, apply force towards center of zone (Pulling it into a trap).
    *   Visual: Dark, swirling vortices on the surface.
4.  **The Solar Wind (Cross-Force):**
    *   Type: `CURVED_RAMP`
    *   Radius: 15 units
    *   Angle: 180 degrees
    *   Incline: 0 degrees
    *   Feature: "Solar Wind" - Continuous Lateral Force (+5.0 X) pushing the ball towards the outer edge.
    *   Banking: 0 degrees (No help from banking).
5.  **Fusion Core (Goal):**
    *   Type: `BUCKET`
    *   Location: Center of a "Dyson Ring" structure.
    *   Visual: Blinding White Sphere.

### C. Technical Variables
*   `windStrength` = 5.0
*   `plasmaColor` = "#FF4500" (Orange Red)
*   `coreColor` = "#FFFF00" (Yellow)
*   `gravityWellStrength` = 10.0
*   `flareIntensity` = 1.2

## 29. Adventure Track: "The Prism Pathway"
A delicate, optical track made of refracting glass and hard light. The ball must navigate through "Fiber Optic" tubes and avoid the sweeping "Laser Beams".

### A. Concept
A crystalline environment where the floor is transparent glass. The main hazards are "Laser Arrays" - moving red beams (cylinders) that act as solid walls or resets. The aesthetic is Cyan (Glass) and Magenta (Laser).

### B. Layout Definition
1.  **The Fiber Injection (Entry):**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 15 units
    *   Incline: -20 degrees
    *   Width: 4 units
    *   Visual: Semi-transparent tube.
2.  **The Refractor Field (Obstacles):**
    *   Type: `STRAIGHT_RAMP` (Flat)
    *   Length: 20 units
    *   Width: 10 units
    *   Feature: "Prism Bumpers" - 5 Triangular Static Prisms (Triangular Prism Mesh).
    *   Layout: Scattered to deflect the ball.
3.  **The Laser Gauntlet (Hazard):**
    *   Type: `STRAIGHT_RAMP`
    *   Length: 25 units
    *   Width: 8 units
    *   Feature: "Sweeping Lasers" - 3 Kinematic Cylinders (Thin, Red).
    *   Motion: Moving side-to-side (X-axis) across the track.
    *   Mechanic: They are physical walls; getting hit pushes you off.
4.  **The Spectrum Loop (Vertical):**
    *   Type: `CURVED_RAMP` (Spiral Up)
    *   Radius: 8 units
    *   Angle: 360 degrees
    *   Incline: 10 degrees
    *   Banking: 20 degrees
5.  **The White Light (Goal):**
    *   Type: `BUCKET`
    *   Location: At the top of the spiral.
    *   Visual: Glowing White Sphere.

### C. Technical Variables
*   `glassColor` = "#E0FFFF" (Cyan)
*   `laserColor` = "#FF00FF" (Magenta)
*   `prismReflectivity` = 0.8
