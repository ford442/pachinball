#pragma once

#include "CollisionFilter.h"
#include "MathTypes.h"

#include <cstdint>
#include <vector>

namespace pachinball {

/**
 * One triangle of a static mesh, pre-transformed into world space and stored
 * denormalized (vertices + face normal inline) so the narrowphase inner loop
 * is a flat, branch-free read with no indirection through a vertex table.
 * `-msimd128` auto-vectorizes over this layout.
 *
 * Meshes are immutable once added, so a triangle's index in the world's flat
 * triangle array is stable — that index is what BroadphaseGrid caches.
 */
struct MeshTriangle {
  Vec3 a = Vec3::zero();
  Vec3 b = Vec3::zero();
  Vec3 c = Vec3::zero();
  Vec3 normal = Vec3::up(); ///< Unit face normal, from CCW winding.
  int  meshIndex = 0;       ///< Owning mesh; material + groups are read from it.
};

/**
 * Material and collision-group state for one static triangle mesh. Kept
 * separate from the triangles themselves so `setCollisionGroups` on a mesh
 * handle is O(1) and the broadphase still reads group masks live, exactly as
 * it does for boxes and capsules.
 */
struct TriangleMeshDesc {
  float    restitution = 0.4f;
  float    friction    = 0.2f;
  /**
   * When false (the default) triangles collide only from their front face —
   * the side the CCW winding normal points at. One-sided contact is what
   * stops a ball tunnelling up through the underside of a ramp, and it makes
   * the shared-edge normal choice below unambiguous.
   */
  bool     doubleSided = false;
  uint32_t membership  = COLLISION_GROUPS_ALL;
  uint32_t filter      = COLLISION_GROUPS_ALL;
  int      firstTriangle = 0;
  int      triangleCount = 0;
};

/** Negative-id base for static triangle meshes in contact events / setCollisionGroups. */
static constexpr int STATIC_MESH_ID_BASE = -6000;

/**
 * Closest point on triangle (a, b, c) to `p` — Ericson, *Real-Time Collision
 * Detection* §5.1.5, via barycentric voronoi regions.
 *
 * `outOnFace` reports whether the closest point landed in the face interior
 * rather than on an edge or vertex. The caller uses that to pick the contact
 * normal: face contacts take the flat face normal (so a ball crossing the
 * shared diagonal of a quad feels one continuous surface instead of a seam),
 * while edge and vertex contacts take the true delta direction.
 */
Vec3 closestPointOnTriangle(const Vec3& p, const Vec3& a, const Vec3& b, const Vec3& c,
                            bool& outOnFace);

} // namespace pachinball
