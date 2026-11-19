/**
 * Sphere-vs-static queries (ContactQueries.h). Each body is the geometry
 * half of a sphere resolver, moved here unchanged so a ball's contacts are
 * bit for bit what they were; the resolvers keep the collision groups, the
 * separating-velocity gate, the impulse and the positional correction.
 *
 * A query returns true exactly where its resolver used to go on, which can
 * be at a penetration of 0 (sqrt rounding at the rim); the probe resolvers
 * in ShapeContacts.cpp also require penetration > 0.
 */
#include "ContactQueries.h"
#include "Cylinder.h"
#include "SolverConstants.h"
#include "VolumeShape.h"

#include <algorithm>
#include <cmath>

namespace pachinball {

namespace {

constexpr float CYLINDER_EPSILON_SQ = 1e-10f;
constexpr float CONE_EPSILON_SQ = 1e-10f;
constexpr float MOVER_EPSILON_SQ = 1e-10f;

// ---- Cone (closed form in the (ρ, y) half-plane, see Cone.cpp) ------------

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

ConeQuery queryConeLocal(const Vec3& local, float radius, float halfHeight) {
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

Vec3 closestOnSegment(const Vec3& p, const Vec3& a, const Vec3& b) {
  const Vec3 ab = b - a;
  float t = 0.f;
  const float abLenSq = ab.lengthSq();
  if (abLenSq > CONTACT_EPSILON_SQ) {
    t = std::clamp((p - a).dot(ab) / abLenSq, 0.f, 1.f);
  }
  return a + ab * t;
}

bool queryPlane(const PlaneDesc& plane, const Vec3& c, float r, SurfaceHit& hit) {
  const float dist = c.dot(plane.normal) - plane.distance;
  const float penetration = r - dist;
  if (penetration <= 0.f) return false;
  hit.normal = plane.normal;
  hit.penetration = penetration;
  return true;
}

bool queryBox(const BoxDesc& box, const Vec3& c, float r, SurfaceHit& hit) {
  const Quat invRot = box.rotation.conjugate();
  const Vec3 localCenter = invRot.rotate(c - box.center);

  const Vec3 closest{
    std::clamp(localCenter.x, -box.halfExtents.x, box.halfExtents.x),
    std::clamp(localCenter.y, -box.halfExtents.y, box.halfExtents.y),
    std::clamp(localCenter.z, -box.halfExtents.z, box.halfExtents.z),
  };

  const Vec3 delta = localCenter - closest;
  const float distSq = delta.lengthSq();
  // The second test only matters for r == 0 (a point inside has distSq 0).
  if (distSq >= r * r && distSq >= CONTACT_EPSILON_SQ) return false;

  if (distSq < CONTACT_EPSILON_SQ) {
    const float dx = box.halfExtents.x - std::fabs(localCenter.x);
    const float dy = box.halfExtents.y - std::fabs(localCenter.y);
    const float dz = box.halfExtents.z - std::fabs(localCenter.z);
    Vec3 localNormal = {0.f, localCenter.y >= 0.f ? 1.f : -1.f, 0.f};
    float shallow = dy;
    if (dx < shallow) { shallow = dx; localNormal = {localCenter.x >= 0.f ? 1.f : -1.f, 0.f, 0.f}; }
    if (dz < shallow) { shallow = dz; localNormal = {0.f, 0.f, localCenter.z >= 0.f ? 1.f : -1.f}; }
    hit.normal = box.rotation.rotate(localNormal).normalized();
    hit.penetration = r + shallow;
  } else {
    const float dist = std::sqrt(distSq);
    const Vec3 localNormal = delta / dist;
    hit.normal = box.rotation.rotate(localNormal);
    hit.penetration = r - dist;
  }
  return true;
}

bool queryCapsule(const CapsuleDesc& cap, const Vec3& c, float r, SurfaceHit& hit) {
  const Vec3 axisHalf = cap.rotation.rotate(Vec3{0.f, cap.halfHeight, 0.f});
  const Vec3 segA = cap.center - axisHalf;
  const Vec3 segB = cap.center + axisHalf;
  const Vec3 closest = closestOnSegment(c, segA, segB);

  const Vec3 delta = c - closest;
  const float distSq = delta.lengthSq();
  const float minDist = r + cap.radius;
  if (distSq >= minDist * minDist) return false;

  const float dist = std::sqrt(std::max(distSq, CONTACT_EPSILON_SQ));
  hit.normal = dist > 1e-5f ? delta / dist
                            : cap.rotation.rotate(Vec3{0.f, 1.f, 0.f}).normalized();
  hit.penetration = minDist - dist;
  return true;
}

bool queryCylinder(const CylinderDesc& cyl, const Vec3& c, float r, SurfaceHit& hit) {
  const Quat invRot = cyl.rotation.conjugate();
  const Vec3 localCenter = invRot.rotate(c - cyl.center);

  bool inside = false;
  const Vec3 closest = closestPointOnCylinder(localCenter, cyl.radius, cyl.halfHeight, inside);

  const Vec3 delta = localCenter - closest;
  const float distSq = delta.lengthSq();
  if (!inside && distSq >= r * r) return false;

  Vec3 localNormal;
  if (inside || distSq < CYLINDER_EPSILON_SQ) {
    float shallow = 0.f;
    deepestCylinderNormal(localCenter, cyl.radius, cyl.halfHeight, localNormal, shallow);
    hit.penetration = r + shallow;
  } else {
    const float dist = std::sqrt(distSq);
    localNormal = delta / dist;
    hit.penetration = r - dist;
  }
  hit.normal = cyl.rotation.rotate(localNormal).normalized();
  return true;
}

bool querySphere(const SphereDesc& sphere, const Vec3& c, float r, SurfaceHit& hit) {
  const Vec3 delta = c - sphere.center;
  const float distSq = delta.lengthSq();
  const float minDist = r + sphere.radius;
  if (distSq >= minDist * minDist) return false;

  const float dist = std::sqrt(std::max(distSq, CONTACT_EPSILON_SQ));
  hit.normal = (dist > 1e-5f) ? (delta / dist) : Vec3::up();
  hit.penetration = minDist - dist;
  return true;
}

bool queryCone(const ConeDesc& cone, const Vec3& c, float r, SurfaceHit& hit) {
  const Quat invRot = cone.rotation.conjugate();
  const Vec3 localCenter = invRot.rotate(c - cone.center);
  const ConeQuery q = queryConeLocal(localCenter, cone.radius, cone.halfHeight);

  const Vec3 delta = localCenter - q.closest;
  const float distSq = delta.lengthSq();
  if (!q.inside && distSq >= r * r) return false;

  Vec3 localNormal;
  if (q.inside || distSq < CONE_EPSILON_SQ) {
    localNormal = q.exitNormal;
    hit.penetration = r + q.exitDepth;
  } else {
    const float dist = std::sqrt(distSq);
    localNormal = delta / dist;
    hit.penetration = r - dist;
  }
  hit.normal = cone.rotation.rotate(localNormal).normalized();
  return true;
}

bool queryTriangle(const MeshTriangle& tri, bool doubleSided, const Vec3& c, float r, SurfaceHit& hit) {
  bool onFace = false;
  const Vec3 closest = closestPointOnTriangle(c, tri.a, tri.b, tri.c, onFace);

  const Vec3 delta = c - closest;
  const float distSq = delta.lengthSq();
  if (distSq >= r * r) return false;

  const float side = delta.dot(tri.normal);
  Vec3 normal;
  if (onFace) {
    // Flat-face contact: use the face normal so coplanar triangles sharing an
    // edge present one seamless surface and a rolling ball feels no seam.
    if (side < 0.f) {
      if (!doubleSided) return false;
      normal = tri.normal * -1.f;
    } else {
      normal = tri.normal;
    }
  } else {
    // Edge / vertex contact: the delta direction is the true separating
    // axis. Reject approaches from behind the face unless double-sided, which
    // is what keeps a ball from catching on the underside of a ramp seam.
    if (side <= 0.f && !doubleSided) return false;
    if (distSq < 1e-10f) return false; // exactly on the boundary — no usable direction
    normal = delta / std::sqrt(distSq);
  }

  const float dist = std::sqrt(distSq);
  const float penetration = onFace ? r - std::fabs(side) : r - dist;
  if (penetration <= 0.f) return false;
  hit.normal = normal;
  hit.penetration = penetration;
  return true;
}

bool queryMover(const KinematicMover& mover, const Vec3& c, float r, SurfaceHit& hit) {
  const Quat invRot = mover.currentRot.conjugate();
  const Vec3 localCenter = invRot.rotate(c - mover.currentPos);
  bool inside = false;
  const Vec3 closest = closestPointOnVolume(mover.shape, localCenter, mover.halfExtents, inside);

  const Vec3 delta = localCenter - closest;
  const float distSq = delta.lengthSq();
  if (!inside && distSq >= r * r) return false;

  Vec3 localNormal;
  if (inside || distSq < MOVER_EPSILON_SQ) {
    float shallow = 0.f;
    deepestVolumeNormal(mover.shape, localCenter, mover.halfExtents, localNormal, shallow);
    hit.penetration = r + shallow;
  } else {
    const float dist = std::sqrt(distSq);
    localNormal = delta / dist;
    hit.penetration = r - dist;
  }
  hit.normal = mover.currentRot.rotate(localNormal).normalized();
  return true;
}

CoreSegment coreOf(const CapsuleDesc& cap) {
  const Vec3 axisHalf = cap.rotation.rotate(Vec3{0.f, cap.halfHeight, 0.f});
  return {cap.center - axisHalf, cap.center + axisHalf};
}

CoreSegment coreOf(const CylinderDesc& cyl) {
  const Vec3 axisHalf = cyl.rotation.rotate(Vec3{0.f, cyl.halfHeight, 0.f});
  return {cyl.center - axisHalf, cyl.center + axisHalf};
}

CoreSegment coreOf(const ConeDesc& cone) {
  const Vec3 axisHalf = cone.rotation.rotate(Vec3{0.f, cone.halfHeight, 0.f});
  return {cone.center - axisHalf, cone.center + axisHalf};
}

CoreSegment coreOf(const SphereDesc& sphere) {
  return {sphere.center, sphere.center};
}

} // namespace pachinball
