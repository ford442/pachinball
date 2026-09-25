#include "BroadphaseGrid.h"
#include "CollisionFilter.h"
#include "Cylinder.h"
#include "PhysicsWorld.h"
#include "TriangleMesh.h"

#include <algorithm>
#include <cmath>

namespace pachinball {

BroadphaseGrid::BroadphaseGrid()
    : BroadphaseGrid(Config{}) {}

BroadphaseGrid::BroadphaseGrid(const Config& config)
    : config_(config) {
  gridCols_ = std::max(1, static_cast<int>(std::ceil((config_.maxX - config_.minX) / config_.cellSize)));
  gridRows_ = std::max(1, static_cast<int>(std::ceil((config_.maxZ - config_.minZ) / config_.cellSize)));
}

void BroadphaseGrid::clearStatics() {
  staticCells_.clear();
}

int BroadphaseGrid::cellX(float x) const {
  return static_cast<int>(std::floor((x - config_.minX) / config_.cellSize));
}

int BroadphaseGrid::cellZ(float z) const {
  return static_cast<int>(std::floor((z - config_.minZ) / config_.cellSize));
}

void BroadphaseGrid::cellsForAabb(float minX, float maxX, float minZ, float maxZ,
                                  std::vector<CellKey>& out) const {
  const int cx0 = cellX(minX);
  const int cx1 = cellX(maxX);
  const int cz0 = cellZ(minZ);
  const int cz1 = cellZ(maxZ);
  for (int cz = cz0; cz <= cz1; ++cz) {
    for (int cx = cx0; cx <= cx1; ++cx) {
      out.push_back({cx, cz});
    }
  }
}

void BroadphaseGrid::cellsForObb(const Vec3& center, const Vec3& halfExtents,
                                 std::vector<CellKey>& out) const {
  // Rotation-agnostic conservative bound: the OBB's XZ circumscribing radius.
  const float r = std::sqrt(halfExtents.x * halfExtents.x + halfExtents.z * halfExtents.z) + 0.05f;
  cellsForAabb(center.x - r, center.x + r, center.z - r, center.z + r, out);
}

void BroadphaseGrid::addStaticToCell(const CellKey& key, StaticRef ref) {
  staticCells_[key].push_back(ref);
}

void BroadphaseGrid::insertStaticBox(int boxIndex, const BoxDesc& box) {
  const Vec3 he = box.halfExtents;
  const float margin = 0.05f;
  std::vector<CellKey> cells;
  cellsForAabb(
    box.center.x - he.x - margin, box.center.x + he.x + margin,
    box.center.z - he.z - margin, box.center.z + he.z + margin,
    cells);
  StaticRef ref{StaticRef::Box, boxIndex};
  for (const auto& c : cells) {
    addStaticToCell(c, ref);
  }
}

void BroadphaseGrid::insertStaticCapsule(int capIndex, const CapsuleDesc& cap) {
  const Vec3 axisHalf = cap.rotation.rotate(Vec3{0.f, cap.halfHeight, 0.f});
  const Vec3 a = cap.center - axisHalf;
  const Vec3 b = cap.center + axisHalf;
  const float r = cap.radius + 0.05f;
  std::vector<CellKey> cells;
  cellsForAabb(
    std::min(a.x, b.x) - r, std::max(a.x, b.x) + r,
    std::min(a.z, b.z) - r, std::max(a.z, b.z) + r,
    cells);
  StaticRef ref{StaticRef::Capsule, capIndex};
  for (const auto& c : cells) {
    addStaticToCell(c, ref);
  }
}

void BroadphaseGrid::cellsForCylinder(const Vec3& center, const Quat& rotation,
                                      float radius, float halfHeight,
                                      std::vector<CellKey>& out) const {
  // Exact world AABB of a rotated cylinder: along world axis e the extent is
  // |halfHeight * a·e| + radius * sqrt(1 - (a·e)^2), where a is the rotated
  // local Y axis.
  const Vec3 a = rotation.rotate(Vec3{0.f, 1.f, 0.f});
  auto extent = [&](float ae) {
    const float perp = std::sqrt(std::max(0.f, 1.f - ae * ae));
    return std::fabs(halfHeight * ae) + radius * perp + 0.05f;
  };
  const float ex = extent(a.x);
  const float ez = extent(a.z);
  cellsForAabb(center.x - ex, center.x + ex, center.z - ez, center.z + ez, out);
}

void BroadphaseGrid::insertStaticCylinder(int cylIndex, const CylinderDesc& cyl) {
  std::vector<CellKey> cells;
  cellsForCylinder(cyl.center, cyl.rotation, cyl.radius, cyl.halfHeight, cells);
  StaticRef ref{StaticRef::Cylinder, cylIndex};
  for (const auto& c : cells) {
    addStaticToCell(c, ref);
  }
}

void BroadphaseGrid::insertStaticCone(int coneIndex, const ConeDesc& cone) {
  // A cone fits inside the cylinder of its base radius and height.
  std::vector<CellKey> cells;
  cellsForCylinder(cone.center, cone.rotation, cone.radius, cone.halfHeight, cells);
  StaticRef ref{StaticRef::Cone, coneIndex};
  for (const auto& c : cells) {
    addStaticToCell(c, ref);
  }
}

void BroadphaseGrid::insertStaticSphere(int sphereIndex, const SphereDesc& sphere) {
  const float r = sphere.radius + 0.05f;
  std::vector<CellKey> cells;
  cellsForAabb(sphere.center.x - r, sphere.center.x + r,
               sphere.center.z - r, sphere.center.z + r, cells);
  StaticRef ref{StaticRef::Sphere, sphereIndex};
  for (const auto& c : cells) {
    addStaticToCell(c, ref);
  }
}

void BroadphaseGrid::insertSensorVolume(int sensorIndex, const SensorVolumeDesc& sensor) {
  std::vector<CellKey> cells;
  cellsForObb(sensor.center, sensor.halfExtents, cells);
  StaticRef ref{StaticRef::Sensor, sensorIndex};
  for (const auto& c : cells) {
    addStaticToCell(c, ref);
  }
}

void BroadphaseGrid::insertTriangle(int triangleIndex, const MeshTriangle& tri) {
  const float margin = 0.05f;
  std::vector<CellKey> cells;
  cellsForAabb(
    std::min({tri.a.x, tri.b.x, tri.c.x}) - margin,
    std::max({tri.a.x, tri.b.x, tri.c.x}) + margin,
    std::min({tri.a.z, tri.b.z, tri.c.z}) - margin,
    std::max({tri.a.z, tri.b.z, tri.c.z}) + margin,
    cells);
  StaticRef ref{StaticRef::Triangle, triangleIndex};
  for (const auto& c : cells) {
    addStaticToCell(c, ref);
  }
}

void BroadphaseGrid::addToCell(const CellKey& key, int dynamicDense) {
  dynamicCells_[key].push_back(dynamicDense);
}

void BroadphaseGrid::rebuildMoverCells(const std::vector<KinematicMover>& movers) {
  moverCells_.clear();
  std::vector<CellKey> cells;
  for (int i = 0; i < static_cast<int>(movers.size()); ++i) {
    cells.clear();
    cellsForObb(movers[static_cast<std::size_t>(i)].currentPos,
               movers[static_cast<std::size_t>(i)].halfExtents, cells);
    for (const auto& c : cells) {
      moverCells_[c].push_back(i);
    }
  }
}

void BroadphaseGrid::buildPairs(const BodyStore& bodies,
                                const std::vector<BoxDesc>& boxes,
                                const std::vector<CapsuleDesc>& capsules,
                                const std::vector<CylinderDesc>& cylinders,
                                const std::vector<SphereDesc>& spheres,
                                const std::vector<ConeDesc>& cones,
                                const std::vector<SensorVolumeDesc>& sensors,
                                const std::vector<KinematicMover>& movers,
                                const std::vector<MeshTriangle>& triangles,
                                const std::vector<TriangleMeshDesc>& meshes,
                                std::vector<Pair>& outPairs) {
  outPairs.clear();
  dynamicCells_.clear();
  rebuildMoverCells(movers);

  const int n = bodies.denseCount();
  std::vector<CellKey> cells;
  cells.reserve(16);

  for (int i = 0; i < n; ++i) {
    if (!bodies.isAwake(i)) continue;
    if (static_cast<BodyType>(bodies.type(i)) == BodyType::Static) continue;

    const float px = bodies.posX(i);
    const float pz = bodies.posZ(i);
    float r = bodies.radius(i);
    const Shape shape = static_cast<Shape>(bodies.shape(i));
    if (shape == Shape::Capsule) {
      r += bodies.capsuleHalfHeight(i);
    } else if (shape == Shape::Box) {
      // Circumscribing radius, so any orientation is covered.
      r = bodies.boxHalfExtents(i).length();
    }
    cells.clear();
    cellsForAabb(px - r, px + r, pz - r, pz + r, cells);
    for (const auto& c : cells) {
      addToCell(c, i);
    }
  }

  // Two dedup sets, not one. A body-body key and a body-static key are built
  // from different fields and can collide numerically — pairKeyBody(0, 5) and
  // pairKeyStatic(0, 0, Pair::BodyCylinder) are both 5 — and a shared set
  // would let whichever is emitted first silently evict the other.
  std::unordered_set<uint64_t> seenBody;
  std::unordered_set<uint64_t> seenStatic;
  seenBody.reserve(1024);
  seenStatic.reserve(1024);

  auto pairKeyBody = [](int a, int b) -> uint64_t {
    const int lo = (a <= b) ? a : b;
    const int hi = (a <= b) ? b : a;
    return (static_cast<uint64_t>(static_cast<uint32_t>(lo)) << 32) |
           static_cast<uint32_t>(hi);
  };

  // Disjoint bit fields rather than XOR: the old `(idx << 1) ^ type` aliased
  // across kinds (idx 4/type 3 and idx 5/type 1 both hashed to 11), which
  // would silently drop a pair now that there are eight pair types and
  // per-triangle indices run high.
  auto pairKeyStatic = [](int body, int staticIdx, Pair::Type type) -> uint64_t {
    return (static_cast<uint64_t>(static_cast<uint32_t>(body)) << 32) |
           (static_cast<uint64_t>(static_cast<uint32_t>(staticIdx)) << 8) |
           static_cast<uint64_t>(type);
  };

  for (const auto& entry : dynamicCells_) {
    const auto& dynamics = entry.second;

    // Dynamic vs dynamic within cell (+ deterministic order)
    for (std::size_t ai = 0; ai < dynamics.size(); ++ai) {
      for (std::size_t bi = ai + 1; bi < dynamics.size(); ++bi) {
        const int a = dynamics[ai];
        const int b = dynamics[bi];
        if (!bodies.isAwake(a) || !bodies.isAwake(b)) continue;
        if (!groupsInteract(bodies.membership(a), bodies.filter(a),
                            bodies.membership(b), bodies.filter(b))) continue;
        const uint64_t key = pairKeyBody(a, b);
        if (!seenBody.insert(key).second) continue;
        outPairs.push_back({Pair::BodyBody, a, b});
      }
    }

    const auto sit = staticCells_.find(entry.first);
    if (sit != staticCells_.end()) {
      for (int bodyDense : dynamics) {
        if (!bodies.isAwake(bodyDense)) continue;
        for (const StaticRef& ref : sit->second) {
          Pair::Type ptype;
          uint32_t refMembership, refFilter;
          if (ref.kind == StaticRef::Box) {
            ptype = Pair::BodyBox;
            refMembership = boxes[static_cast<std::size_t>(ref.index)].membership;
            refFilter = boxes[static_cast<std::size_t>(ref.index)].filter;
          } else if (ref.kind == StaticRef::Capsule) {
            ptype = Pair::BodyCapsule;
            refMembership = capsules[static_cast<std::size_t>(ref.index)].membership;
            refFilter = capsules[static_cast<std::size_t>(ref.index)].filter;
          } else if (ref.kind == StaticRef::Cylinder) {
            ptype = Pair::BodyCylinder;
            refMembership = cylinders[static_cast<std::size_t>(ref.index)].membership;
            refFilter = cylinders[static_cast<std::size_t>(ref.index)].filter;
          } else if (ref.kind == StaticRef::Sphere) {
            ptype = Pair::BodySphere;
            refMembership = spheres[static_cast<std::size_t>(ref.index)].membership;
            refFilter = spheres[static_cast<std::size_t>(ref.index)].filter;
          } else if (ref.kind == StaticRef::Triangle) {
            ptype = Pair::BodyTriangle;
            const int meshIndex = triangles[static_cast<std::size_t>(ref.index)].meshIndex;
            refMembership = meshes[static_cast<std::size_t>(meshIndex)].membership;
            refFilter = meshes[static_cast<std::size_t>(meshIndex)].filter;
          } else if (ref.kind == StaticRef::Cone) {
            ptype = Pair::BodyCone;
            refMembership = cones[static_cast<std::size_t>(ref.index)].membership;
            refFilter = cones[static_cast<std::size_t>(ref.index)].filter;
          } else {
            ptype = Pair::BodySensor;
            refMembership = sensors[static_cast<std::size_t>(ref.index)].membership;
            refFilter = sensors[static_cast<std::size_t>(ref.index)].filter;
          }
          if (!groupsInteract(bodies.membership(bodyDense), bodies.filter(bodyDense),
                              refMembership, refFilter)) continue;
          const uint64_t key = pairKeyStatic(bodyDense, ref.index, ptype);
          if (!seenStatic.insert(key).second) continue;
          outPairs.push_back({ptype, bodyDense, ref.index});
        }
      }
    }

    const auto mit = moverCells_.find(entry.first);
    if (mit != moverCells_.end()) {
      for (int bodyDense : dynamics) {
        if (!bodies.isAwake(bodyDense)) continue;
        for (int moverIdx : mit->second) {
          const KinematicMover& mover = movers[static_cast<std::size_t>(moverIdx)];
          if (!groupsInteract(bodies.membership(bodyDense), bodies.filter(bodyDense),
                              mover.membership, mover.filter)) continue;
          const uint64_t key = pairKeyStatic(bodyDense, moverIdx, Pair::BodyMover);
          if (!seenStatic.insert(key).second) continue;
          outPairs.push_back({Pair::BodyMover, bodyDense, moverIdx});
        }
      }
    }
  }

  // Neighbor cell dynamic-dynamic pairs (3×3 stencil)
  for (const auto& entry : dynamicCells_) {
    const CellKey base = entry.first;
    const auto& dynamics = entry.second;
    for (int dz = -1; dz <= 1; ++dz) {
      for (int dx = -1; dx <= 1; ++dx) {
        if (dx == 0 && dz == 0) continue;
        const CellKey neighbor{base.cx + dx, base.cz + dz};
        const auto nit = dynamicCells_.find(neighbor);
        if (nit == dynamicCells_.end()) continue;
        const auto& other = nit->second;
        for (int a : dynamics) {
          for (int b : other) {
            if (a >= b) continue;
            if (!bodies.isAwake(a) || !bodies.isAwake(b)) continue;
            if (!groupsInteract(bodies.membership(a), bodies.filter(a),
                                bodies.membership(b), bodies.filter(b))) continue;
            const uint64_t key = pairKeyBody(a, b);
            if (!seenBody.insert(key).second) continue;
            outPairs.push_back({Pair::BodyBody, a, b});
          }
        }
      }
    }
  }

  std::sort(outPairs.begin(), outPairs.end(), [](const Pair& p, const Pair& q) {
    if (p.type != q.type) return p.type < q.type;
    if (p.bodyA != q.bodyA) return p.bodyA < q.bodyA;
    return p.bodyB < q.bodyB;
  });

  lastPairCount_ = static_cast<int>(outPairs.size());
}

} // namespace pachinball
