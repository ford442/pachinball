/**
 * Static cylinder + static sphere colliders: construction, broadphase
 * registration, and their sphere-vs-shape narrowphase.
 *
 * Split out of PhysicsWorld.cpp / Narrowphase.cpp to keep the dispatch file
 * under the #383 house line-count limit. All functions here are
 * PhysicsWorld methods — declared in PhysicsWorld.h, defined here.
 */
#include "CollisionFilter.h"
#include "ContactQueries.h"
#include "PhysicsWorld.h"
#include "SolverConstants.h"

#include <algorithm>
#include <cmath>

namespace pachinball {

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

  SurfaceHit hit;
  if (!querySphere(sph, body.getPosition(), body.getRadius(), hit)) return;
  const Vec3 normal = hit.normal;
  const float penetration = hit.penetration;

  const float velN = body.getVelocity().dot(normal);
  if (velN >= 0.5f) return;

  const float e = std::min(body.getRestitution(), sph.restitution);
  const Vec3 contactPoint = body.getPosition() - normal * body.getRadius();
  const float mu = std::sqrt(std::max(body.getFriction(), 0.f) * std::max(sph.friction, 0.f));
  const float j = applyContactImpulse(body, nullptr, contactPoint, normal, e, mu, penetration);

  constexpr float SLOP    = 0.001f;
  constexpr float CORRECT = 0.8f;
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
