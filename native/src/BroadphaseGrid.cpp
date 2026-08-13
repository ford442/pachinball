#include "BroadphaseGrid.h"
#include "PhysicsWorld.h"

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

void BroadphaseGrid::addToCell(const CellKey& key, int dynamicDense) {
  dynamicCells_[key].push_back(dynamicDense);
}

void BroadphaseGrid::buildPairs(const BodyStore& bodies, std::vector<Pair>& outPairs) {
  outPairs.clear();
  dynamicCells_.clear();

  const int n = bodies.denseCount();
  std::vector<CellKey> cells;
  cells.reserve(16);

  for (int i = 0; i < n; ++i) {
    if (!bodies.isAwake(i)) continue;
    if (static_cast<BodyType>(bodies.type(i)) == BodyType::Static) continue;

    const float px = bodies.posX(i);
    const float pz = bodies.posZ(i);
    const float r = bodies.radius(i);
    cells.clear();
    cellsForAabb(px - r, px + r, pz - r, pz + r, cells);
    for (const auto& c : cells) {
      addToCell(c, i);
    }
  }

  std::unordered_set<uint64_t> seen;
  seen.reserve(1024);

  auto pairKeyBody = [](int a, int b) -> uint64_t {
    const int lo = (a <= b) ? a : b;
    const int hi = (a <= b) ? b : a;
    return (static_cast<uint64_t>(static_cast<uint32_t>(lo)) << 32) |
           static_cast<uint32_t>(hi);
  };

  auto pairKeyStatic = [](int body, int staticIdx, Pair::Type type) -> uint64_t {
    return (static_cast<uint64_t>(static_cast<uint32_t>(body)) << 32) ^
           (static_cast<uint64_t>(staticIdx) << 1) ^
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
        const uint64_t key = pairKeyBody(a, b);
        if (!seen.insert(key).second) continue;
        outPairs.push_back({Pair::BodyBody, a, b});
      }
    }

    const auto sit = staticCells_.find(entry.first);
    if (sit == staticCells_.end()) continue;

    for (int bodyDense : dynamics) {
      if (!bodies.isAwake(bodyDense)) continue;
      for (const StaticRef& ref : sit->second) {
        const Pair::Type ptype = (ref.kind == StaticRef::Box) ? Pair::BodyBox : Pair::BodyCapsule;
        const uint64_t key = pairKeyStatic(bodyDense, ref.index, ptype);
        if (!seen.insert(key).second) continue;
        outPairs.push_back({ptype, bodyDense, ref.index});
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
            const uint64_t key = pairKeyBody(a, b);
            if (!seen.insert(key).second) continue;
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
