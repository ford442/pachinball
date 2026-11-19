#pragma once

/**
 * Sphere-vs-static geometric queries (#520 row 4): where a sphere of radius
 * `r` centred at `c` overlaps a static collider, the outward contact normal
 * (from the static toward the sphere) and the penetration depth.
 *
 * One query per static family, shared by the sphere resolvers (a ball is
 * one probe at its centre — their arithmetic is the one they always had,
 * expression for expression) and by the capsule / box resolvers in
 * ShapeContacts.cpp, which probe a body at several points: a capsule as
 * spheres of its radius along its segment, a box as zero-radius points (its
 * corners and its point nearest the static). `r` may be 0: every query then
 * answers whether the point is strictly inside.
 *
 * Pure geometry: no collision groups, no velocity gate, no impulse.
 */

#include "KinematicMover.h"
#include "MathTypes.h"
#include "StaticShapes.h"
#include "TriangleMesh.h"

namespace pachinball {

struct SurfaceHit {
  Vec3  normal = Vec3::up();
  float penetration = 0.f;
};

bool queryPlane(const PlaneDesc& plane, const Vec3& c, float r, SurfaceHit& hit);
bool queryBox(const BoxDesc& box, const Vec3& c, float r, SurfaceHit& hit);
bool queryCapsule(const CapsuleDesc& cap, const Vec3& c, float r, SurfaceHit& hit);
bool queryCylinder(const CylinderDesc& cyl, const Vec3& c, float r, SurfaceHit& hit);
bool querySphere(const SphereDesc& sphere, const Vec3& c, float r, SurfaceHit& hit);
bool queryCone(const ConeDesc& cone, const Vec3& c, float r, SurfaceHit& hit);
/** One-sided unless `doubleSided`: a sphere behind the face (or past an edge from behind) is no contact. */
bool queryTriangle(const MeshTriangle& tri, bool doubleSided, const Vec3& c, float r, SurfaceHit& hit);
/** Against a mover's volume at its current pose. */
bool queryMover(const KinematicMover& mover, const Vec3& c, float r, SurfaceHit& hit);

/** Closest point to `p` on segment [a, b]. */
Vec3 closestOnSegment(const Vec3& p, const Vec3& a, const Vec3& b);

/**
 * The "core" of a static, as a segment: the set every surface point is
 * nearest to — a sphere's centre, a capsule's segment, a cylinder's or
 * cone's axis. Probes start from the body point nearest it.
 */
struct CoreSegment {
  Vec3 a;
  Vec3 b;
};
CoreSegment coreOf(const CapsuleDesc& cap);
CoreSegment coreOf(const CylinderDesc& cyl);
CoreSegment coreOf(const ConeDesc& cone);
CoreSegment coreOf(const SphereDesc& sphere);

} // namespace pachinball
