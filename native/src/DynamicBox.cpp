/**
 * Dynamic oriented-box bodies (Firewall-style crates).
 *
 * Two narrowphase paths, both reusing the shared sequential-impulse solver:
 *
 *  - Sphere vs dynamic box — the usual OBB closest-point test, solved as a
 *    two-body contact so the crate recoils and spins when a ball hits it.
 *  - Dynamic box vs static geometry — the box's eight corners are used as
 *    contact probes. Each penetrating corner produces its own impulse at its
 *    own lever arm, which is what lets a crate rest flat, tip over an edge
 *    and slide, without a full box-box SAT/clipping solver.
 *
 * Deliberately absent: box-vs-box and box-vs-capsule. Crates only ever meet
 * balls and the static world in the campaign; see the issue's scope notes.
 */
#include "CollisionFilter.h"
#include "PhysicsWorld.h"
#include "TriangleMesh.h"

#include <algorithm>
#include <cmath>

namespace pachinball {

static constexpr float BOX_EPSILON_SQ = 1e-10f;

namespace {

/** The eight corner offsets of a unit box, in local space. */
constexpr float CORNER_SIGNS[8][3] = {
  {-1.f, -1.f, -1.f}, {1.f, -1.f, -1.f}, {-1.f, 1.f, -1.f}, {1.f, 1.f, -1.f},
  {-1.f, -1.f,  1.f}, {1.f, -1.f,  1.f}, {-1.f, 1.f,  1.f}, {1.f, 1.f,  1.f},
};

Vec3 clampToBox(const Vec3& local, const Vec3& he) {
  return {
    std::clamp(local.x, -he.x, he.x),
    std::clamp(local.y, -he.y, he.y),
    std::clamp(local.z, -he.z, he.z),
  };
}

void shallowestBoxFace(const Vec3& local, const Vec3& he, Vec3& outNormal, float& outDepth) {
  const float dx = he.x - std::fabs(local.x);
  const float dy = he.y - std::fabs(local.y);
  const float dz = he.z - std::fabs(local.z);
  outNormal = Vec3::up();
  outDepth = dy;
  if (dx < outDepth) { outDepth = dx; outNormal = {local.x >= 0.f ? 1.f : -1.f, 0.f, 0.f}; }
  if (dz < outDepth) { outDepth = dz; outNormal = {0.f, 0.f, local.z >= 0.f ? 1.f : -1.f}; }
}

} // namespace

void PhysicsWorld::resolveSphereVsBoxBody(BodyView& sphere, BodyView& box) {
  if (!groupsInteract(sphere.getMembership(), sphere.getFilter(),
                      box.getMembership(), box.getFilter())) return;

  const Vec3 he = box.getBoxHalfExtents();
  const Quat boxRot = box.getRotation();
  const Vec3 local = boxRot.conjugate().rotate(sphere.getPosition() - box.getPosition());
  const Vec3 closest = clampToBox(local, he);

  const Vec3 delta = local - closest;
  const float distSq = delta.lengthSq();
  const float radius = sphere.getRadius();
  if (distSq >= radius * radius) return;

  Vec3 localNormal;
  float penetration;
  if (distSq < BOX_EPSILON_SQ) {
    float depth;
    shallowestBoxFace(local, he, localNormal, depth);
    penetration = radius + depth;
  } else {
    const float dist = std::sqrt(distSq);
    localNormal = delta / dist;
    penetration = radius - dist;
  }
  const Vec3 normal = boxRot.rotate(localNormal).normalized();

  const Vec3 relVel = sphere.getVelocity() - box.getVelocity();
  if (relVel.dot(normal) >= 0.5f) return;

  const float invSphere = sphere.getInvMass();
  const float invBox = box.getInvMass();
  if (invSphere + invBox < 1e-12f) return;

  const Vec3 contactPoint = sphere.getPosition() - normal * radius;
  const float e = std::min(sphere.getRestitution(), box.getRestitution());
  const float mu = std::sqrt(std::max(sphere.getFriction(), 0.f) * std::max(box.getFriction(), 0.f));
  const float j = applyContactImpulse(sphere, &box, contactPoint, normal, e, mu, penetration);

  constexpr float SLOP    = 0.001f;
  constexpr float CORRECT = 0.4f;
  if (penetration > SLOP) {
    const float denom = std::max(invSphere + invBox, 1e-12f);
    const float corr = (penetration - SLOP) * CORRECT / denom;
    if (sphere.getType() == BodyType::Dynamic)
      sphere.setPosition(sphere.getPosition() + normal * (corr * invSphere));
    if (box.getType() == BodyType::Dynamic)
      box.setPosition(box.getPosition() - normal * (corr * invBox));
  }

  ContactEvent evt;
  evt.bodyId1 = sphere.getId();
  evt.bodyId2 = box.getId();
  evt.normal  = normal;
  evt.point   = contactPoint;
  evt.impulse = j;
  contactListener_.pushContact(evt);
}

void PhysicsWorld::resolveBoxCorners(BodyView& box, int otherId,
                                     float otherRestitution, float otherFriction,
                                     const SurfacePointQuery& query) {
  const Vec3 he = box.getBoxHalfExtents();
  const Quat rot = box.getRotation();
  const Vec3 center = box.getPosition();

  const float e = std::min(box.getRestitution(), otherRestitution);
  const float mu = std::sqrt(std::max(box.getFriction(), 0.f) * std::max(otherFriction, 0.f));

  float deepest = 0.f;
  Vec3 deepestNormal = Vec3::up();
  Vec3 deepestPoint = center;
  float peakImpulse = 0.f;
  int hits = 0;

  for (const auto& sign : CORNER_SIGNS) {
    const Vec3 localCorner{he.x * sign[0], he.y * sign[1], he.z * sign[2]};
    const Vec3 corner = center + rot.rotate(localCorner);

    Vec3 normal;
    float penetration = 0.f;
    if (!query(corner, normal, penetration)) continue;
    if (penetration <= 0.f) continue;

    ++hits;
    const float j = applyContactImpulse(box, nullptr, corner, normal, e, mu, penetration);
    if (j > peakImpulse) peakImpulse = j;
    if (penetration > deepest) {
      deepest = penetration;
      deepestNormal = normal;
      deepestPoint = corner;
    }
  }

  if (hits == 0) return;

  // Split the positional correction across the penetrating corners so a crate
  // resting squarely on four of them is not shoved out four times over.
  constexpr float SLOP    = 0.001f;
  constexpr float CORRECT = 0.6f;
  if (deepest > SLOP && box.getType() == BodyType::Dynamic) {
    box.setPosition(center + deepestNormal * ((deepest - SLOP) * CORRECT));
  }

  ContactEvent evt;
  evt.bodyId1 = box.getId();
  evt.bodyId2 = otherId;
  evt.normal  = deepestNormal;
  evt.point   = deepestPoint;
  evt.impulse = peakImpulse;
  contactListener_.pushContact(evt);
}

void PhysicsWorld::resolveBoxBodyVsPlane(BodyView& box, const PlaneDesc& plane) {
  resolveBoxCorners(box, STATIC_PLANE_ID, 0.4f, plane.friction,
    [&plane](const Vec3& p, Vec3& normal, float& penetration) {
      const float dist = p.dot(plane.normal) - plane.distance;
      if (dist >= 0.f) return false;
      normal = plane.normal;
      penetration = -dist;
      return true;
    });
}

void PhysicsWorld::resolveBoxBodyVsBox(BodyView& box, const BoxDesc& other, int otherId) {
  if (!groupsInteract(box.getMembership(), box.getFilter(),
                      other.membership, other.filter)) return;

  resolveBoxCorners(box, otherId, other.restitution, other.friction,
    [&other](const Vec3& p, Vec3& normal, float& penetration) {
      const Vec3 local = other.rotation.conjugate().rotate(p - other.center);
      const Vec3 he = other.halfExtents;
      if (std::fabs(local.x) >= he.x) return false;
      if (std::fabs(local.y) >= he.y) return false;
      if (std::fabs(local.z) >= he.z) return false;
      Vec3 localNormal;
      shallowestBoxFace(local, he, localNormal, penetration);
      normal = other.rotation.rotate(localNormal).normalized();
      return true;
    });
}

void PhysicsWorld::resolveBoxBodyVsTriangle(BodyView& box, int triangleIndex) {
  const MeshTriangle& tri = triangles_[static_cast<std::size_t>(triangleIndex)];
  const TriangleMeshDesc& mesh = meshes_[static_cast<std::size_t>(tri.meshIndex)];
  if (!groupsInteract(box.getMembership(), box.getFilter(),
                      mesh.membership, mesh.filter)) return;

  resolveBoxCorners(box, STATIC_MESH_ID_BASE - tri.meshIndex, mesh.restitution, mesh.friction,
    [&tri, &mesh](const Vec3& p, Vec3& normal, float& penetration) {
      // A corner is a point, so there is no radius to inflate by: it counts as
      // touching only once it has passed through the face. Depth is measured
      // along the face normal, and the corner must be behind the front face.
      const float side = (p - tri.a).dot(tri.normal);
      if (side >= 0.f) return false;
      if (!mesh.doubleSided && side < -0.25f) return false; // too deep — it went through
      bool onFace = false;
      const Vec3 closest = closestPointOnTriangle(p, tri.a, tri.b, tri.c, onFace);
      if (!onFace) return false; // edges/vertices are covered by the neighbouring triangle
      (void)closest;
      normal = tri.normal;
      penetration = -side;
      return true;
    });
}

} // namespace pachinball
