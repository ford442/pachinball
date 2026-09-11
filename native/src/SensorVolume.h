#pragma once

#include "CollisionFilter.h"
#include "MathTypes.h"
#include "VolumeShape.h"

#include <cstdint>

namespace pachinball {

/**
 * Static trigger volume — box, cylinder or sphere per its shape tag. Produces Enter/Stay/Exit contact
 * events (via the existing packed contact buffer, `isSensor` bit set) but
 * never applies impulse or positional correction — it is purely a spatial
 * query, riding the same broadphase + contact-listener pipeline as solid
 * shapes.
 */
struct SensorVolumeDesc {
  Vec3        center    = Vec3::zero();
  VolumeShape shape     = VolumeShape::Box;
  /** Read per `shape` — see VolumeShape. Goals and portals are boxes; catch radii are spheres. */
  Vec3     halfExtents  = {0.5f, 0.5f, 0.5f};
  Quat     rotation     = Quat::identity();
  uint32_t membership   = COLLISION_GROUPS_ALL;
  uint32_t filter       = COLLISION_GROUPS_ALL;
};

/** Negative-id base for sensor volumes in contact events / setCollisionGroups. */
static constexpr int SENSOR_VOLUME_ID_BASE = -4000;

} // namespace pachinball
