#pragma once

#include "BodyStore.h"
#include "MathTypes.h"

#include <cstdint>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace pachinball {

struct PlaneDesc;
struct BoxDesc;
struct CapsuleDesc;

/** Uniform XZ spatial hash for sphere/capsule broadphase on the playfield. */
class BroadphaseGrid {
public:
  struct Config {
    float minX = -14.f;
    float maxX =  14.f;
    float minZ =  -2.f;
    float maxZ =  16.f;
    float cellSize = 0.44f; ///< ~2× ball diameter
  };

  struct StaticRef {
    enum Kind : uint8_t { Box = 0, Capsule = 1 };
    Kind  kind;
    int   index; ///< index into boxes_ or capsules_ vector
  };

  struct Pair {
    enum Type : uint8_t {
      BodyBody = 0,
      BodyBox = 1,
      BodyCapsule = 2,
    };
    Type type;
    int  bodyA;   ///< dense body index
    int  bodyB;   ///< dense body index (BodyBody) or static index (BodyBox/BodyCapsule)
  };

  explicit BroadphaseGrid();
  explicit BroadphaseGrid(const Config& config);

  void clearStatics();
  void insertStaticBox(int boxIndex, const BoxDesc& box);
  void insertStaticCapsule(int capIndex, const CapsuleDesc& cap);

  /** Rebuild dynamic cell occupancy and emit collision pairs for this substep. */
  void buildPairs(const BodyStore& bodies, std::vector<Pair>& outPairs);

  int lastPairCount() const { return lastPairCount_; }

private:
  struct CellKey {
    int cx;
    int cz;
    bool operator==(const CellKey& o) const { return cx == o.cx && cz == o.cz; }
  };

  struct CellKeyHash {
    std::size_t operator()(const CellKey& k) const {
      return static_cast<std::size_t>(k.cx * 73856093) ^
             static_cast<std::size_t>(k.cz * 19349663);
    }
  };

  int cellX(float x) const;
  int cellZ(float z) const;
  void cellsForAabb(float minX, float maxX, float minZ, float maxZ,
                    std::vector<CellKey>& out) const;
  void addToCell(const CellKey& key, int dynamicDense);
  void addStaticToCell(const CellKey& key, StaticRef ref);

  Config config_;
  int gridCols_;
  int gridRows_;

  std::unordered_map<CellKey, std::vector<int>, CellKeyHash> dynamicCells_;
  std::unordered_map<CellKey, std::vector<StaticRef>, CellKeyHash> staticCells_;

  std::vector<Pair> scratchPairs_;
  int lastPairCount_ = 0;
};

} // namespace pachinball
