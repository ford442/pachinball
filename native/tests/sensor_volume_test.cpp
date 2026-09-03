/**
 * Native unit tests for sensor volumes (#383 Slice A).
 *
 *   npm run test:native
 */

#include "PhysicsWorld.h"
#include "SensorVolume.h"
#include "test_helpers.hpp"

#include <catch2/catch_test_macros.hpp>

using namespace pachinball;
using namespace pachinball::test;

TEST_CASE("ball crossing a sensor volume emits exactly one enter and one exit", "[physics][sensor]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  SensorVolumeDesc desc;
  desc.center = {0.f, 0.f, 0.f};
  desc.halfExtents = {0.5f, 0.5f, 0.5f};
  const int sensorId = world.addSensorVolume(desc);

  world.createRigidBody({
    {-2.f, 0.f, 0.f}, {2.f, 0.f, 0.f},
    1.f, 0.1f, 0.5f, 0.f, BodyType::Dynamic
  });

  int enterCount = 0, stayCount = 0, exitCount = 0;
  bool anyImpulse = false;

  for (int i = 0; i < 120; ++i) {
    world.step(FIXED_DT);
    for (const ContactEvent& evt : world.lastContactEvents()) {
      if (evt.bodyId2 != sensorId) continue;
      CHECK(evt.isSensor);
      if (evt.impulse != 0.f) anyImpulse = true;
      if (evt.phase == ContactPhase::Enter) ++enterCount;
      else if (evt.phase == ContactPhase::Exit) ++exitCount;
      else ++stayCount;
    }
  }

  CHECK(enterCount == 1);
  CHECK(exitCount == 1);
  CHECK(stayCount > 0);
  CHECK_FALSE(anyImpulse);
}

TEST_CASE("ball passing through a sensor volume undergoes no positional correction", "[physics][sensor]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  SensorVolumeDesc desc;
  desc.center = {0.f, 0.f, 0.f};
  desc.halfExtents = {0.5f, 0.5f, 0.5f};
  world.addSensorVolume(desc);

  const int ball = world.createRigidBody({
    {-2.f, 0.f, 0.f}, {2.f, 0.f, 0.f},
    1.f, 0.1f, 0.5f, 0.f, BodyType::Dynamic
  });

  for (int i = 0; i < 120; ++i) {
    world.step(FIXED_DT);
  }

  // Straight-line ballistic travel: x = x0 + v*t, entirely unperturbed.
  const Vec3 pos = readPos(world, ball);
  const Vec3 vel = readVel(world, ball);
  CHECK(near(vel.x, 2.f, 1e-4f));
  CHECK(near(pos.x, -2.f + 2.f * (120.f * FIXED_DT), 1e-3f));
}

TEST_CASE("ball dwelling inside a sensor for N frames emits N-2 stay events", "[physics][sensor]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  SensorVolumeDesc desc;
  desc.center = {0.f, 0.f, 0.f};
  desc.halfExtents = {2.f, 2.f, 2.f};
  const int sensorId = world.addSensorVolume(desc);

  const int ball = world.createRigidBody({
    {0.f, 0.f, 0.f}, {0.f, 0.f, 0.f},
    1.f, 0.1f, 0.5f, 0.f, BodyType::Dynamic
  });

  constexpr int N = 8;
  int enterCount = 0, stayCount = 0, exitCount = 0;

  for (int i = 0; i < N; ++i) {
    if (i == N - 1) {
      // Leave by teleport (not by velocity) right before the final tick.
      world.setBodyPosition(ball, 100.f, 0.f, 0.f);
    }
    world.step(FIXED_DT);
    for (const ContactEvent& evt : world.lastContactEvents()) {
      if (evt.bodyId2 != sensorId) continue;
      if (evt.phase == ContactPhase::Enter) ++enterCount;
      else if (evt.phase == ContactPhase::Exit) ++exitCount;
      else ++stayCount;
    }
  }

  CHECK(enterCount == 1);
  CHECK(stayCount == N - 2);
  CHECK(exitCount == 1);
}

TEST_CASE("sensor volume does not overlap a body excluded by its filter mask", "[physics][sensor][filter]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  SensorVolumeDesc desc;
  desc.center = {0.f, 0.f, 0.f};
  desc.halfExtents = {2.f, 2.f, 2.f};
  desc.membership = 0x8u;
  desc.filter = 0x8u;
  world.addSensorVolume(desc);

  const int ball = world.createRigidBody({
    {0.f, 0.f, 0.f}, {0.f, 0.f, 0.f},
    1.f, 0.1f, 0.5f, 0.f, BodyType::Dynamic
  });
  world.setCollisionGroups(ball, 0x1u, 0x1u);

  stepFixed(world, 5);
  CHECK(world.getContactCount() == 0);
}
