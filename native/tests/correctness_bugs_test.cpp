/**
 * Regression tests for the #504 §1 correctness bugs (rows 4, 7, 8).
 *
 *   npm run test:native
 */

#include "PhysicsWorld.h"
#include "test_helpers.hpp"

#include <catch2/catch_test_macros.hpp>

#include <cstdint>
#include <cstring>
#include <limits>
#include <vector>

using namespace pachinball;
using namespace pachinball::test;

namespace {

void patchWord(std::vector<uint8_t>& blob, std::size_t word, uint32_t v) {
  std::memcpy(blob.data() + word * 4, &v, 4);
}

uint32_t floatBits(float f) {
  uint32_t u;
  std::memcpy(&u, &f, 4);
  return u;
}

} // namespace

TEST_CASE("sphere deep inside a box exits through the nearest z face (#504 row 4)", "[narrowphase]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  // Thin in z: the shallowest face is +z (0.2 - 0.15 = 0.05).
  world.addStaticBox(0.f, 0.f, 0.f, 1.f, 1.f, 0.2f, 0.f, 0.f, 0.f, 1.f);
  const int ball = world.createRigidBody({
    {0.f, 0.f, 0.15f}, {0.f, 0.f, 0.f}, 1.f, 0.25f, 0.f, 0.f, BodyType::Dynamic
  });
  world.step(FIXED_DT);
  const Vec3 p = readPos(world, ball);
  CHECK(p.z > 0.15f);
  // Pushed out by (radius + 0.05) at most per iteration batch, not ~0.84 m.
  CHECK(p.z < 0.6f);
}

TEST_CASE("sphere entering a box from below is pushed down, not up (#504 row 4)", "[narrowphase]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  world.addStaticBox(0.f, 0.f, 0.f, 2.f, 0.5f, 2.f, 0.f, 0.f, 0.f, 1.f);
  const int ball = world.createRigidBody({
    {0.f, -0.45f, 0.f}, {0.f, 0.f, 0.f}, 1.f, 0.25f, 0.f, 0.f, BodyType::Dynamic
  });
  world.step(FIXED_DT);
  CHECK(readPos(world, ball).y < -0.45f);
}

TEST_CASE("snapshot restore rejects out-of-range world params (#504 row 7)", "[snapshot]") {
  PhysicsWorld world;
  world.createRigidBody({{0.f, 1.f, 0.f}, {0.f, 0.f, 0.f}, 1.f, 0.25f, 0.f, 0.f, BodyType::Dynamic});
  world.step(FIXED_DT);
  const std::vector<uint8_t> blob = world.serialize();
  const std::vector<uint8_t> before = world.serialize();

  // Params follow the header, the u64 step count and the f32 accumulator:
  // gravity(3) fixedTimestep maxSubsteps solverIterations ...
  const std::size_t paramsWord = SNAPSHOT_HEADER_WORDS + 2 + 1;
  const std::size_t dtWord = paramsWord + 3;
  const std::size_t itersWord = paramsWord + 5;

  REQUIRE(world.restore(blob.data(), blob.size()) == SnapshotStatus::Ok);

  std::vector<uint8_t> bad = blob;
  patchWord(bad, itersWord, 1000000000u);
  CHECK(world.restore(bad.data(), bad.size()) == SnapshotStatus::Corrupt);

  bad = blob;
  patchWord(bad, itersWord, 0u);
  CHECK(world.restore(bad.data(), bad.size()) == SnapshotStatus::Corrupt);

  for (float dt : {0.f, -1.f / 60.f, std::numeric_limits<float>::quiet_NaN(),
                   std::numeric_limits<float>::infinity()}) {
    bad = blob;
    patchWord(bad, dtWord, floatBits(dt));
    CHECK(world.restore(bad.data(), bad.size()) == SnapshotStatus::Corrupt);
  }

  CHECK((world.serialize() == before));
}

TEST_CASE("setBodyRotation wakes a sleeping body (#504 row 8)", "[sleep]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  const int ball = world.createRigidBody({
    {0.f, 0.f, 0.f}, {0.f, 0.f, 0.f}, 1.f, 0.25f, 0.f, 0.f, BodyType::Dynamic
  });
  stepFixed(world, 200);
  REQUIRE(world.getActiveBodyCount() == 0);
  world.setBodyRotation(ball, 0.f, 0.f, 0.70710678f, 0.70710678f);
  CHECK(world.getActiveBodyCount() == 1);
}
