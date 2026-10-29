/**
 * BroadphaseGrid cell arithmetic at the edges of float (#487 slice 1a).
 *
 * cellX / cellZ used to cast `floor((x - min) / cellSize)` straight to int:
 * UB for NaN, ±inf or anything past ±2^31 cells (x86 then yields INT_MIN,
 * aarch64 and WASM saturate, so the three builds disagreed), and the 3×3
 * neighbour stencil then overflowed `cx + dx`. The clamp must not move a
 * single playfield coordinate to another cell.
 *
 *   npm run test:native            # values
 *   CXX=clang++ npm run test:native:san   # float-cast-overflow / overflow reports
 */

#include "BroadphaseGrid.h"
#include "PhysicsWorld.h"

#include <catch2/catch_test_macros.hpp>

#include <limits>
#include <vector>

using namespace pachinball;

namespace {

constexpr float INF = std::numeric_limits<float>::infinity();
const float NOT_A_NUMBER = std::numeric_limits<float>::quiet_NaN();

RigidBodyDesc ballAt(float x, float z) {
  RigidBodyDesc d;
  d.position = {x, 0.2f, z};
  d.radius = 0.2f;
  return d;
}

} // namespace

TEST_CASE("cell coordinates clamp before the int cast", "[broadphase]") {
  const BroadphaseGrid grid;  // default config: minX -14, minZ -2, 0.44 m cells
  const int limit = static_cast<int>(BroadphaseGrid::CELL_COORD_LIMIT);

  // Recorded on the unclamped cast: playfield coordinates keep their cells.
  CHECK(grid.cellX(12.34f) == 59);
  CHECK(grid.cellX(12.50f) == 60);
  CHECK(grid.cellZ(-56.78f) == -125);
  CHECK(grid.cellZ(-56.70f) == -125);
  CHECK(grid.cellX(-14.f) == 0);
  CHECK(grid.cellX(-14.5f) == -2);
  CHECK(grid.cellX(0.f) == 31);
  CHECK(grid.cellZ(16.f) == 40);
  CHECK(grid.cellX(1000.f) == 2304);

  // Far-off and non-finite coordinates land in finite cells, not in UB.
  CHECK(grid.cellX(1e25f) == limit);
  CHECK(grid.cellZ(-1e25f) == -limit);
  CHECK(grid.cellX(3.4e38f) == limit);
  CHECK(grid.cellX(INF) == limit);
  CHECK(grid.cellZ(-INF) == -limit);
  CHECK(grid.cellX(NOT_A_NUMBER) == 0);
  CHECK(grid.cellZ(NOT_A_NUMBER) == 0);
  // The ±1 neighbour stencil cannot leave int.
  STATIC_REQUIRE(static_cast<long long>(BroadphaseGrid::CELL_COORD_LIMIT) + 1 <
                 static_cast<long long>(std::numeric_limits<int>::max()));
}

TEST_CASE("extreme bodies pair with nothing and leave an ordinary pair as it was", "[broadphase]") {
  HandleTable handles;
  BodyStore bodies;
  const int a = bodies.create(handles, ballAt(12.34f, -56.78f));
  const int b = bodies.create(handles, ballAt(12.50f, -56.70f));
  bodies.create(handles, ballAt(1e25f, -1e25f));
  bodies.create(handles, ballAt(-INF, 3.4e38f));
  bodies.create(handles, ballAt(INF, NOT_A_NUMBER));
  bodies.create(handles, ballAt(NOT_A_NUMBER, NOT_A_NUMBER));

  BroadphaseGrid grid;
  std::vector<BroadphaseGrid::Pair> pairs;
  grid.buildPairs(bodies, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, pairs);

  REQUIRE(pairs.size() == 1);
  CHECK(pairs[0].type == BroadphaseGrid::Pair::BodyBody);
  CHECK(bodies.publicIdAt(pairs[0].bodyA) == a);
  CHECK(bodies.publicIdAt(pairs[0].bodyB) == b);
}
