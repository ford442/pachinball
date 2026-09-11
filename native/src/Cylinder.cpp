/**
 * Analytic sphere-vs-finite-cylinder narrowphase plus the shared local-space
 * cylinder helpers used by both the static-cylinder resolver here and the
 * kinematic-cylinder mover in KinematicMover.cpp.
 */
#include "Cylinder.h"
#include "CollisionFilter.h"
#include "PhysicsWorld.h"

#include <algorithm>
#include <cmath>

namespace pachinball {

static constexpr float CYLINDER_EPSILON_SQ = 1e-10f;

Vec3 closestPointOnCylinder(const Vec3& local, float radius, float halfHeight, bool& outInside) {
  const float rhoSq = local.x * local.x + local.z * local.z;
  const float clampedY = std::clamp(local.y, -halfHeight, halfHeight);

  if (rhoSq <= radius * radius) {
    // Within the radial extent: only the caps can clip the point.
    outInside = (rhoSq < radius * radius) && (std::fabs(local.y) < halfHeight);
    return {local.x, clampedY, local.z};
  }

  outInside = false;
  const float rho = std::sqrt(rhoSq);
  const float scale = radius / rho;
  return {local.x * scale, clampedY, local.z * scale};
}

void deepestCylinderNormal(const Vec3& local, float radius, float halfHeight,
                           Vec3& outLocalNormal, float& outShallow) {
  const float rho = std::sqrt(local.x * local.x + local.z * local.z);
  const float radialDepth = radius - rho;
  const float capDepth    = halfHeight - std::fabs(local.y);

  if (capDepth < radialDepth) {
    outLocalNormal = {0.f, local.y >= 0.f ? 1.f : -1.f, 0.f};
    outShallow = capDepth;
    return;
  }

  if (rho > 1e-6f) {
    outLocalNormal = {local.x / rho, 0.f, local.z / rho};
  } else {
    // Dead on the axis — any radial direction is equally valid; pick +X so
    // the choice stays deterministic across runs.
    outLocalNormal = {1.f, 0.f, 0.f};
  }
  outShallow = radialDepth;
}

int PhysicsWorld::addStaticCylinder(float px, float py, float pz,
                                    float radius, float halfHeight,
                                    float qx, float qy, float qz, float qw,
                                    float restitution, float friction) {
  CylinderDesc cyl;
  cyl.center = {px, py, pz};
  cyl.radius = radius;
  cyl.halfHeight = halfHeight;
  cyl.rotation = {qx, qy, qz, qw};
  cyl.restitution = restitution;
  cyl.friction = friction;
  cylinders_.push_back(cyl);
  const int idx = static_cast<int>(cylinders_.size()) - 1;
  broadphase_.insertStaticCylinder(idx, cyl);
  return STATIC_CYLINDER_ID_BASE - idx;
}

void PhysicsWorld::resolveSphereVsCylinder(BodyView& body, const CylinderDesc& cyl, int cylId) {
  if (!groupsInteract(body.getMembership(), body.getFilter(), cyl.membership, cyl.filter)) return;

  const Quat invRot = cyl.rotation.conjugate();
  const Vec3 localCenter = invRot.rotate(body.getPosition() - cyl.center);

  bool inside = false;
  const Vec3 closest = closestPointOnCylinder(localCenter, cyl.radius, cyl.halfHeight, inside);

  const Vec3 delta = localCenter - closest;
  const float distSq = delta.lengthSq();
  const float radius = body.getRadius();
  if (!inside && distSq >= radius * radius) return;

  Vec3 localNormal;
  float penetration;
  if (inside || distSq < CYLINDER_EPSILON_SQ) {
    float shallow;
    deepestCylinderNormal(localCenter, cyl.radius, cyl.halfHeight, localNormal, shallow);
    penetration = radius + shallow;
  } else {
    const float dist = std::sqrt(distSq);
    localNormal = delta / dist;
    penetration = radius - dist;
  }

  const Vec3 normal = cyl.rotation.rotate(localNormal).normalized();

  const float velN = body.getVelocity().dot(normal);
  if (velN >= 0.5f) return;

  const float e = std::min(body.getRestitution(), cyl.restitution);
  const Vec3 contactPoint = body.getPosition() - normal * radius;
  const float mu = std::sqrt(std::max(body.getFriction(), 0.f) * std::max(cyl.friction, 0.f));
  const float j = applyContactImpulse(body, nullptr, contactPoint, normal, e, mu, penetration);

  constexpr float SLOP    = 0.001f;
  constexpr float CORRECT = 0.8f;
  if (penetration > SLOP && body.getType() == BodyType::Dynamic) {
    body.setPosition(body.getPosition() + normal * ((penetration - SLOP) * CORRECT));
  }

  ContactEvent evt;
  evt.bodyId1 = body.getId();
  evt.bodyId2 = cylId;
  evt.normal  = normal;
  evt.point   = contactPoint;
  evt.impulse = j;
  contactListener_.pushContact(evt);
}

} // namespace pachinball
