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

int PhysicsWorld::addStaticCylinder(float px, float py, float pz,
                                    float radius, float halfHeight,
                                    float qx, float qy, float qz, float qw,
                                    float restitution, float friction) {
  CylinderDesc cyl;
  cyl.center = {px, py, pz};
  cyl.radius = radius;
  cyl.halfHeight = halfHeight;
  cyl.rotation = Quat{qx, qy, qz, qw}.normalized();
  cyl.restitution = restitution;
  cyl.friction = friction;
  cylinders_.push_back(cyl);
  const int idx = static_cast<int>(cylinders_.size()) - 1;
  broadphase_.insertStaticCylinder(idx, cyl);
  return STATIC_CYLINDER_ID_BASE - idx;
}

int PhysicsWorld::addStaticSphere(float px, float py, float pz,
                                  float radius,
                                  float restitution, float friction) {
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

void PhysicsWorld::clearStaticGeometry() {
  planes_.clear();
  boxes_.clear();
  capsules_.clear();
  cylinders_.clear();
  spheres_.clear();
  movers_.clear();
  sensors_.clear();
  broadphase_.clearStatics();
  // Persistent pairs reference handles that no longer exist; dropping the
  // manifold stops a stale Exit event firing for removed geometry.
  contactListener_.resetManifold();
}

/**
 * Closed-form sphere vs solid cylinder.
 *
 * Work in the cylinder's local frame (axis = local +Y). The closest point on
 * the solid to the ball centre is the axial coordinate clamped to
 * [-halfHeight, +halfHeight] combined with the radial coordinate clamped to
 * `radius`. Clamping both independently yields the three regions for free:
 *
 *   - only the radial clamp bites  → curved SIDE (normal is purely radial)
 *   - only the axial clamp bites   → flat END CAP (normal is ±local Y)
 *   - both clamp                   → RIM circle (normal is the diagonal from
 *                                     the rim point to the ball centre)
 *
 * When the ball centre is strictly inside the solid the delta degenerates, so
 * fall back to the shallowest exit face (side vs cap), mirroring
 * resolveSphereVsBox()'s deep-penetration branch.
 */
void PhysicsWorld::resolveSphereVsCylinder(BodyView& body, const CylinderDesc& cyl, int cylId) {
  if (!groupsInteract(body.getMembership(), body.getFilter(), cyl.membership, cyl.filter)) return;

  const Quat invRot = cyl.rotation.conjugate();
  const Vec3 p = invRot.rotate(body.getPosition() - cyl.center);

  const float radialSq = p.x * p.x + p.z * p.z;
  const float radial = std::sqrt(radialSq);
  const float axial = std::clamp(p.y, -cyl.halfHeight, cyl.halfHeight);
  const float scale = (radial > cyl.radius) ? (cyl.radius / radial) : 1.f;

  const Vec3 closest{p.x * scale, axial, p.z * scale};
  const Vec3 delta = p - closest;
  const float distSq = delta.lengthSq();
  const float r = body.getRadius();
  if (distSq >= r * r) return;

  Vec3 localNormal;
  float penetration;
  if (distSq < CONTACT_EPSILON_SQ) {
    // Centre inside the solid — exit through whichever face is nearer.
    const float dSide = cyl.radius - radial;
    const float dCap  = cyl.halfHeight - std::fabs(p.y);
    if (dCap <= dSide) {
      localNormal = {0.f, p.y >= 0.f ? 1.f : -1.f, 0.f};
      penetration = r + dCap;
    } else if (radial > 1e-6f) {
      localNormal = {p.x / radial, 0.f, p.z / radial};
      penetration = r + dSide;
    } else {
      // Dead on the axis: any radial direction is equally valid.
      localNormal = {1.f, 0.f, 0.f};
      penetration = r + dSide;
    }
  } else {
    const float dist = std::sqrt(distSq);
    localNormal = delta / dist;
    penetration = r - dist;
  }

  const Vec3 normal = cyl.rotation.rotate(localNormal).normalized();

  const float velN = body.getVelocity().dot(normal);
  if (velN >= 0.5f) return;

  const float e = std::min(body.getRestitution(), cyl.restitution);
  const Vec3 contactPoint = body.getPosition() - normal * r;
  const float mu = std::sqrt(std::max(body.getFriction(), 0.f) * std::max(cyl.friction, 0.f));
  const float j = applyContactImpulse(body, nullptr, contactPoint, normal, e, mu, penetration);

  if (penetration > SLOP && body.getType() == BodyType::Dynamic) {
    body.setPosition(body.getPosition() + normal * ((penetration - SLOP) * CORRECT));
  }

  ContactEvent evt;
  evt.bodyId1 = body.getId();
  evt.bodyId2 = cylId;
  evt.normal  = normal;
  evt.point   = body.getPosition() - normal * r;
  evt.impulse = j;
  contactListener_.pushContact(evt);
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
