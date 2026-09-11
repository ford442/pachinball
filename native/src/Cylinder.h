#pragma once

#include "StaticShapes.h"

namespace pachinball {

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
