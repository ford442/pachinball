# Weekly Swarm Plan: Kimi Code Tasks

> Status Update: Major Refactoring Progress!

---

## 🎉 Major Milestone: Refactoring 70% Complete!

| Workstream | Progress | Notes |
|------------|----------|-------|
| **Gold Ball Feature** | ✅ 100% | All 8 tasks complete |
| **MaterialLibrary** | ✅ 100% | Migrated to `src/materials/`, old file deleted |
| **Cabinet System** | ✅ 100% | Migrated to `src/cabinet/`, old files deleted |
| **game.ts** | 🔄 70% | Down to 3660 lines (from 4026), 7 manager classes extracted |
| **Display System** | ✅ 100% | Migrated to `src/display/`, old file deleted |
| **GameObjects** | ✅ 100% | Migrated to `src/objects/`, old file deleted |
| **Effects** | ⏳ 0% | Not started - still 1536 lines |
| **AdventureMode** | ⏳ 0% | Not started - still 1438 lines |
| **Bug Fixes** | 🔄 50% | Some video fixes in progress |

---

## ✅ Completed Work

### 1. Gold Ball Feature (8/8 tasks) ✅
All features working: ball types, materials, collection, UI, debug HUD, stack visual.

### 2. MaterialLibrary Refactor ✅ DONE
**Old:** `src/game-elements/material-library.ts` (1839 lines) - **DELETED**

**New:** `src/materials/` (6 files, all <1000 lines)
- material-core.ts (413 lines)
- material-ball.ts (164 lines) - includes gold
- material-metallic.ts (313 lines)
- material-interactive.ts (377 lines)
- material-structural.ts (654 lines)
- index.ts (308 lines)

### 3. Cabinet Refactor ✅ 100% DONE
**New:** `src/cabinet/` (7 files)
- cabinet-types.ts (91 lines)
- cabinet-classic.ts (447 lines)
- cabinet-neo.ts (533 lines)
- cabinet-vertical.ts (459 lines)
- cabinet-wide.ts (362 lines)
- cabinet-builder.ts (308 lines)
- index.ts (47 lines)

**Imports Updated:** game.ts now uses `from './game/game-cabinet'`

**✅ Cleanup Complete:** Old files deleted:
- `src/game-elements/cabinet-builder.ts` (1653 lines) - DELETED
- `src/game-elements/cabinet-presets.ts` (1650 lines) - DELETED
- `src/game-elements/cabinet.ts` (823 lines) - DELETED

### 4. game.ts Refactor 🔄 70% DONE
**Progress:** 3660 lines (down from 4026, -366 lines)

**Extracted to `src/game/`:**
- ✅ game-state.ts (110 lines) - GameStateManager
- ✅ game-input.ts (191 lines) - GameInputManager
- ✅ game-maps.ts (188 lines) - TableMapManager
- ✅ game-cabinet.ts (85 lines) - CabinetManager
- ✅ game-ui.ts (272 lines) - GameUIManager
- ✅ game-adventure.ts (342 lines) - AdventureManager
- ✅ index.ts (23 lines) - barrel exports

**game.ts now uses:**
```typescript
private stateManager!: GameStateManager
private inputManager: GameInputManager | null = null
private mapManager: TableMapManager | null = null
private cabinetManager: CabinetManager | null = null
private uiManager: GameUIManager | null = null
private adventureManager: AdventureManager | null = null
```

### 5. Display System Refactor ✅ 100% DONE
**New:** `src/display/` (6 files)
- display-core.ts (169 lines) - Main DisplaySystem
- display-types.ts (104 lines) - Shared types
- display-reels.ts (91 lines) - Slot reels layer
- display-shader.ts (222 lines) - Shader background
- display-video.ts (108 lines) - Video layer with null fix
- index.ts (18 lines) - barrel exports

**Imports Updated:** Files now import from `../display` instead of display.ts

**✅ Cleanup Complete:** Old file deleted:
- `src/game-elements/display.ts` (1619 lines) - DELETED

---

## 🔄 Current Task Queue

### 🔥 Critical (Do Now)

#### Task 5.1: Cleanup Old Files
**Status:** ✅ COMPLETE  
**Files Deleted:**
```bash
src/game-elements/cabinet-builder.ts
src/game-elements/cabinet-presets.ts
src/game-elements/cabinet.ts
src/game-elements/display.ts
src/game-elements/game-objects.ts
```

**Verification completed:**
- [x] Checked no files import from old locations (only display-config.ts remains, which is separate)
- [x] Type check passes (`npx tsc --noEmit`)
- [x] Deleted files
- [x] Updated weekly_swarm.md

---

### 📋 High Priority (Next)

#### Task 2.10: Split GameObjects
**Status:** ⏳ PENDING  
**File:** `src/game-elements/game-objects.ts` (1549 lines)  
**Creates:** `src/objects/*.ts`

```
src/objects/
├── object-core.ts         # GameObjects class (~400 lines)
├── object-flippers.ts     # Flipper creation (~300 lines)
├── object-bumpers.ts      # Bumper creation (~350 lines)
├── object-walls.ts        # Wall/rail creation (~250 lines)
├── object-pachinko.ts     # Pachinko field (~200 lines)
└── index.ts               # Barrel export
```

**Checklist:**
- [ ] Create `src/objects/` folder
- [ ] Extract object-flippers.ts
- [ ] Extract object-bumpers.ts
- [ ] Extract object-walls.ts
- [ ] Extract object-pachinko.ts
- [ ] Update imports in game.ts
- [ ] Test objects still render
- [ ] Delete old game-objects.ts

---

#### Task 2.11: Split Effects System
**Status:** ⏳ PENDING  
**File:** `src/game-elements/effects.ts` (1536 lines)  
**Creates:** `src/effects/*.ts`

```
src/effects/
├── effects-core.ts        # EffectsSystem orchestrator (~500 lines)
├── effects-particles.ts   # Particle systems (~400 lines)
├── effects-lighting.ts    # Lighting effects (~300 lines)
├── effects-camera.ts      # Camera shake/animations (~250 lines)
└── index.ts               # Barrel export
```

**Checklist:**
- [ ] Create `src/effects/` folder
- [ ] Extract effects-particles.ts
- [ ] Extract effects-lighting.ts
- [ ] Extract effects-camera.ts
- [ ] Update imports
- [ ] Test effects still work
- [ ] Delete old effects.ts

---

#### Task 2.12: Split Adventure Mode
**Status:** ⏳ PENDING  
**File:** `src/game-elements/adventure-mode.ts` (1438 lines)  
**Creates:** `src/adventure/*.ts`

```
src/adventure/
├── adventure-core.ts      # AdventureMode class (~500 lines)
├── adventure-events.ts    # Event handling (~300 lines)
├── adventure-tracks.ts    # Track management (~350 lines)
├── adventure-zones.ts     # Zone transitions (~250 lines)
└── index.ts               # Barrel export
```

---

### 🎯 Optimization Tasks

#### Task 5.2: Further Reduce game.ts
**Current:** 3660 lines  
**Target:** <1000 lines  
**Remaining to extract:**
- Physics initialization (~200 lines)
- Render loop (~150 lines)
- Scene building (~400 lines)
- Cleanup/disposal (~150 lines)
- Main init flow (~300 lines)

**Creates:**
```
src/game/
├── game-physics.ts        # Physics setup
├── game-render.ts         # Render loop
├── game-scene.ts          # Scene building
└── (existing files...)
```

---

### 🐛 Bug Fixes (Lower Priority)

#### Task 4.1: Video Layer Null Error
**Status:** 🔄 IN PROGRESS  
**File:** `src/display/display-video.ts` (already has fix)

**Fix Applied:** Null checks in disposeVideoLayer()

#### Task 4.2: Cleanup Old Cabinet Files
**Status:** ⏳ PENDING  
**Action:** Delete after verification

#### Task 4.3: Performance Optimization
**Target:** Frame time <16ms  
**Actions:**
- Limit shadow casters
- Cap particles at 100
- Debounce HUD updates

---

## 📊 File Size Tracker

| File | Before | Current | Target | Status |
|------|--------|---------|--------|--------|
| ~~game.ts~~ | ~~4026~~ | ~~3660~~ | <1000 | 🔄 IN PROGRESS |
| ~~display.ts~~ | ~~1619~~ | ~~1619~~ | DELETE | ✅ MIGRATED |
| game-objects.ts | 1549 | 1549 | <1000 | ⏳ PENDING |
| effects.ts | 1536 | 1536 | <1000 | ⏳ PENDING |
| adventure-mode.ts | 1438 | 1438 | <1000 | ⏳ PENDING |
| ~~cabinet-builder.ts~~ | ~~1653~~ | ~~1653~~ | DELETE | ✅ MIGRATED |
| ~~cabinet-presets.ts~~ | ~~1650~~ | ~~1650~~ | DELETE | ✅ MIGRATED |
| ~~cabinet.ts~~ | ~~823~~ | ~~823~~ | DELETE | ✅ MIGRATED |
| ~~material-library.ts~~ | ~~1839~~ | ~~DELETED~~ | - | ✅ DONE |

**New Structure:**
```
src/
├── cabinet/           (7 files, all <550 lines) ✅
├── display/           (6 files, all <250 lines) ✅
├── game/              (7 files, all <350 lines) ✅
├── materials/         (6 files, all <700 lines) ✅
├── objects/           (NEED TO CREATE) ⏳
├── effects/           (NEED TO CREATE) ⏳
├── adventure/         (NEED TO CREATE) ⏳
└── game-elements/     (old files to delete) 🧹
```

---

## 🎯 Next Actions for Swarm

### Immediate (Today)
1. **Task 5.1: Cleanup Old Files** - Delete migrated files after verification
2. **Task 2.10: Split GameObjects** - Create src/objects/ folder

### This Week
3. Task 2.11: Split Effects
4. Task 2.12: Split Adventure Mode
5. Task 5.2: Further reduce game.ts

### Verification Checklist (After Each Change)
- [ ] Game compiles without errors
- [ ] No console errors
- [ ] All features work (input, rendering, audio)
- [ ] File sizes under 1000 lines
- [ ] Imports use new paths

---

## Quick Status Commands

```bash
# Check game.ts progress
cd /root/pachinball
wc -l src/game.ts

# Check new folder structures
ls -la src/cabinet/ src/display/ src/game/ src/materials/

# Check what old files remain
ls -la src/game-elements/cabinet*.ts src/game-elements/display.ts 2>/dev/null

# Check imports (should use new paths)
grep -r "from.*cabinet" src/game.ts src/game-elements/*.ts
grep -r "from.*display" src/game.ts src/game-elements/*.ts
```
