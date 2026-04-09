# Weekly Development Plan: Gold Pachinko Balls Feature

## Overview
This week we're introducing **Gold Pachinko Balls** as special collectible items within the machine. These premium balls will add visual richness and create distinct gameplay moments as players collect and stack them.

---

## Feature: Gold Pachinko Balls

### Visual Variants

#### Gold-Plated Balls
- **Appearance:** Lighter, more reflective surface with subtle highlights
- **Material Properties:** 
  - High metallic factor
  - Lower roughness for polished look
  - Subtle specular highlights
  - Slight yellow/warm tone overlay
- **Purpose:** Common premium variant, earns standard bonus points

#### Solid Gold Balls
- **Appearance:** Deeper, richer gold color with premium material definition
- **Material Properties:**
  - Rich yellow-gold base color
  - Higher metallic saturation
  - Controlled roughness for realistic precious metal appearance
  - Strong reflectivity with warm light response
- **Purpose:** Rare jackpot variant, high-value scoring moment

### Visual Implementation
- **PBR Materials:** Leverage existing PBR system (see MATERIAL_PBR_AUDIT_REPORT.md)
- **Material Definitions:**
  - Create separate metallic material slots for each variant
  - Define albedo, normal maps, roughness, and metallic parameters
  - Ensure proper light interaction under varying cabinet lighting conditions
- **Visual Distinction:** Both variants must be instantly recognizable to players during gameplay

### Ball Stacking & Counting Mechanics
- Balls accumulate as they're collected, simulating traditional pachinko ball counting
- Stacking creates visual feedback for player progress
- Rare solid gold balls create memorable collection moments with special effects

### Integration Points
- **Scoring System:** Gold ball collection triggers bonus points
- **Game State:** Ball collection tracked and displayed
- **Visual Feedback:** Balls reflect cabinet lighting for immersive gameplay
- **Cabinet Reactions:** Lighting and effects sync with gold ball collection events

---

## Technical References
- MATERIAL_PBR_AUDIT_REPORT.md - PBR material system
- PLAN.md - Overall game architecture
- PHYSICS_AUDIT_MASTER.md - Ball physics integration
