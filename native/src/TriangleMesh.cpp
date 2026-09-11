/**
 * Static triangle-soup narrowphase: closest-point-on-triangle plus the
 * sphere resolver. Adventure ramps, walls, floors and basins export through
 * this path; round geometry (pins, pylons, rotators) stays analytic in
 * Cylinder.cpp so rebounds keep their exact profile.
 */
#include "TriangleMesh.h"
#include "CollisionFilter.h"
#include "PhysicsWorld.h"

#include <algorithm>
#include <cmath>

namespace pachinball {

Vec3 closestPointOnTriangle(const Vec3& p, const Vec3& a, const Vec3& b, const Vec3& c,
                            bool& outOnFace) {
  outOnFace = false;

  const Vec3 ab = b - a;
  const Vec3 ac = c - a;
  const Vec3 ap = p - a;

  const float d1 = ab.dot(ap);
  const float d2 = ac.dot(ap);
  if (d1 <= 0.f && d2 <= 0.f) return a; // vertex region A

  const Vec3 bp = p - b;
  const float d3 = ab.dot(bp);
  const float d4 = ac.dot(bp);
  if (d3 >= 0.f && d4 <= d3) return b; // vertex region B

  const float vc = d1 * d4 - d3 * d2;
  if (vc <= 0.f && d1 >= 0.f && d3 <= 0.f) {
    const float denom = d1 - d3;
    const float v = denom > 1e-12f ? d1 / denom : 0.f;
    return a + ab * v; // edge region AB
  }

  const Vec3 cp = p - c;
  const float d5 = ab.dot(cp);
  const float d6 = ac.dot(cp);
  if (d6 >= 0.f && d5 <= d6) return c; // vertex region C

  const float vb = d5 * d2 - d1 * d6;
  if (vb <= 0.f && d2 >= 0.f && d6 <= 0.f) {
    const float denom = d2 - d6;
    const float w = denom > 1e-12f ? d2 / denom : 0.f;
    return a + ac * w; // edge region AC
  }

  const float va = d3 * d6 - d5 * d4;
  if (va <= 0.f && (d4 - d3) >= 0.f && (d5 - d6) >= 0.f) {
    const float denom = (d4 - d3) + (d5 - d6);
    const float w = denom > 1e-12f ? (d4 - d3) / denom : 0.f;
    return b + (c - b) * w; // edge region BC
  }

  const float denom = va + vb + vc;
  if (denom <= 1e-12f) return a; // degenerate (zero-area) triangle
  const float invDenom = 1.f / denom;
  outOnFace = true;
  return a + ab * (vb * invDenom) + ac * (vc * invDenom);
}

int PhysicsWorld::addStaticTriangleMesh(const float* vertices, int vertexCount,
                                        const uint32_t* indices, int indexCount,
                                        float restitution, float friction,
                                        bool doubleSided) {
  TriangleMeshDesc mesh;
  mesh.restitution = restitution;
  mesh.friction = friction;
  mesh.doubleSided = doubleSided;
  mesh.firstTriangle = static_cast<int>(triangles_.size());

  const int meshIndex = static_cast<int>(meshes_.size());

  if (vertices && indices && vertexCount > 0) {
    auto vertexAt = [vertices, vertexCount](uint32_t i) -> Vec3 {
      if (i >= static_cast<uint32_t>(vertexCount)) return Vec3::zero();
      const std::size_t o = static_cast<std::size_t>(i) * 3u;
      return {vertices[o], vertices[o + 1], vertices[o + 2]};
    };

    for (int i = 0; i + 2 < indexCount; i += 3) {
      MeshTriangle tri;
      tri.a = vertexAt(indices[i]);
      tri.b = vertexAt(indices[i + 1]);
      tri.c = vertexAt(indices[i + 2]);

      // CCW winding gives the front face; zero-area triangles have no usable
      // normal, so they are dropped rather than poisoning the narrowphase.
      const Vec3 cross = (tri.b - tri.a).cross(tri.c - tri.a);
      const float area2 = cross.length();
      if (area2 < 1e-9f) continue;
      tri.normal = cross / area2;
      tri.meshIndex = meshIndex;

      const int triIndex = static_cast<int>(triangles_.size());
      triangles_.push_back(tri);
      broadphase_.insertTriangle(triIndex, tri);
    }
  }

  mesh.triangleCount = static_cast<int>(triangles_.size()) - mesh.firstTriangle;
  meshes_.push_back(mesh);
  return STATIC_MESH_ID_BASE - meshIndex;
}

void PhysicsWorld::resolveSphereVsTriangle(BodyView& body, int triangleIndex) {
  const MeshTriangle& tri = triangles_[static_cast<std::size_t>(triangleIndex)];
  const TriangleMeshDesc& mesh = meshes_[static_cast<std::size_t>(tri.meshIndex)];
  if (!groupsInteract(body.getMembership(), body.getFilter(), mesh.membership, mesh.filter)) return;

  const Vec3 center = body.getPosition();
  bool onFace = false;
  const Vec3 closest = closestPointOnTriangle(center, tri.a, tri.b, tri.c, onFace);

  const Vec3 delta = center - closest;
  const float distSq = delta.lengthSq();
  const float radius = body.getRadius();
  if (distSq >= radius * radius) return;

  const float side = delta.dot(tri.normal);
  Vec3 normal;
  if (onFace) {
    // Flat-face contact: use the face normal so coplanar triangles sharing an
    // edge present one seamless surface and a rolling ball feels no seam.
    if (side < 0.f) {
      if (!mesh.doubleSided) return;
      normal = tri.normal * -1.f;
    } else {
      normal = tri.normal;
    }
  } else {
    // Edge / vertex contact: the delta direction is the true separating
    // axis. Reject approaches from behind the face unless double-sided, which
    // is what keeps a ball from catching on the underside of a ramp seam.
    if (side <= 0.f && !mesh.doubleSided) return;
    if (distSq < 1e-10f) return; // exactly on the boundary — no usable direction
    normal = delta / std::sqrt(distSq);
  }

  const float dist = std::sqrt(distSq);
  const float penetration = onFace ? radius - std::fabs(side) : radius - dist;
  if (penetration <= 0.f) return;

  const float velN = body.getVelocity().dot(normal);
  if (velN >= 0.5f) return;

  const float e = std::min(body.getRestitution(), mesh.restitution);
  const Vec3 contactPoint = center - normal * radius;
  const float mu = std::sqrt(std::max(body.getFriction(), 0.f) * std::max(mesh.friction, 0.f));
  const float j = applyContactImpulse(body, nullptr, contactPoint, normal, e, mu, penetration);

  constexpr float SLOP    = 0.001f;
  constexpr float CORRECT = 0.8f;
  if (penetration > SLOP && body.getType() == BodyType::Dynamic) {
    body.setPosition(body.getPosition() + normal * ((penetration - SLOP) * CORRECT));
  }

  // All triangles of a mesh report the mesh handle, so a ball crossing a
  // seam produces one continuous Enter/Stay rather than an Exit/Enter pair.
  ContactEvent evt;
  evt.bodyId1 = body.getId();
  evt.bodyId2 = STATIC_MESH_ID_BASE - tri.meshIndex;
  evt.normal  = normal;
  evt.point   = contactPoint;
  evt.impulse = j;
  contactListener_.pushContact(evt);
}

} // namespace pachinball
