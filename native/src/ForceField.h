#pragma once

#include "CollisionFilter.h"
#include "MathTypes.h"

#include <cstdint>

namespace pachinball {

/** How a force field's vector is interpreted. */
enum class ForceSpace : uint8_t {
  World = 0, ///< The vector is already in world space.
  Local = 1, ///< The vector is in the field's own frame, rotated by its orientation.
};

/** What a field does to a body inside its region. */
enum class ForceMode : uint8_t {
  Directional = 0, ///< Pushes along the constant `force` vector (updraft, conveyor).
  AxisPull    = 1, ///< Pulls toward the field's own Y axis (a magnetic well); see below.
};

/**
 * An oriented box region that pushes on every body inside it — updraft
 * shafts, solar wind, conveyor belts. Replaces the ad-hoc per-tick impulse
 * loops the TS side ran against Rapier bodies, so the behaviour moves into
 * the deterministic fixed-step integration alongside gravity.
 *
 * `acceleration` selects the mass-independent form: when true the vector is
 * an acceleration in m/s² (a light ball and a heavy one drift alike, which is
 * what an updraft should do), when false it is a force in newtons.
 *
 * `mode == AxisPull` turns the region into a vertical cylinder instead:
 * `halfExtents.x` is its radius and `halfExtents.y` its half-height (z is
 * unused), along the field's local Y axis. A body inside is pulled
 * horizontally toward that axis with magnitude `strength * (1 - d / radius)`
 * — full at the axis, nothing at the rim — so a ball is drawn into a well
 * without any vertical push. `force` and `space` are ignored in this mode.
 * Only Dynamic bodies feel either mode: a captured (kinematic) ball is
 * steered, not pulled.
 */
struct ForceFieldDesc {
  Vec3       center      = Vec3::zero();
  Vec3       halfExtents = {1.f, 1.f, 1.f};
  Quat       rotation    = Quat::identity();
  Vec3       force       = Vec3::zero();
  ForceSpace space       = ForceSpace::World;
  bool       acceleration = false;
  bool       enabled      = true;
  ForceMode  mode         = ForceMode::Directional;
  float      strength     = 0.f; ///< AxisPull: pull at the axis (m/s² or N, per `acceleration`).
  uint32_t   membership  = COLLISION_GROUPS_ALL;
  uint32_t   filter      = COLLISION_GROUPS_ALL;
};

/** Negative-id base for force fields in setCollisionGroups / setForceFieldEnabled. */
static constexpr int FORCE_FIELD_ID_BASE = -7000;

} // namespace pachinball
