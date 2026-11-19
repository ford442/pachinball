#pragma once

#include "BodyStore.h"
#include "KinematicMover.h"
#include "MathTypes.h"
#include "SensorVolume.h"
#include "StaticShapes.h"

#include <cstdint>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace pachinball {

struct PlaneDesc;
struct BoxDesc;
struct CapsuleDesc;
struct CylinderDesc;
struct TriangleMeshDesc;
struct MeshTriangle;

/**
 * Uniform 3D spatial hash (cubic cells) for the broadphase (#520 row 14).
 *
 * It used to hash XZ only, so a ball on a ramp paired with every static
 * stacked under it (the floor, a lower ramp, a toy's base). Cells are now
 * cubes keyed by (x, y, z), every static and body covers its world AABB on
 * all three axes, and the neighbour stencils are 3×3×3. Static boxes, sensors
 * and movers cover the AABB of their *rotated* half-extents — the XZ grid
 * used the unrotated ones, so a yawed wall was missing from the cells near
 * its ends and a ball there met nothing.
 */
class BroadphaseGrid {
public:
  struct Config {
    float minX = -14.f;
    float maxX =  14.f;
    float minY =  -2.f; ///< origin of the Y cells only: the hash is unbounded on every axis
    float minZ =  -2.f;
    float maxZ =  16.f;
    float cellSize = 0.44f; ///< ~2× ball diameter
  };

  struct StaticRef {
    enum Kind : uint8_t { Box = 0, Capsule = 1, Sensor = 2, Cylinder = 3, Sphere = 4, Triangle = 5, Cone = 6 };
    Kind  kind;
    /** Index into the matching world vector for this static kind. */
    int   index;
  };

  struct Pair {
    enum Type : uint8_t {
      BodyBody    = 0,
      BodyBox     = 1,
      BodyCapsule = 2,
      BodySensor  = 3,
      BodyMover   = 4,
      BodyCylinder = 5,
      BodySphere   = 6,
      BodyTriangle = 7,
      BodyCone     = 8,
      /** bodyB is a pin-field index; emitted by PhysicsWorld::appendPinFieldPairs, not the grid. */
      BodyPinField = 9,
    };
    Type type;
    int  bodyA;   ///< dense body index
    int  bodyB;   ///< dense body index (BodyBody), or static/sensor/mover vector index otherwise
  };

  explicit BroadphaseGrid();
  explicit BroadphaseGrid(const Config& config);

  void clearStatics();
  void insertStaticBox(int boxIndex, const BoxDesc& box);
  void insertStaticCapsule(int capIndex, const CapsuleDesc& cap);
  void insertSensorVolume(int sensorIndex, const SensorVolumeDesc& sensor);
  void insertStaticCylinder(int cylIndex, const CylinderDesc& cyl);
  void insertStaticSphere(int sphereIndex, const SphereDesc& sphere);
  void insertStaticCone(int coneIndex, const ConeDesc& cone);
  /** Mesh triangles are registered individually so the grid culls per triangle, not per mesh. */
  void insertTriangle(int triangleIndex, const MeshTriangle& tri);

  /**
   * Rebuild dynamic + kinematic-mover cell occupancy and emit collision
   * pairs for this substep. The static desc vectors are read live (by
   * the static index cached in each StaticRef) so a group-mask change takes
   * effect on the very next call with no separate cache to invalidate.
   * Movers move every tick, so their cell membership is rebuilt from
   * scratch here alongside the dynamic bodies.
   *
   * A sleeping Dynamic body stays in the grid as a target: an awake body
   * (a steered kinematic ball, one rolling in) pairs with it so contact can
   * wake it, but two sleepers never pair and a sleeper never meets statics.
   *
   * `previous` holds each body's pose at the start of the substep, dense-indexed
   * (see SensorVolume.h). A body that travelled is also paired with every sensor
   * its swept AABB reaches, so a thin volume crossed within the substep is still
   * a candidate; the narrowphase (resolveSphereVsSensor) decides whether it was
   * actually touched. Other static kinds are paired from the end pose only.
   */
  void buildPairs(const BodyStore& bodies,
                  const std::vector<BoxDesc>& boxes,
                  const std::vector<CapsuleDesc>& capsules,
                  const std::vector<CylinderDesc>& cylinders,
                  const std::vector<SphereDesc>& spheres,
                  const std::vector<ConeDesc>& cones,
                  const std::vector<SensorVolumeDesc>& sensors,
                  const std::vector<KinematicMover>& movers,
                  const std::vector<MeshTriangle>& triangles,
                  const std::vector<TriangleMeshDesc>& meshes,
                  const std::vector<Vec3>& previous,
                  std::vector<Pair>& outPairs);

  int lastPairCount() const { return lastPairCount_; }

  /**
   * Bound on |cell coordinate|. cellX / cellZ clamp the scaled position to it
   * before the float→int cast (and send NaN to cell 0): the bare cast was UB
   * for NaN, ±inf or anything past 2^31 cells — x86 produced INT_MIN while
   * aarch64 and WASM saturate — and the ±1 neighbour stencil then overflowed.
   * 1e8 cells of 0.44 m is 44,000 km, so no table coordinate moves cell; nor
   * is it clamped to the grid extent, which would re-bucket far bodies.
   */
  static constexpr float CELL_COORD_LIMIT = 1.0e8f;

  /** Cell coordinate of a world x / y / z (public for broadphase_test.cpp). */
  int cellX(float x) const;
  int cellY(float y) const;
  int cellZ(float z) const;

  /**
   * World-axis half-extents of a box with local `halfExtents` turned by
   * `rotation` (Σ |R_ij| h_j per axis). Also bounds a cylinder (r, hh, r) or
   * sphere (r, r, r) volume, which fits inside that box.
   */
  static Vec3 rotatedHalfExtents(const Quat& rotation, const Vec3& halfExtents);

private:
  struct CellKey {
    int cx;
    int cy;
    int cz;
    bool operator==(const CellKey& o) const { return cx == o.cx && cy == o.cy && cz == o.cz; }
  };

  struct CellKeyHash {
    std::size_t operator()(const CellKey& k) const {
      // Multiply in unsigned space: `int * 73856093` overflows (UB) for any
      // |cx| >= 30, i.e. a ball ~13 m from the origin at the default cell size.
      // The result is then reinterpreted as a signed 32-bit value so the
      // bucket assignment is bit-identical to the old two's-complement wrap.
      const auto mix = [](int v, std::uint32_t prime) {
        return static_cast<std::size_t>(
            static_cast<std::int32_t>(static_cast<std::uint32_t>(v) * prime));
      };
      return mix(k.cx, 73856093u) ^ mix(k.cy, 83492791u) ^ mix(k.cz, 19349663u);
    }
  };

  void cellsForAabb(const Vec3& lo, const Vec3& hi, std::vector<CellKey>& out) const;
  /** Cells of the AABB of an oriented box (or of a volume inside it), plus `margin`. */
  void cellsForObb(const Vec3& center, const Quat& rotation, const Vec3& halfExtents, float margin,
                   std::vector<CellKey>& out) const;
  /** Exact cell coverage of an oriented cylinder (local Y axis); cones use their bounding cylinder. */
  void cellsForCylinder(const Vec3& center, const Quat& rotation, float radius, float halfHeight,
                        std::vector<CellKey>& out) const;
  void addToCell(const CellKey& key, int dynamicDense);
  void addStaticToCell(const CellKey& key, StaticRef ref);
  void rebuildMoverCells(const std::vector<KinematicMover>& movers);

  Config config_;
  int gridCols_;
  int gridRows_;

  std::unordered_map<CellKey, std::vector<int>, CellKeyHash> dynamicCells_;
  /** Sleeping Dynamic bodies: paired against awake bodies only, never against each other. */
  std::unordered_map<CellKey, std::vector<int>, CellKeyHash> sleeperCells_;
  std::unordered_map<CellKey, std::vector<StaticRef>, CellKeyHash> staticCells_;
  std::unordered_map<CellKey, std::vector<int>, CellKeyHash> moverCells_;

  int lastPairCount_ = 0;
};

} // namespace pachinball
