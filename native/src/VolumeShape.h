#pragma once

#include "MathTypes.h"

#include <cstdint>

namespace pachinball {

/**
 * Shape tag shared by the volume-like colliders — kinematic movers and
 * sensor volumes — so a single desc/storage struct can describe a box, a
 * cylinder or a sphere without a separate vector per combination.
 *
 * Every volume carries `halfExtents` regardless of tag; the tag decides how
 * those three floats are read:
 *
 *   Box      — (hx, hy, hz) half-extents, local axes.
 *   Cylinder — (radius, halfHeight, radius), segment along local +Y.
 *              Matches Rapier's `ColliderDesc.cylinder(halfHeight, radius)`.
 *   Sphere   — (radius, radius, radius); rotation is irrelevant.
 *
 * Keeping the bounding half-extents populated for every tag lets
 * BroadphaseGrid::cellsForObb stay shape-agnostic: its circumscribing-radius
 * bound is conservative for all three.
 */
enum class VolumeShape : uint8_t {
  Box      = 0,
  Cylinder = 1,
  Sphere   = 2,
};

/**
 * Closest point on a volume (centred at the origin in its own local frame) to
 * a local-space point, plus whether that point lies strictly inside.
 * Dispatches on the shape tag; `halfExtents` is read per the convention
 * documented on VolumeShape above.
 */
Vec3 closestPointOnVolume(VolumeShape shape, const Vec3& local, const Vec3& halfExtents,
                          bool& outInside);

/**
 * Contact normal + depth for a local-space point known to be inside a volume,
 * choosing the shallowest exit direction. Mirrors the deep-contact fallback
 * the box path has always used, generalized across the shape tags.
 */
void deepestVolumeNormal(VolumeShape shape, const Vec3& local, const Vec3& halfExtents,
                         Vec3& outLocalNormal, float& outShallow);

} // namespace pachinball
