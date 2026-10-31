#include "SensorVolume.h"
#include "CollisionFilter.h"
#include "PhysicsWorld.h"
#include "VolumeShape.h"

#include <algorithm>
#include <cmath>

namespace pachinball {

static constexpr float SENSOR_EPSILON_SQ = 1e-10f;

/** Ternary-search rounds: (2/3)^24 of the segment, far below any sensor thickness. */
static constexpr int SENSOR_SWEEP_ITERATIONS = 24;

namespace {

/** Distance from a volume-local point to the volume; zero inside. */
float distanceToVolume(const SensorVolumeDesc& sensor, const Vec3& local) {
  bool inside = false;
  const Vec3 closest = closestPointOnVolume(sensor.shape, local, sensor.halfExtents, inside);
  return inside ? 0.f : (local - closest).length();
}

/** True when a sphere of `radius` at world-space `point` touches the sensor volume. */
bool sphereTouchesSensor(const SensorVolumeDesc& sensor, const Vec3& point, float radius) {
  const Vec3 local = sensor.rotation.conjugate().rotate(point - sensor.center);
  bool inside = false;
  const Vec3 closest = closestPointOnVolume(sensor.shape, local, sensor.halfExtents, inside);
  return inside || (local - closest).lengthSq() < radius * radius;
}

/**
 * Point of the segment `from`→`to` nearest the volume. Distance to a convex set
 * is convex along a line, so a ternary search finds the minimum for every
 * shape tag without a per-shape sweep.
 */
Vec3 nearestApproach(const SensorVolumeDesc& sensor, const Vec3& from, const Vec3& to) {
  const Quat inv = sensor.rotation.conjugate();
  const Vec3 a = inv.rotate(from - sensor.center);
  const Vec3 b = inv.rotate(to - sensor.center);
  float lo = 0.f;
  float hi = 1.f;
  for (int i = 0; i < SENSOR_SWEEP_ITERATIONS; ++i) {
    const float third = (hi - lo) / 3.f;
    const float m1 = lo + third;
    const float m2 = hi - third;
    if (distanceToVolume(sensor, a + (b - a) * m1) < distanceToVolume(sensor, a + (b - a) * m2)) {
      hi = m2;
    } else {
      lo = m1;
    }
  }
  return from + (to - from) * (0.5f * (lo + hi));
}

} // namespace

void PhysicsWorld::capturePreviousPositions() {
  const int count = bodies_.denseCount();
  prevPositions_.resize(static_cast<std::size_t>(count));
  for (int i = 0; i < count; ++i) {
    prevPositions_[static_cast<std::size_t>(i)] = {bodies_.posX(i), bodies_.posY(i), bodies_.posZ(i)};
  }
}

/**
 * Overlap test only — no contact normal/penetration solve is needed since
 * sensors never apply impulse or positional correction. Enter/Stay/Exit
 * lifecycle is handled entirely by ContactListener's existing pair-presence
 * bookkeeping (see PhysicsWorld::substep dispatch).
 *
 * `queryPoint` is the body point nearest the volume: a sphere's centre, or
 * the closest point on a capsule's segment. Both shapes then reduce to the
 * same point-vs-volume test inflated by the body radius.
 */
void PhysicsWorld::emitSensorOverlap(BodyView& body, int sensorIndex, const Vec3& queryPoint) {
  const SensorVolumeDesc& sensor = sensors_[static_cast<std::size_t>(sensorIndex)];

  const Quat invRot = sensor.rotation.conjugate();
  const Vec3 localPoint = invRot.rotate(queryPoint - sensor.center);

  bool inside = false;
  const Vec3 closest = closestPointOnVolume(sensor.shape, localPoint, sensor.halfExtents, inside);

  const Vec3 delta = localPoint - closest;
  const float distSq = delta.lengthSq();
  const float radius = body.getRadius();
  if (!inside && distSq >= radius * radius) return;

  Vec3 localNormal;
  if (inside || distSq < SENSOR_EPSILON_SQ) {
    float shallow;
    deepestVolumeNormal(sensor.shape, localPoint, sensor.halfExtents, localNormal, shallow);
  } else {
    localNormal = delta / std::sqrt(distSq);
  }
  const Vec3 normal = sensor.rotation.rotate(localNormal).normalized();

  ContactEvent evt;
  evt.bodyId1 = body.getId();
  evt.bodyId2 = SENSOR_VOLUME_ID_BASE - sensorIndex;
  evt.normal  = normal;
  evt.point   = queryPoint - normal * radius;
  evt.impulse = 0.f;
  evt.isSensor = true;
  contactListener_.pushContact(evt);
}

void PhysicsWorld::resolveSphereVsSensor(BodyView& body, int sensorIndex) {
  const SensorVolumeDesc& sensor = sensors_[static_cast<std::size_t>(sensorIndex)];
  if (!groupsInteract(body.getMembership(), body.getFilter(), sensor.membership, sensor.filter)) return;

  Vec3 queryPoint = body.getPosition();
  const std::size_t dense = static_cast<std::size_t>(body.denseIndex());
  if (dense < prevPositions_.size() &&
      !sphereTouchesSensor(sensor, queryPoint, body.getRadius())) {
    // Not touching where the substep ended: it may still have crossed the volume
    // on the way. Test the nearest point of the travelled segment instead.
    const Vec3 from = prevPositions_[dense];
    const float travelSq = (queryPoint - from).lengthSq();
    if (travelSq >= SENSOR_SWEEP_MIN_DISTANCE * SENSOR_SWEEP_MIN_DISTANCE &&
        travelSq <= SENSOR_SWEEP_MAX_DISTANCE * SENSOR_SWEEP_MAX_DISTANCE) {
      // Cheap reject first: a segment that never nears the volume's bounding sphere.
      const Vec3 nearCenter = closestPointOnSegment(sensor.center, from, queryPoint);
      const float reach = sensor.halfExtents.length() + body.getRadius();
      if ((nearCenter - sensor.center).lengthSq() <= reach * reach) {
        queryPoint = nearestApproach(sensor, from, queryPoint);
      }
    }
  }
  emitSensorOverlap(body, sensorIndex, queryPoint);
}

void PhysicsWorld::resolveCapsuleVsSensor(BodyView& body, int sensorIndex) {
  const SensorVolumeDesc& sensor = sensors_[static_cast<std::size_t>(sensorIndex)];
  if (!groupsInteract(body.getMembership(), body.getFilter(), sensor.membership, sensor.filter)) return;

  const Vec3 axisHalf = body.getRotation().rotate(Vec3{0.f, body.getCapsuleHalfHeight(), 0.f});
  const Vec3 segA = body.getPosition() - axisHalf;
  const Vec3 segB = body.getPosition() + axisHalf;

  // Alternating projection: find the point on the capsule's segment nearest
  // the volume, then test that point. Two iterations is ample for a convex
  // volume and keeps a long flipper blade from missing a shallow trigger.
  Vec3 probe = sensor.center;
  for (int iter = 0; iter < 3; ++iter) {
    const Vec3 segPt = closestPointOnSegment(probe, segA, segB);
    bool inside = false;
    const Vec3 localPt = sensor.rotation.conjugate().rotate(segPt - sensor.center);
    probe = sensor.rotation.rotate(
              closestPointOnVolume(sensor.shape, localPt, sensor.halfExtents, inside)) + sensor.center;
  }
  emitSensorOverlap(body, sensorIndex, closestPointOnSegment(probe, segA, segB));
}

} // namespace pachinball
