#include "SensorVolume.h"
#include "CollisionFilter.h"
#include "PhysicsWorld.h"
#include "VolumeShape.h"

#include <algorithm>
#include <cmath>

namespace pachinball {

static constexpr float SENSOR_EPSILON_SQ = 1e-10f;

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
  emitSensorOverlap(body, sensorIndex, body.getPosition());
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
