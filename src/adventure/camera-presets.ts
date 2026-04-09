/**
 * Camera Presets for Adventure Mode Tracks
 * 
 * Track-specific camera configurations for optimal visibility and cinematic feel.
 */

import type { CameraPreset } from './adventure-types'

/**
 * Camera preset configuration for adventure mode tracks.
 * Defines all camera parameters for track-specific visibility and cinematic feel.
 */
export const CAMERA_PRESETS: Record<string, CameraPreset> = {
  /** NEON_HELIX: Balanced isometric view for the classic helix descent */
  NEON_HELIX: {
    alpha: -Math.PI / 2,
    beta: 0.96, // 55°
    radius: 16,
    fov: 0.75,
    lookAheadTime: 0.35,
    trackingSmoothing: 7.0,
    speedRadiusFactor: 0.25,
    speedFOVFactor: 0.008,
    maxRadiusExtension: 8,
    minBeta: 0.7,
    maxBeta: 1.22,
    minRadius: 10,
    maxRadius: 35,
  },
  /** CYBER_CORE: Steeper angle for vertical descent sections */
  CYBER_CORE: {
    alpha: -Math.PI / 2,
    beta: 1.13, // 65°
    radius: 14,
    fov: 0.8,
    lookAheadTime: 0.25,
    trackingSmoothing: 9.0,
    speedRadiusFactor: 0.35,
    speedFOVFactor: 0.012,
    maxRadiusExtension: 10,
    minBeta: 0.87,
    maxBeta: 1.31,
    minRadius: 10,
    maxRadius: 35,
  },
  /** QUANTUM_GRID: Wider FOV for maze navigation */
  QUANTUM_GRID: {
    alpha: -Math.PI / 2,
    beta: 1.22, // 70°
    radius: 18,
    fov: 0.85,
    lookAheadTime: 0.4,
    trackingSmoothing: 6.0,
    speedRadiusFactor: 0.15,
    speedFOVFactor: 0.005,
    maxRadiusExtension: 4,
    minBeta: 1.05,
    maxBeta: 1.4,
    minRadius: 14,
    maxRadius: 35,
  },
  /** SINGULARITY_WELL: Tighter view for gravitational challenge */
  SINGULARITY_WELL: {
    alpha: -Math.PI / 2,
    beta: 1.05, // 60°
    radius: 15,
    fov: 0.78,
    lookAheadTime: 0.3,
    trackingSmoothing: 8.0,
    speedRadiusFactor: 0.3,
    speedFOVFactor: 0.01,
    maxRadiusExtension: 6,
    minBeta: 0.79,
    maxBeta: 1.31,
    minRadius: 10,
    maxRadius: 35,
  },
  /** GLITCH_SPIRE: Dynamic view for chaotic environment */
  GLITCH_SPIRE: {
    alpha: -Math.PI / 2,
    beta: 1.0, // 57°
    radius: 17,
    fov: 0.82,
    lookAheadTime: 0.32,
    trackingSmoothing: 7.5,
    speedRadiusFactor: 0.28,
    speedFOVFactor: 0.009,
    maxRadiusExtension: 7,
    minBeta: 0.75,
    maxBeta: 1.26,
    minRadius: 11,
    maxRadius: 35,
  },
  /** PACHINKO_SPIRE: Top-down view for vertical pachinko board */
  PACHINKO_SPIRE: {
    alpha: -Math.PI / 2,
    beta: 1.26, // 72°
    radius: 20,
    fov: 0.9,
    lookAheadTime: 0.2,
    trackingSmoothing: 10.0,
    speedRadiusFactor: 0.1,
    speedFOVFactor: 0.003,
    maxRadiusExtension: 5,
    minBeta: 1.13,
    maxBeta: 1.45,
    minRadius: 15,
    maxRadius: 40,
  },
  /** DEFAULT: Fallback preset for tracks without specific tuning */
  DEFAULT: {
    alpha: -Math.PI / 2,
    beta: Math.PI / 3,
    radius: 14,
    fov: 0.8,
    lookAheadTime: 0.3,
    trackingSmoothing: 7.0,
    speedRadiusFactor: 0.2,
    speedFOVFactor: 0.01,
    maxRadiusExtension: 8,
    minBeta: 0.5,
    maxBeta: 1.3,
    minRadius: 8,
    maxRadius: 35,
  },
}
