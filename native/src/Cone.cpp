/**
 * Static cone collider (#420): construction, broadphase registration and a
 * closed-form sphere-vs-cone narrowphase. Ball-trap funnels are Rapier cones
 * (`ColliderDesc.cone(halfHeight, radius)`); without this they never reached
 * the C++ world.
 *
 * The solid cone is the triangle (0, +h) apex, (R, -h) rim, (0, -h) base
 * centre swept around local +Y. Every point's nearest cone point lies in the
 * half-plane through the axis and that point, so the query runs in 2D —
 * (ρ, y) with ρ the distance from the axis — against the base segment and
 * the slant segment, then lifts the answer back along the point's radial
 * direction (queryCone, ContactQueries.cpp). All functions here are
 * PhysicsWorld methods (PhysicsWorld.h).
 */
#include "CollisionFilter.h"
#include "ContactQueries.h"
#include "PhysicsWorld.h"

#include <algorithm>
#include <cmath>

namespace pachinball {

int PhysicsWorld::addStaticCone(float px, float py, float pz,
                                float radius, float halfHeight,
                                float qx, float qy, float qz, float qw,
                                float restitution, float friction) {
  if (cones_.size() >= STATIC_HANDLE_CAPACITY) { ++droppedStatics_; return STATIC_HANDLE_OVERFLOW; }
  ConeDesc cone;
  cone.center = {px, py, pz};
  cone.radius = std::max(radius, 0.f);
  cone.halfHeight = std::max(halfHeight, 0.f);
  cone.rotation = Quat{qx, qy, qz, qw}.normalized();
  cone.restitution = restitution;
  cone.friction = friction;
  cones_.push_back(cone);
  const int idx = static_cast<int>(cones_.size()) - 1;
  broadphase_.insertStaticCone(idx, cone);
  return STATIC_CONE_ID_BASE - idx;
}

void PhysicsWorld::resolveSphereVsCone(BodyView& body, const ConeDesc& cone, int coneId) {
  if (!groupsInteract(body.getMembership(), body.getFilter(), cone.membership, cone.filter)) return;

  const float radius = body.getRadius();
  SurfaceHit hit;
  if (!queryCone(cone, body.getPosition(), radius, hit)) return;
  const Vec3 normal = hit.normal;
  const float penetration = hit.penetration;

  const float velN = body.getVelocity().dot(normal);
  if (velN >= 0.5f) return;

  const float e = std::min(body.getRestitution(), cone.restitution);
  const Vec3 contactPoint = body.getPosition() - normal * radius;
  const float mu = std::sqrt(std::max(body.getFriction(), 0.f) * std::max(cone.friction, 0.f));
  const float j = applyContactImpulse(body, nullptr, contactPoint, normal, e, mu, penetration);

  constexpr float SLOP    = 0.001f;
  constexpr float CORRECT = 0.8f;
  if (penetration > SLOP && body.getType() == BodyType::Dynamic) {
    body.setPosition(body.getPosition() + normal * ((penetration - SLOP) * CORRECT));
  }

  ContactEvent evt;
  evt.bodyId1 = body.getId();
  evt.bodyId2 = coneId;
  evt.normal  = normal;
  evt.point   = contactPoint;
  evt.impulse = j;
  contactListener_.pushContact(evt);
}

} // namespace pachinball
