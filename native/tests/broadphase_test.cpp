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
#include "test_helpers.hpp"

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

// ---- #520 row 14: the grid is 3D ------------------------------------------

TEST_CASE("cell coordinates cover y as well", "[broadphase][520]") {
  const BroadphaseGrid grid;  // minY -2, 0.44 m cells
  CHECK(grid.cellY(-2.f) == 0);
  CHECK(grid.cellY(0.f) == 4);
  CHECK(grid.cellY(3.f) == 11);
  CHECK(grid.cellY(1e25f) == static_cast<int>(BroadphaseGrid::CELL_COORD_LIMIT));
  CHECK(grid.cellY(NOT_A_NUMBER) == 0);
}

TEST_CASE("a ball on an upper deck does not pair with the floor under it", "[broadphase][520]") {
  // The XZ grid paired a ball with every static stacked below it: the floor,
  // the lower deck, whatever sat under the ramp.
  WorldParams params;
  params.gravity = {0.f, 0.f, 0.f};
  PhysicsWorld w(params);
  w.addStaticBox(0.f, -0.5f, 0.f, 6.f, 0.5f, 6.f, 0.f, 0.f, 0.f, 1.f);  // floor, top at y = 0
  w.addStaticBox(0.f, 2.75f, 0.f, 2.f, 0.25f, 2.f, 0.f, 0.f, 0.f, 1.f); // deck, top at y = 3
  RigidBodyDesc ball;
  ball.position = {0.5f, 3.2f, 0.5f};
  ball.radius = 0.2f;
  const int id = w.createRigidBody(ball);

  w.step(1.f / 60.f);
  CHECK(w.getLastBroadphasePairCount() == 1);  // the deck only

  w.setBodyPosition(id, 0.5f, 0.2f, 0.5f);
  w.step(1.f / 60.f);
  CHECK(w.getLastBroadphasePairCount() == 1);  // the floor only
}

TEST_CASE("a yawed static box covers the cells of its rotated extent", "[broadphase][520]") {
  // A 6 m wall yawed 90° about Y runs along z. The XZ grid inserted it with
  // its unrotated half-extents (x ±3, z ±0.1), so a ball rolling into it at
  // z = 2.5 found it in no cell and went straight through.
  WorldParams params;
  params.gravity = {0.f, 0.f, 0.f};
  PhysicsWorld w(params);
  w.addStaticBox(0.f, 0.5f, 0.f, 3.f, 0.5f, 0.1f, 0.f, 0.70710677f, 0.f, 0.70710677f, 0.f, 0.f);
  RigidBodyDesc ball;
  ball.position = {-1.f, 0.5f, 2.5f};
  ball.velocity = {3.f, 0.f, 0.f};
  ball.radius = 0.2f;
  ball.restitution = 0.f;
  const int id = w.createRigidBody(ball);
  for (int i = 0; i < 60; ++i) w.step(1.f / 60.f);

  const Vec3 p = test::readPos(w, id);
  CHECK(p.x < -0.25f);  // stopped by the wall's -x face (x = -0.1), not past it
  CHECK(p.x > -0.35f);
}
