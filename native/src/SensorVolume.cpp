#include "SensorVolume.h"
#include "CollisionFilter.h"
#include "PhysicsWorld.h"

#include <algorithm>
#include <cmath>

namespace pachinball {

static constexpr float SENSOR_EPSILON_SQ = 1e-10f;

/**
 * Sphere-vs-OBB overlap test only — no contact normal/penetration solve
 * needed since sensors never apply impulse or positional correction. Enter/
 * Stay/Exit lifecycle is handled entirely by ContactListener's existing
 * pair-presence bookkeeping (see PhysicsWorld::substep dispatch).
 */
void PhysicsWorld::resolveSphereVsSensor(BodyView& body, int sensorIndex) {
  const SensorVolumeDesc& sensor = sensors_[static_cast<std::size_t>(sensorIndex)];
  if (!groupsInteract(body.getMembership(), body.getFilter(), sensor.membership, sensor.filter)) return;

  const Quat invRot = sensor.rotation.conjugate();
  const Vec3 localCenter = invRot.rotate(body.getPosition() - sensor.center);

  const Vec3 closest{
    std::clamp(localCenter.x, -sensor.halfExtents.x, sensor.halfExtents.x),
    std::clamp(localCenter.y, -sensor.halfExtents.y, sensor.halfExtents.y),
    std::clamp(localCenter.z, -sensor.halfExtents.z, sensor.halfExtents.z),
  };

  const Vec3 delta = localCenter - closest;
  const float distSq = delta.lengthSq();
  const float radius = body.getRadius();
  if (distSq >= radius * radius) return;

  Vec3 localNormal;
  if (distSq < SENSOR_EPSILON_SQ) {
    localNormal = Vec3::up();
  } else {
    const float dist = std::sqrt(distSq);
    localNormal = delta / dist;
  }
  const Vec3 normal = sensor.rotation.rotate(localNormal).normalized();

  ContactEvent evt;
  evt.bodyId1 = body.getId();
  evt.bodyId2 = SENSOR_VOLUME_ID_BASE - sensorIndex;
  evt.normal  = normal;
  evt.point   = body.getPosition() - normal * radius;
  evt.impulse = 0.f;
  evt.isSensor = true;
  contactListener_.pushContact(evt);
}

} // namespace pachinball
