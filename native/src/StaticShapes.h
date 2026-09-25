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

/**
 * Oriented static cone — local +Y is the axis, the apex sits at
 * +`halfHeight` and the base disc of `radius` at -`halfHeight`, exactly
 * Rapier's `ColliderDesc.cone(halfHeight, radius)`. Ball-trap funnels.
 *
 * Sphere-vs-cone is closed form (Cone.cpp): the solid is a triangle swept
 * around the axis, so the closest point is found in the (radial, axial)
 * half-plane through the sphere centre and lifted back to 3D.
 */
struct ConeDesc {
  Vec3     center      = Vec3::zero();
  float    radius      = 0.5f;
  float    halfHeight  = 0.5f;
  Quat     rotation    = Quat::identity();
  float    restitution = 0.4f;
  float    friction    = 0.2f;
  uint32_t membership  = COLLISION_GROUPS_ALL;
  uint32_t filter      = COLLISION_GROUPS_ALL;
};

/** Negative-id bases for the static shapes declared here. */
static constexpr int STATIC_CYLINDER_ID_BASE = -5000;
static constexpr int STATIC_SPHERE_ID_BASE   = -8000;
static constexpr int STATIC_CONE_ID_BASE     = -9000;

} // namespace pachinball
