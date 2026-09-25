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
 * direction. All functions here are PhysicsWorld methods (PhysicsWorld.h)
 * or file-local helpers.
 */
#include "CollisionFilter.h"
#include "PhysicsWorld.h"

#include <algorithm>
#include <cmath>

namespace pachinball {

namespace {

constexpr float CONE_EPSILON_SQ = 1e-10f;
constexpr float SLOP    = 0.001f;
constexpr float CORRECT = 0.8f;

struct Vec2 {
  float r;
  float y;
};

Vec2 closestOnSegment2(Vec2 p, Vec2 a, Vec2 b) {
  const float abr = b.r - a.r;
  const float aby = b.y - a.y;
  const float lenSq = abr * abr + aby * aby;
  float t = 0.f;
  if (lenSq > CONE_EPSILON_SQ) {
    t = std::clamp(((p.r - a.r) * abr + (p.y - a.y) * aby) / lenSq, 0.f, 1.f);
  }
  return {a.r + abr * t, a.y + aby * t};
}

float distSq2(Vec2 a, Vec2 b) {
  const float dr = a.r - b.r;
  const float dy = a.y - b.y;
  return dr * dr + dy * dy;
}

/**
 * Local-space contact against the cone: the nearest surface point, whether
 * `local` is inside, and — when it is — the shallowest exit normal/depth.
 */
struct ConeQuery {
  Vec3  closest;
  bool  inside = false;
  Vec3  exitNormal = Vec3::up();
  float exitDepth = 0.f;   ///< ≥ 0 inside; only read when inside or on the surface
};

ConeQuery queryCone(const Vec3& local, float radius, float halfHeight) {
  const float rho = std::sqrt(local.x * local.x + local.z * local.z);
  // Radial direction of the query point; dead on the axis any direction
  // works, so pick +X to stay deterministic.
  const float dirX = rho > 1e-6f ? local.x / rho : 1.f;
  const float dirZ = rho > 1e-6f ? local.z / rho : 0.f;

  const Vec2 p{rho, local.y};
  const Vec2 apex{0.f, halfHeight};
  const Vec2 rim{radius, -halfHeight};
  const Vec2 baseCentre{0.f, -halfHeight};

  // Outward slant normal in (ρ, y): perpendicular to rim → apex.
  const float slantLen = std::sqrt(4.f * halfHeight * halfHeight + radius * radius);
  const float nr = slantLen > 1e-8f ? (2.f * halfHeight) / slantLen : 1.f;
  const float ny = slantLen > 1e-8f ? radius / slantLen : 0.f;
  const float slantDist = (p.r - rim.r) * nr + (p.y - rim.y) * ny;
  const float baseDist = -halfHeight - p.y;

  ConeQuery q;
  q.inside = slantDist < 0.f && baseDist < 0.f;

  // Shallowest exit = the face whose signed distance is largest; also the
  // right normal for a point sitting exactly on the surface.
  if (baseDist > slantDist) {
    q.exitNormal = {0.f, -1.f, 0.f};
    q.exitDepth = -baseDist;
  } else {
    q.exitNormal = {nr * dirX, ny, nr * dirZ};
    q.exitDepth = -slantDist;
  }

  const Vec2 onBase = closestOnSegment2(p, baseCentre, rim);
  const Vec2 onSlant = closestOnSegment2(p, rim, apex);
  const Vec2 best = distSq2(p, onBase) <= distSq2(p, onSlant) ? onBase : onSlant;
  q.closest = {best.r * dirX, best.y, best.r * dirZ};
  return q;
}

} // namespace

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

  const Quat invRot = cone.rotation.conjugate();
  const Vec3 localCenter = invRot.rotate(body.getPosition() - cone.center);
  const ConeQuery q = queryCone(localCenter, cone.radius, cone.halfHeight);

  const Vec3 delta = localCenter - q.closest;
  const float distSq = delta.lengthSq();
  const float radius = body.getRadius();
  if (!q.inside && distSq >= radius * radius) return;

  Vec3 localNormal;
  float penetration;
  if (q.inside || distSq < CONE_EPSILON_SQ) {
    localNormal = q.exitNormal;
    penetration = radius + q.exitDepth;
  } else {
    const float dist = std::sqrt(distSq);
    localNormal = delta / dist;
    penetration = radius - dist;
  }

  const Vec3 normal = cone.rotation.rotate(localNormal).normalized();

  const float velN = body.getVelocity().dot(normal);
  if (velN >= 0.5f) return;

  const float e = std::min(body.getRestitution(), cone.restitution);
  const Vec3 contactPoint = body.getPosition() - normal * radius;
  const float mu = std::sqrt(std::max(body.getFriction(), 0.f) * std::max(cone.friction, 0.f));
  const float j = applyContactImpulse(body, nullptr, contactPoint, normal, e, mu, penetration);

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
