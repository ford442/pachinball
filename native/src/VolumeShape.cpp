/**
 * Shape-tag dispatch for the volume colliders (kinematic movers, sensor
 * volumes). Keeps the mover and sensor resolvers written once against a
 * closest-point/deep-normal pair instead of once per shape.
 */
#include "VolumeShape.h"
#include "Cylinder.h"

#include <algorithm>
#include <cmath>

namespace pachinball {

Vec3 closestPointOnVolume(VolumeShape shape, const Vec3& local, const Vec3& halfExtents,
                          bool& outInside) {
  switch (shape) {
    case VolumeShape::Cylinder:
      return closestPointOnCylinder(local, halfExtents.x, halfExtents.y, outInside);

    case VolumeShape::Sphere: {
      const float radius = halfExtents.x;
      const float distSq = local.lengthSq();
      outInside = distSq < radius * radius;
      if (distSq < 1e-12f) return {radius, 0.f, 0.f};
      return local * (radius / std::sqrt(distSq));
    }

    case VolumeShape::Box:
    default: {
      const Vec3 clamped{
        std::clamp(local.x, -halfExtents.x, halfExtents.x),
        std::clamp(local.y, -halfExtents.y, halfExtents.y),
        std::clamp(local.z, -halfExtents.z, halfExtents.z),
      };
      outInside = std::fabs(local.x) < halfExtents.x &&
                  std::fabs(local.y) < halfExtents.y &&
                  std::fabs(local.z) < halfExtents.z;
      return clamped;
    }
  }
}

void deepestVolumeNormal(VolumeShape shape, const Vec3& local, const Vec3& halfExtents,
                         Vec3& outLocalNormal, float& outShallow) {
  switch (shape) {
    case VolumeShape::Cylinder:
      deepestCylinderNormal(local, halfExtents.x, halfExtents.y, outLocalNormal, outShallow);
      return;

    case VolumeShape::Sphere: {
      const float radius = halfExtents.x;
      const float dist = local.length();
      outShallow = radius - dist;
      outLocalNormal = dist > 1e-6f ? local / dist : Vec3{1.f, 0.f, 0.f};
      return;
    }

    case VolumeShape::Box:
    default: {
      const float dx = halfExtents.x - std::fabs(local.x);
      const float dy = halfExtents.y - std::fabs(local.y);
      const float dz = halfExtents.z - std::fabs(local.z);
      outLocalNormal = Vec3::up();
      outShallow = dy;
      if (dx < outShallow) { outShallow = dx; outLocalNormal = {local.x >= 0.f ? 1.f : -1.f, 0.f, 0.f}; }
      if (dz < outShallow) { outShallow = dz; outLocalNormal = {0.f, 0.f, local.z >= 0.f ? 1.f : -1.f}; }
      return;
    }
  }
}

} // namespace pachinball
