/**
 * Native unit tests for PhysicsWorld (no browser / Emscripten required).
 *
 * Build & run:
 *   npm run test:native
 *   # or:
 *   cmake -S native -B native/build-native
 *   cmake --build native/build-native
 *   ctest --test-dir native/build-native --output-on-failure
 */

#include "PhysicsWorld.h"
#include "test_helpers.hpp"

#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <iterator>

using namespace pachinball;
using namespace pachinball::test;

TEST_CASE("gravity integration", "[physics]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);

  const int ball = world.createRigidBody({
    {0.f, 1.f, 0.f}, {0.f, 0.f, 0.f},
    1.f, 0.1f, 0.4f, 0.f, BodyType::Dynamic
  });

  stepFixed(world, 1);

  const Vec3 vel = readVel(world, ball);
  const Vec3 pos = readPos(world, ball);

  const float expectedVy = -9.81f * FIXED_DT;
  const float expectedY  = 1.f + expectedVy * FIXED_DT;

  CHECK(near(vel.y, expectedVy, 1e-4f));
  CHECK(near(pos.y, expectedY, 1e-4f));
}

TEST_CASE("sphere-sphere contact", "[physics]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  const int a = world.createRigidBody({
    {-0.2f, 0.f, 0.f}, {-1.f, 0.f, 0.f},
    1.f, 0.25f, 0.5f, 0.f, BodyType::Dynamic
  });
  const int b = world.createRigidBody({
    {0.2f, 0.f, 0.f}, {1.f, 0.f, 0.f},
    1.f, 0.25f, 0.5f, 0.f, BodyType::Dynamic
  });

  stepFixed(world, 10);

  const Vec3 posA = readPos(world, a);
  const Vec3 posB = readPos(world, b);
  const Vec3 velA = readVel(world, a);
  const Vec3 velB = readVel(world, b);

  const float separation = (posA - posB).length();
  CHECK(separation >= 0.49f);

  const Vec3 relVel = velA - velB;
  const Vec3 normal = (posA - posB).normalized();
  const float velAlongN = relVel.dot(normal);
  CHECK(velAlongN >= -0.1f);
}

TEST_CASE("sphere-plane bounce restitution", "[physics]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);
  world.addStaticPlane(0.f, 1.f, 0.f, 0.f);

  constexpr float restitution = 0.6f;
  const int ball = world.createRigidBody({
    {0.f, 2.f, 0.f}, {0.f, 0.f, 0.f},
    1.f, 0.25f, restitution, 0.f, BodyType::Dynamic
  });

  float vyIn = 0.f;
  float vyOut = 0.f;
  bool contacted = false;

  for (int i = 0; i < 120; ++i) {
    const float vyBefore = readVel(world, ball).y;
    world.step(FIXED_DT);
    const float vyAfter = readVel(world, ball).y;

    if (!contacted && vyBefore < -0.5f && vyAfter > 0.f) {
      vyIn = vyBefore;
      vyOut = vyAfter;
      contacted = true;
      break;
    }
  }

  REQUIRE(contacted);
  const float ratio = vyOut / std::fabs(vyIn);
  CHECK(ratio > 0.4f);
  CHECK(ratio < 0.8f);
}

TEST_CASE("energy non-explosion (60 steps)", "[physics]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);
  world.addStaticBox(0.f, 0.f, 0.f, 3.f, 2.f, 3.f, 0.f, 0.f, 0.f, 1.f, 0.5f);

  const float positions[][3] = {
    {-1.f, 3.f, -1.f}, {1.f, 3.5f, 0.f}, {0.f, 4.f, 1.f},
    {-0.5f, 3.2f, 0.5f}, {1.5f, 3.8f, -0.5f}, {0.f, 3.f, -1.5f},
    {-1.5f, 4.f, 0.f}, {0.5f, 3.5f, 1.5f},
  };

  for (const auto& p : positions) {
    world.createRigidBody({
      {p[0], p[1], p[2]}, {0.f, 0.f, 0.f},
      1.f, 0.2f, 0.5f, 0.02f, BodyType::Dynamic
    });
  }

  stepFixed(world, 60);

  for (int id = 0; id < static_cast<int>(std::size(positions)); ++id) {
    const Vec3 pos = readPos(world, id);
    const Vec3 vel = readVel(world, id);

    CHECK(isFinite(pos));
    CHECK(isFinite(vel));
    CHECK(vel.length() < 200.f);
    CHECK(pos.y > -1.f);
    CHECK(pos.y < 6.f);
    CHECK(std::fabs(pos.x) < 4.f);
    CHECK(std::fabs(pos.z) < 4.f);
  }
}

TEST_CASE("body remove and recreate", "[physics]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);

  const int id0 = world.createRigidBody({
    {0.f, 1.f, 0.f}, {0.f, 0.f, 0.f},
    1.f, 0.1f, 0.4f, 0.f, BodyType::Dynamic
  });
  CHECK(id0 == 0);
  CHECK(world.getActiveBodyCount() == 1);

  world.removeRigidBody(id0);
  CHECK(world.getActiveBodyCount() == 0);

  const int id1 = world.createRigidBody({
    {0.f, 2.f, 0.f}, {0.f, 0.f, 0.f},
    1.f, 0.1f, 0.4f, 0.f, BodyType::Dynamic
  });
  CHECK(id1 == 1);
  CHECK(world.getActiveBodyCount() == 1);

  stepFixed(world, 10);

  const Vec3 pos = readPos(world, id1);
  CHECK(pos.y < 2.f);

  float staleX = 99.f;
  world.getPosition(id0, &staleX, nullptr, nullptr);
  CHECK(staleX == 99.f);
}

TEST_CASE("ball drops on box", "[physics]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);
  world.addStaticBox(0.f, 0.f, 0.f, 2.f, 0.5f, 2.f, 0.f, 0.f, 0.f, 1.f);

  const int ball = world.createRigidBody({
    {0.f, 2.f, 0.f}, {0.f, 0.f, 0.f},
    1.f, 0.25f, 0.5f, 0.02f, BodyType::Dynamic
  });

  stepFixed(world, 120);

  const Vec3 pos = readPos(world, ball);
  CHECK(pos.y > 0.5f);
}

TEST_CASE("ball hits capsule", "[physics]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);
  world.addStaticCapsule(0.f, 1.f, 0.f, 0.4f, 0.5f, 0.f, 0.f, 0.f, 1.f);

  const int ball = world.createRigidBody({
    {0.f, 3.f, 0.f}, {0.f, 0.f, 0.f},
    1.f, 0.2f, 0.5f, 0.02f, BodyType::Dynamic
  });

  stepFixed(world, 120);

  const Vec3 pos = readPos(world, ball);
  const Vec3 vel = readVel(world, ball);
  CHECK(pos.y > 1.0f);
  CHECK((near(vel.y, 0.f, 0.5f) || vel.y > 0.f));
}
