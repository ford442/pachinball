# grok.md — Grok AI Assistant Guide for pachinball

> **Read this first.** Tailored instructions for Grok when working on this repo.

## Project Overview
**pachinball** is a proof-of-concept 3D hybrid game blending Japanese Pachinko mechanics with American Pinball physics and scoring. Built as a WebGPU-first experience using Babylon.js scene with Rapier 3D WASM physics.

- **Core Idea**: Drop a ball, flip paddles with Left Shift / Right Shift, charge and release the plunger with Space or Enter, hit bumpers for points, reset with R.
- **Tech Focus**: Real-time 3D physics + rendering in browser, Vite + TypeScript.
- **Live Demo**: https://test.1ink.us/pachinball/index.html

## Technology Stack
- **Build**: Vite (vanilla TypeScript template)
- **Rendering**: Babylon.js (core)
- **Physics**: Rapier 3D WASM (`@dimforge/rapier3d-compat`)
- **Language**: TypeScript
- **No React** — pure vanilla + modern 3D libs

## Key Files
- `index.html` / `src/main.ts` (or similar entry)
- Physics setup in Babylon scene
- Input handling for paddle flip and reset
- Scoring and ball reset logic

## Development
```bash
npm install
npm run dev
```
Open http://localhost:5173/. Use **Left Shift** / **Right Shift** for the flippers, hold **Space** or **Enter** to charge and release the plunger, and press **R** to reset.

## Grok Guidelines
- **Be helpful with 3D/WebGPU/Physics**: Suggest optimizations for Rapier integration, Babylon.js best practices, performance tweaks for smooth 60fps gameplay.
- **Gameplay Balance**: When proposing changes, consider fun factor — e.g., bumper scoring, ball speed, paddle responsiveness.
- **Keep it lightweight**: This is a PoC; avoid over-engineering unless asked. Prefer simple, performant solutions.
- **WebGPU-first**: Leverage modern APIs; fallback gracefully if needed.
- **Testing**: Manual browser testing on Chrome/Edge with WebGPU enabled. Check physics stability and input responsiveness.
- **Deployment**: Hosted on 1ink.us; changes via push to main deploy automatically or per your workflow.

## Common Tasks for Grok
- Add new bumpers, obstacles, or levels
- Improve physics tuning or visuals (lights, materials, particles)
- Debug collision or scoring issues
- Enhance controls or add sound
- Optimize for mobile or lower-end devices

Enjoy building this pachinko-pinball hybrid! Let's make it addictive and visually striking. 🚀
