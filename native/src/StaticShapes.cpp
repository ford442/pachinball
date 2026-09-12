/**
 * Static cylinder + static sphere colliders: construction, broadphase
 * registration, and their sphere-vs-shape narrowphase.
 *
 * Split out of PhysicsWorld.cpp / Narrowphase.cpp to keep the dispatch file
 * under the #383 house line-count limit. All functions here are
 * PhysicsWorld methods — declared in PhysicsWorld.h, defined here.
 */
#include "CollisionFilter.h"
#include "PhysicsWorld.h"

#include <algorithm>
#include <cmath>

namespace pachinball {

namespace {
constexpr float CONTACT_EPSILON_SQ = 1e-10f;
constexpr float SLOP    = 0.001f;
constexpr float CORRECT = 0.8f;
} // namespace

int PhysicsWorld::addStaticSphere(float px, float py, float pz,
                                  float radius,
                                  float restitution, float friction) {
  if (spheres_.size() >= STATIC_HANDLE_CAPACITY) { ++droppedStatics_; return STATIC_HANDLE_OVERFLOW; }
  SphereDesc sph;
  sph.center = {px, py, pz};
  sph.radius = radius;
  sph.restitution = restitution;
  sph.friction = friction;
  spheres_.push_back(sph);
  const int idx = static_cast<int>(spheres_.size()) - 1;
  broadphase_.insertStaticSphere(idx, sph);
  return STATIC_SPHERE_ID_BASE - idx;
}

void PhysicsWorld::resolveSphereVsStaticSphere(BodyView& body, const SphereDesc& sph, int sphId) {
  if (!groupsInteract(body.getMembership(), body.getFilter(), sph.membership, sph.filter)) return;

  const Vec3 delta = body.getPosition() - sph.center;
  const float distSq = delta.lengthSq();
  const float minDist = body.getRadius() + sph.radius;
  if (distSq >= minDist * minDist) return;

  const float dist = std::sqrt(std::max(distSq, CONTACT_EPSILON_SQ));
  const Vec3 normal = (dist > 1e-5f) ? (delta / dist) : Vec3::up();
  const float penetration = minDist - dist;

  const float velN = body.getVelocity().dot(normal);
  if (velN >= 0.5f) return;

  const float e = std::min(body.getRestitution(), sph.restitution);
  const Vec3 contactPoint = body.getPosition() - normal * body.getRadius();
  const float mu = std::sqrt(std::max(body.getFriction(), 0.f) * std::max(sph.friction, 0.f));
  const float j = applyContactImpulse(body, nullptr, contactPoint, normal, e, mu, penetration);

  if (penetration > SLOP && body.getType() == BodyType::Dynamic) {
    body.setPosition(body.getPosition() + normal * ((penetration - SLOP) * CORRECT));
  }

  ContactEvent evt;
  evt.bodyId1 = body.getId();
  evt.bodyId2 = sphId;
  evt.normal  = normal;
  evt.point   = body.getPosition() - normal * body.getRadius();
  evt.impulse = j;
  contactListener_.pushContact(evt);
}

} // namespace pachinball
