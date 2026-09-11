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

/**
 * An oriented box region that pushes on every body inside it — updraft
 * shafts, solar wind, conveyor belts. Replaces the ad-hoc per-tick impulse
 * loops the TS side ran against Rapier bodies, so the behaviour moves into
 * the deterministic fixed-step integration alongside gravity.
 *
 * `acceleration` selects the mass-independent form: when true the vector is
 * an acceleration in m/s² (a light ball and a heavy one drift alike, which is
 * what an updraft should do), when false it is a force in newtons.
 */
struct ForceFieldDesc {
  Vec3       center      = Vec3::zero();
  Vec3       halfExtents = {1.f, 1.f, 1.f};
  Quat       rotation    = Quat::identity();
  Vec3       force       = Vec3::zero();
  ForceSpace space       = ForceSpace::World;
  bool       acceleration = false;
  bool       enabled      = true;
  uint32_t   membership  = COLLISION_GROUPS_ALL;
  uint32_t   filter      = COLLISION_GROUPS_ALL;
};

/** Negative-id base for force fields in setCollisionGroups / setForceFieldEnabled. */
static constexpr int FORCE_FIELD_ID_BASE = -7000;

} // namespace pachinball
