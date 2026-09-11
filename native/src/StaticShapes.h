#pragma once

#include "CollisionFilter.h"
#include "MathTypes.h"

#include <cstdint>

namespace pachinball {

/**
 * Oriented static cylinder collider (local Y is the axis, matching the
 * capsule convention and Rapier's `ColliderDesc.cylinder(halfHeight, radius)`).
 *
 * Sphere-vs-cylinder is closed form — see resolveSphereVsCylinder() in
 * StaticShapes.cpp — covering the curved side, the two flat end caps, and
 * the rim circle where they meet.
 */
struct CylinderDesc {
  Vec3     center      = Vec3::zero();
  float    radius      = 0.5f;
  float    halfHeight  = 0.5f;
  Quat     rotation    = Quat::identity();
  float    restitution = 0.4f;
  float    friction    = 0.2f;
  uint32_t membership  = COLLISION_GROUPS_ALL;
  uint32_t filter      = COLLISION_GROUPS_ALL;
};

/** Static sphere collider (rotation-free). */
struct SphereDesc {
  Vec3     center      = Vec3::zero();
  float    radius      = 0.5f;
  float    restitution = 0.4f;
  float    friction    = 0.2f;
  uint32_t membership  = COLLISION_GROUPS_ALL;
  uint32_t filter      = COLLISION_GROUPS_ALL;
};

/** Negative-id bases for the static shapes declared here. */
static constexpr int STATIC_CYLINDER_ID_BASE = -5000;
static constexpr int STATIC_SPHERE_ID_BASE   = -6000;

} // namespace pachinball
