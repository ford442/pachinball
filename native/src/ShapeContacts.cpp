/**
 * Capsule and box bodies against static geometry (#520 row 4).
 *
 * A dynamic capsule (a flipper blade) used to meet static boxes, capsules,
 * planes and triangles as a sphere of its radius at its centre — its two
 * ends went through walls — and static cylinders, spheres, cones, pin
 * fields not at all; a dynamic box (a crate) met a static capsule as a
 * sphere of whatever `radius` its descriptor carried, a mover the same way,
 * and cylinders, spheres, cones and pins not at all.
 *
 * Both now probe the static with the sphere queries of ContactQueries.h:
 *
 *  - capsule: spheres of its radius at both segment ends and at the segment
 *    point nearest the static (alternating projection between the segment
 *    and the static's nearest point / core);
 *  - box: zero-radius points at its eight corners and at its point nearest
 *    the static's core (alternating projection again) — and the other way
 *    round, the static's own features inside the box: a sphere's or
 *    capsule's core sunk into it, a cylinder's cap centres and rim points, a
 *    cone's apex and base rim (a cone point-up under a crate touches it
 *    with nothing but its apex). Boxes keep their corner-only resolvers for
 *    planes, static boxes and triangles (DynamicBox.cpp): those statics are
 *    flat, so a corner is where a box meets them first.
 *
 * Every penetrating probe gets its own impulse at its own lever arm (as
 * box corners always did), one positional correction is made along the
 * deepest, and one contact event is reported with the peak impulse.
 */
#include "CollisionFilter.h"
#include "ContactQueries.h"
#include "PhysicsWorld.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace pachinball {

namespace {

constexpr int PROJECTION_ITERATIONS = 6;
constexpr float SLOP = 0.001f;
constexpr float CAPSULE_CORRECT = 0.8f; ///< as the sphere resolvers
constexpr float BOX_CORRECT = 0.6f;     ///< as resolveBoxCorners

constexpr float CORNER_SIGNS[8][3] = {
  {-1.f, -1.f, -1.f}, {1.f, -1.f, -1.f}, {-1.f, 1.f, -1.f}, {1.f, 1.f, -1.f},
  {-1.f, -1.f,  1.f}, {1.f, -1.f,  1.f}, {-1.f, 1.f,  1.f}, {1.f, 1.f,  1.f},
};

struct Segment {
  Vec3 a;
  Vec3 b;
};

Segment capsuleSegment(const BodyView& body) {
  const Vec3 axisHalf = body.getRotation().rotate(Vec3{0.f, body.getCapsuleHalfHeight(), 0.f});
  return {body.getPosition() - axisHalf, body.getPosition() + axisHalf};
}

/** The segment point nearest a convex set, given that set's nearest-point map. */
template <typename Nearest>
Vec3 segmentPointNearest(const Segment& s, Nearest nearest) {
  Vec3 p = (s.a + s.b) * 0.5f;
  for (int i = 0; i < PROJECTION_ITERATIONS; ++i) p = closestOnSegment(nearest(p), s.a, s.b);
  return p;
}

/** Fills `out` with the capsule probes that penetrate; returns how many. */
template <typename Query, typename Nearest>
int capsuleHits(const BodyView& body, Query query, Nearest nearest, ProbeHit* out) {
  const Segment s = capsuleSegment(body);
  const float r = body.getRadius();
  const Vec3 mid = segmentPointNearest(s, nearest);
  // The nearest point is often an end (a plane, a wall it leans on): one probe there.
  const float dupSq = 1e-6f * std::max(r * r, 1e-6f);
  const bool midIsEnd = (mid - s.a).lengthSq() < dupSq || (mid - s.b).lengthSq() < dupSq;
  const std::array<Vec3, 3> probes{s.a, s.b, mid};
  const int count = midIsEnd ? 2 : 3;
  int hits = 0;
  for (int i = 0; i < count; ++i) {
    const Vec3& p = probes[static_cast<std::size_t>(i)];
    SurfaceHit h;
    if (!query(p, r, h) || !(h.penetration > 0.f)) continue;
    out[hits++] = {p - h.normal * r, h.normal, h.penetration};
  }
  return hits;
}

struct BoxFrame {
  Vec3 center;
  Quat rotation;
  Vec3 halfExtents;

  explicit BoxFrame(const BodyView& box)
      : center(box.getPosition()), rotation(box.getRotation()), halfExtents(box.getBoxHalfExtents()) {}

  [[nodiscard]] Vec3 nearest(const Vec3& p) const {
    const Vec3 local = rotation.conjugate().rotate(p - center);
    const Vec3 clamped{
      std::clamp(local.x, -halfExtents.x, halfExtents.x),
      std::clamp(local.y, -halfExtents.y, halfExtents.y),
      std::clamp(local.z, -halfExtents.z, halfExtents.z),
    };
    return center + rotation.rotate(clamped);
  }

  /**
   * For a static point `p` strictly inside the box: the direction that pushes
   * the box off it (minus the outward normal of the face it is nearest) and
   * how far. False when `p` is not inside.
   */
  bool exitFrom(const Vec3& p, Vec3& outNormal, float& outDepth) const {
    const Vec3 local = rotation.conjugate().rotate(p - center);
    const float dx = halfExtents.x - std::fabs(local.x);
    const float dy = halfExtents.y - std::fabs(local.y);
    const float dz = halfExtents.z - std::fabs(local.z);
    if (!(dx > 0.f && dy > 0.f && dz > 0.f)) return false;
    Vec3 face{0.f, local.y >= 0.f ? 1.f : -1.f, 0.f};
    outDepth = dy;
    if (dx < outDepth) { outDepth = dx; face = {local.x >= 0.f ? 1.f : -1.f, 0.f, 0.f}; }
    if (dz < outDepth) { outDepth = dz; face = {0.f, 0.f, local.z >= 0.f ? 1.f : -1.f}; }
    outNormal = rotation.rotate(face) * -1.f;
    return true;
  }
};

/** What a box probes a static with, beyond its own corners. */
struct BoxProbeSet {
  /** Radius of the static around its core: a core point inside the box is that much deeper. */
  float coreRadius = 0.f;
  /** Static surface points that can poke into a box face (cylinder caps / rims, cone apex / rim). */
  std::array<Vec3, 10> features{};
  int featureCount = 0;

  void add(const Vec3& p) { features[static_cast<std::size_t>(featureCount++)] = p; }
};

constexpr std::size_t MAX_BOX_HITS = 8 + 1 + 10;

/**
 * Fills `out` with the box's contacts against a static: its corners and its
 * point nearest the static's core, wherever they are inside the static
 * (`query` at r = 0); the core point itself when it is inside the box (the
 * point query there would have no direction); and every feature point of
 * `set` inside the box. `nearest` maps a point to the static's core.
 * Returns how many.
 */
template <typename Query, typename Nearest>
int boxHits(const BodyView& box, Query query, Nearest nearest, const BoxProbeSet& set, ProbeHit* out) {
  const BoxFrame frame(box);
  std::array<Vec3, 9> probes;
  for (std::size_t i = 0; i < 8; ++i) {
    const Vec3 local{frame.halfExtents.x * CORNER_SIGNS[i][0], frame.halfExtents.y * CORNER_SIGNS[i][1],
                     frame.halfExtents.z * CORNER_SIGNS[i][2]};
    probes[i] = frame.center + frame.rotation.rotate(local);
  }
  Vec3 core = nearest(frame.center);
  Vec3 q = frame.nearest(core);
  for (int i = 0; i < PROJECTION_ITERATIONS; ++i) {
    core = nearest(q);
    q = frame.nearest(core);
  }
  probes[8] = q;

  int hits = 0;
  Vec3 exitNormal;
  float exitDepth = 0.f;
  const bool coreInside = frame.exitFrom(core, exitNormal, exitDepth);
  if (coreInside) out[hits++] = {core, exitNormal, exitDepth + set.coreRadius};
  const std::size_t probeCount = coreInside ? 8 : 9;
  for (std::size_t i = 0; i < probeCount; ++i) {
    SurfaceHit h;
    if (!query(probes[i], 0.f, h) || !(h.penetration > 0.f)) continue;
    out[hits++] = {probes[i], h.normal, h.penetration};
  }
  for (int i = 0; i < set.featureCount; ++i) {
    const Vec3& f = set.features[static_cast<std::size_t>(i)];
    if (frame.exitFrom(f, exitNormal, exitDepth)) out[hits++] = {f, exitNormal, exitDepth};
  }
  return hits;
}

BoxProbeSet probeSetOf(const SphereDesc& s) {
  BoxProbeSet set;
  set.coreRadius = s.radius;
  return set;
}

BoxProbeSet probeSetOf(const CapsuleDesc& c) {
  BoxProbeSet set;
  set.coreRadius = c.radius;
  return set;
}

/**
 * Cap centres and four rim points per cap. Core radius 0: the radius is the
 * depth only off the side, and a cap centre sunk into a crate is a cap
 * contact, as deep as it is in the box.
 */
BoxProbeSet probeSetOf(const CylinderDesc& c) {
  BoxProbeSet set;
  const Vec3 up = c.rotation.rotate(Vec3{0.f, c.halfHeight, 0.f});
  const Vec3 ex = c.rotation.rotate(Vec3{c.radius, 0.f, 0.f});
  const Vec3 ez = c.rotation.rotate(Vec3{0.f, 0.f, c.radius});
  for (const Vec3& cap : {c.center + up, c.center - up}) {
    set.add(cap);
    set.add(cap + ex);
    set.add(cap - ex);
    set.add(cap + ez);
    set.add(cap - ez);
  }
  return set;
}

/** Apex, base centre and four base-rim points (core radius 0: it tapers to the apex). */
BoxProbeSet probeSetOf(const ConeDesc& c) {
  BoxProbeSet set;
  const Vec3 up = c.rotation.rotate(Vec3{0.f, c.halfHeight, 0.f});
  const Vec3 ex = c.rotation.rotate(Vec3{c.radius, 0.f, 0.f});
  const Vec3 ez = c.rotation.rotate(Vec3{0.f, 0.f, c.radius});
  const Vec3 base = c.center - up;
  set.add(c.center + up);
  set.add(base);
  set.add(base + ex);
  set.add(base - ex);
  set.add(base + ez);
  set.add(base - ez);
  return set;
}

/** Nearest point of a static's core segment. */
struct CoreNearest {
  CoreSegment core;
  Vec3 operator()(const Vec3& p) const { return closestOnSegment(p, core.a, core.b); }
};

} // namespace

void PhysicsWorld::applyProbeHits(BodyView& body, const ProbeHit* hits, int count,
                                  float restitution, float friction, int otherId, int subIndex,
                                  const KinematicMover* mover) {
  if (count <= 0) return;
  const float e = std::min(body.getRestitution(), restitution);
  const float mu = std::sqrt(std::max(body.getFriction(), 0.f) * std::max(friction, 0.f));

  float peak = 0.f;
  int deepest = 0;
  for (int i = 0; i < count; ++i) {
    const ProbeHit& hit = hits[i];
    float j = 0.f;
    if (mover) {
      const Vec3 arm = hit.point - mover->currentPos;
      const Vec3 moverVel = mover->linearVelocity + mover->angularVelocity.cross(arm);
      j = applyMoverContactImpulse(body, hit.point, hit.normal, moverVel, e, mu, hit.penetration);
    } else {
      j = applyContactImpulse(body, nullptr, hit.point, hit.normal, e, mu, hit.penetration);
    }
    if (j > peak) peak = j;
    if (hit.penetration > hits[deepest].penetration) deepest = i;
  }

  // One correction along the deepest probe, so a body resting on several is
  // not shoved out once per probe.
  const ProbeHit& d = hits[deepest];
  const float correct = body.getShape() == Shape::Box ? BOX_CORRECT : CAPSULE_CORRECT;
  if (d.penetration > SLOP && body.getType() == BodyType::Dynamic) {
    body.setPosition(body.getPosition() + d.normal * ((d.penetration - SLOP) * correct));
  }

  ContactEvent evt;
  evt.bodyId1 = body.getId();
  evt.bodyId2 = otherId;
  evt.normal = d.normal;
  evt.point = d.point;
  evt.impulse = peak;
  evt.subIndex = subIndex;
  contactListener_.pushContact(evt);
}

void PhysicsWorld::resolveShapeVsStatic(BodyView& body, const BroadphaseGrid::Pair& pair) {
  const bool isBox = body.getShape() == Shape::Box;
  const std::size_t idx = static_cast<std::size_t>(pair.bodyB);
  std::array<ProbeHit, MAX_BOX_HITS> hits{};
  int n = 0;

  // `Static` has center/rotation/restitution/friction/membership/filter; `query`
  // is its ContactQueries function.
  auto round = [&](const auto& shape, auto query, int otherId) {
    if (!groupsInteract(body.getMembership(), body.getFilter(), shape.membership, shape.filter)) return;
    const auto q = [&](const Vec3& c, float r, SurfaceHit& h) { return query(shape, c, r, h); };
    const CoreNearest nearest{coreOf(shape)};
    n = isBox ? boxHits(body, q, nearest, probeSetOf(shape), hits.data())
              : capsuleHits(body, q, nearest, hits.data());
    applyProbeHits(body, hits.data(), n, shape.restitution, shape.friction, otherId, 0, nullptr);
  };

  switch (pair.type) {
    case BroadphaseGrid::Pair::BodyCapsule:
      round(capsules_[idx], queryCapsule, STATIC_CAPSULE_ID_BASE - pair.bodyB);
      break;
    case BroadphaseGrid::Pair::BodyCylinder:
      round(cylinders_[idx], queryCylinder, STATIC_CYLINDER_ID_BASE - pair.bodyB);
      break;
    case BroadphaseGrid::Pair::BodySphere:
      round(spheres_[idx], querySphere, STATIC_SPHERE_ID_BASE - pair.bodyB);
      break;
    case BroadphaseGrid::Pair::BodyCone:
      round(cones_[idx], queryCone, STATIC_CONE_ID_BASE - pair.bodyB);
      break;
    case BroadphaseGrid::Pair::BodyBox: {
      // Boxes meet static boxes by their corners (resolveBoxBodyVsBox).
      if (isBox) return;
      const BoxDesc& box = boxes_[idx];
      if (!groupsInteract(body.getMembership(), body.getFilter(), box.membership, box.filter)) return;
      const auto q = [&box](const Vec3& c, float r, SurfaceHit& h) { return queryBox(box, c, r, h); };
      const auto nearest = [&box](const Vec3& p) {
        const Vec3 local = box.rotation.conjugate().rotate(p - box.center);
        const Vec3 he = box.halfExtents;
        return box.center + box.rotation.rotate(Vec3{std::clamp(local.x, -he.x, he.x),
                                                     std::clamp(local.y, -he.y, he.y),
                                                     std::clamp(local.z, -he.z, he.z)});
      };
      n = capsuleHits(body, q, nearest, hits.data());
      applyProbeHits(body, hits.data(), n, box.restitution, box.friction, STATIC_BOX_ID_BASE - pair.bodyB, 0, nullptr);
      break;
    }
    case BroadphaseGrid::Pair::BodyTriangle: {
      // Boxes meet triangles by their corners (resolveBoxBodyVsTriangle).
      if (isBox) return;
      const MeshTriangle& tri = triangles_[idx];
      const TriangleMeshDesc& mesh = meshes_[static_cast<std::size_t>(tri.meshIndex)];
      if (!groupsInteract(body.getMembership(), body.getFilter(), mesh.membership, mesh.filter)) return;
      const auto q = [&](const Vec3& c, float r, SurfaceHit& h) { return queryTriangle(tri, mesh.doubleSided, c, r, h); };
      const auto nearest = [&tri](const Vec3& p) {
        bool onFace = false;
        return closestPointOnTriangle(p, tri.a, tri.b, tri.c, onFace);
      };
      n = capsuleHits(body, q, nearest, hits.data());
      applyProbeHits(body, hits.data(), n, mesh.restitution, mesh.friction, STATIC_MESH_ID_BASE - tri.meshIndex, 0,
                     nullptr);
      break;
    }
    default:
      break;
  }
}

void PhysicsWorld::resolveCapsuleVsPlane(BodyView& body, const PlaneDesc& plane) {
  const auto q = [&plane](const Vec3& c, float r, SurfaceHit& h) { return queryPlane(plane, c, r, h); };
  const auto nearest = [&plane](const Vec3& p) {
    return p - plane.normal * (p.dot(plane.normal) - plane.distance);
  };
  std::array<ProbeHit, 3> hits{};
  const int n = capsuleHits(body, q, nearest, hits.data());
  applyProbeHits(body, hits.data(), n, plane.restitution, plane.friction, STATIC_PLANE_ID, 0, nullptr);
}

void PhysicsWorld::resolveShapeVsPinField(BodyView& body, int fieldIndex) {
  const PinField& field = pinFields_[static_cast<std::size_t>(fieldIndex)];
  const PinFieldDesc& d = field.desc;
  if (!groupsInteract(body.getMembership(), body.getFilter(), d.membership, d.filter)) return;
  const bool isBox = body.getShape() == Shape::Box;
  const float bound = isBox ? body.getBoxHalfExtents().length()
                            : body.getRadius() + body.getCapsuleHalfHeight();
  const Vec3 local = field.invRotation.rotate(body.getPosition() - d.origin);

  int r0 = 0;
  int r1 = -1;
  if (!pinFieldRowRange(field, local, bound + d.radius, r0, r1)) return;

  CylinderDesc pin;
  pin.radius = d.radius;
  pin.halfHeight = d.halfHeight;
  pin.rotation = d.rotation;
  const int fieldId = PIN_FIELD_ID_BASE - fieldIndex;
  const auto q = [&pin](const Vec3& c, float r, SurfaceHit& h) { return queryCylinder(pin, c, r, h); };
  std::array<ProbeHit, MAX_BOX_HITS> hits{};

  for (int r = r0; r <= r1; ++r) {
    int c0 = 0;
    int c1 = -1;
    pinFieldColumnRange(field, r, local.x, bound + d.radius, c0, c1);
    for (int c = c0; c <= c1; ++c) {
      const int pinIndex = r * d.cols + c;
      if (!field.present[static_cast<std::size_t>(pinIndex)]) continue;
      pin.center = field.worldPin(r, c);
      const CoreNearest nearest{coreOf(pin)};
      const int n = isBox ? boxHits(body, q, nearest, probeSetOf(pin), hits.data())
                          : capsuleHits(body, q, nearest, hits.data());
      applyProbeHits(body, hits.data(), n, d.restitution, d.friction, fieldId, pinIndex, nullptr);
    }
  }
}

void PhysicsWorld::resolveBoxBodyVsMover(BodyView& box, int moverIndex) {
  const KinematicMover& mover = movers_[static_cast<std::size_t>(moverIndex)];
  if (!groupsInteract(box.getMembership(), box.getFilter(), mover.membership, mover.filter)) return;
  const auto q = [&mover](const Vec3& c, float r, SurfaceHit& h) { return queryMover(mover, c, r, h); };
  const auto nearest = [&mover](const Vec3& p) {
    bool inside = false;
    const Vec3 local = closestPointOnVolume(mover.shape, mover.currentRot.conjugate().rotate(p - mover.currentPos),
                                            mover.halfExtents, inside);
    return mover.currentPos + mover.currentRot.rotate(local);
  };
  std::array<ProbeHit, MAX_BOX_HITS> hits{};
  const int n = boxHits(box, q, nearest, BoxProbeSet{}, hits.data());
  applyProbeHits(box, hits.data(), n, mover.restitution, mover.friction, KINEMATIC_MOVER_ID_BASE - moverIndex, 0,
                 &mover);
}

} // namespace pachinball
