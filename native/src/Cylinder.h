#pragma once

#include "CollisionFilter.h"
#include "MathTypes.h"

#include <cstdint>

namespace pachinball {

/**
 * Oriented static cylinder collider — the analytic counterpart to Rapier's
 * `ColliderDesc.cylinder(halfHeight, radius)`, with the segment along local
 * +Y. Adventure pin fields, arc pylons and chroma gates are all built from
 * these; they stay analytic rather than tessellated so ball rebounds off a
 * pin keep their exact round profile and remain deterministic.
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

/** Negative-id base for static cylinders in contact events / setCollisionGroups. */
static constexpr int STATIC_CYLINDER_ID_BASE = -5000;

/**
 * Closest point on a finite cylinder (centred at the origin, axis along +Y,
 * given by `radius`/`halfHeight`) to a local-space point, plus whether that
 * point lies strictly inside the cylinder.
 *
 * Shared by the static-cylinder resolver and the kinematic-cylinder mover so
 * both agree exactly on contact geometry across the three surface regions:
 * the radial wall, the two cap discs, and the cap rim circle joining them.
 */
Vec3 closestPointOnCylinder(const Vec3& local, float radius, float halfHeight, bool& outInside);

/**
 * Contact normal + penetration depth for a point known to be inside a
 * cylinder — picks whichever of the radial wall or the nearer cap is the
 * shallower exit, mirroring `deepestFaceNormal` for boxes.
 */
void deepestCylinderNormal(const Vec3& local, float radius, float halfHeight,
                           Vec3& outLocalNormal, float& outShallow);

} // namespace pachinball
