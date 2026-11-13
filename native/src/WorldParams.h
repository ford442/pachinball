#pragma once

#include "MathTypes.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace pachinball {

/** Packed transform-buffer layout (16 floats per public-id slot). */
inline constexpr int TRANSFORM_STRIDE = 16;

/** `WorldParams::maxSubsteps` default, and its upper bound (see sanitizedMaxSubsteps). */
inline constexpr float DEFAULT_MAX_SUBSTEPS = 8.f;
inline constexpr float MAX_SUBSTEPS_LIMIT   = 64.f;

/**
 * The substep cap `step()` actually uses. `maxSubsteps` is a float — it is a
 * WorldParams field (Embind value_object) and is read back from snapshot
 * bytes — and casting NaN or ±inf to int is UB. NaN falls back to the
 * default; everything else is clamped to [1, 64], so a cap below 1 can no
 * longer freeze the world. The identity on every value in that range.
 */
inline float sanitizedMaxSubsteps(float maxSubsteps) {
  if (std::isnan(maxSubsteps)) return DEFAULT_MAX_SUBSTEPS;
  return std::min(std::max(maxSubsteps, 1.f), MAX_SUBSTEPS_LIMIT);
}

/**
 * A dynamic body found with a non-finite pose or velocity, or a rotation
 * that is no longer unit, and frozen
 * (PhysicsWorldStep.cpp, "Non-finite quarantine"): put back where its
 * substep started — the origin / identity if that pose was not finite
 * either — with zero velocity, asleep. The engine only freezes; what the
 * game does with the ball (stuck-ball rescue, score-neutral drain) is its call.
 */
struct NaNQuarantine {
  int      bodyId  = -1;
  uint64_t step    = 0;  ///< getStepCount() when its substep began (substeps since creation)
  int      substep = 0;  ///< That substep's index within its step() call
};

/** Per-world simulation parameters. */
struct WorldParams {
  Vec3  gravity          = {0.f, -9.81f, -5.0f};
  float fixedTimestep    = 1.f / 60.f;
  float maxSubsteps      = DEFAULT_MAX_SUBSTEPS;
  int   solverIterations = 4;
  float rollingResistance = 0.04f;
  float sleepLinearThreshold  = 0.05f;
  float sleepAngularThreshold = 0.1f;
  int   sleepFramesRequired   = 60;
};

/**
 * The most simulated time `step()` carries over between calls: one capped
 * tick, `fixedTimestep · ⌊sanitizedMaxSubsteps⌋`. After any `step()` the
 * accumulator is in [0, maxAccumulator], so `restore()` refuses a blob outside
 * it — a NaN accumulator froze the world and +inf ran every substep of every
 * tick (#520 row 8).
 */
inline float maxAccumulator(const WorldParams& p) {
  return p.fixedTimestep * static_cast<float>(static_cast<int>(sanitizedMaxSubsteps(p.maxSubsteps)));
}

/** Upper bound on `solverIterations` a snapshot may carry (CPU DoS guard). */
constexpr int MAX_SOLVER_ITERATIONS = 64;

/** True when every parameter is finite and in a range `step()` can run. */
inline bool worldParamsValid(const WorldParams& p) {
  const bool finiteG = std::isfinite(p.gravity.x) && std::isfinite(p.gravity.y) && std::isfinite(p.gravity.z);
  return finiteG &&
         std::isfinite(p.fixedTimestep) && p.fixedTimestep > 0.f && p.fixedTimestep <= 1.f &&
         !std::isnan(p.maxSubsteps) &&
         p.solverIterations >= 1 && p.solverIterations <= MAX_SOLVER_ITERATIONS &&
         std::isfinite(p.rollingResistance) && p.rollingResistance >= 0.f &&
         std::isfinite(p.sleepLinearThreshold) && p.sleepLinearThreshold >= 0.f &&
         std::isfinite(p.sleepAngularThreshold) && p.sleepAngularThreshold >= 0.f &&
         p.sleepFramesRequired >= 0;
}

} // namespace pachinball
