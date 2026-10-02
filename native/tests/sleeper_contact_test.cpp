/**
 * Sleeping bodies stay collidable (#420 leftover). A resting ball drops out of
 * the integrator, but an awake body — a steered kinematic ball, or one rolling
 * in — must still meet it and wake it on real contact. Before this, sleepers
 * were left out of the broadphase entirely, so anything awake passed through.
 */

#include "PhysicsWorld.h"
#include "test_helpers.hpp"

#include <catch2/catch_test_macros.hpp>

using namespace pachinball;
using namespace pachinball::test;

namespace {

WorldParams quickSleepParams() {
  WorldParams params;
  params.sleepFramesRequired = 8;
  params.sleepLinearThreshold = 0.1f;
  params.sleepAngularThreshold = 0.2f;
  return params;
}

int makeBall(PhysicsWorld& world, Vec3 pos, Vec3 vel = Vec3::zero()) {
  RigidBodyDesc desc;
  desc.position = pos;
  desc.velocity = vel;
  desc.mass = 1.f;
  desc.radius = 0.25f;
  desc.restitution = 0.5f;
  desc.linearDamping = 0.f;
  desc.angularDamping = 0.f;
  desc.friction = 0.2f;
  return world.createRigidBody(desc);
}

/** A zero-gravity world holding one ball that has gone to sleep at `pos`. */
int makeSleeper(PhysicsWorld& world, Vec3 pos) {
  const int ball = makeBall(world, pos);
  stepFixed(world, 30);
  REQUIRE(world.getActiveBodyCount() == 0);
  return ball;
}

} // namespace

TEST_CASE("a steered kinematic ball wakes the sleeping ball it drives into", "[physics][sleep][kinematic-body]") {
  PhysicsWorld world(quickSleepParams());
  world.setGravity(0.f, 0.f, 0.f);
  const int sleeper = makeSleeper(world, {0.f, 0.f, 0.f});

  const int steered = makeBall(world, {-1.5f, 0.f, 0.f});
  world.setBodyType(steered, BodyType::Kinematic);

  // 0.05 m per tick (3 m/s): the balls touch once the steered one passes x = -0.5.
  float x = -1.5f;
  for (int i = 0; i < 60; ++i) {
    x += 0.05f;
    world.setNextKinematicTransform(steered, x, 0.f, 0.f, 0.f, 0.f, 0.f, 1.f);
    world.step(FIXED_DT);
  }

  CHECK(readVel(world, sleeper).x > 0.5f);
  CHECK(readPos(world, sleeper).x > 0.1f);
  // It was woken, so it is integrating again rather than frozen mid-shove.
  CHECK(world.getActiveBodyCount() == 2);
}

TEST_CASE("a rolling ball hits a sleeping ball instead of passing through it", "[physics][sleep]") {
  PhysicsWorld world(quickSleepParams());
  world.setGravity(0.f, 0.f, 0.f);
  const int sleeper = makeSleeper(world, {0.f, 0.f, 0.f});

  const int rolling = makeBall(world, {-1.5f, 0.f, 0.f}, {3.f, 0.f, 0.f});
  stepFixed(world, 60);

  CHECK(readVel(world, sleeper).x > 0.5f);
  CHECK(readPos(world, sleeper).x > 0.1f);
  // Momentum went into the sleeper: the roller must not have tunnelled through it.
  CHECK(readPos(world, rolling).x < readPos(world, sleeper).x);
}

TEST_CASE("a sleeper stays asleep while an awake ball passes without touching it", "[physics][sleep]") {
  PhysicsWorld world(quickSleepParams());
  world.setGravity(0.f, 0.f, 0.f);
  const int sleeper = makeSleeper(world, {0.f, 0.f, 0.f});

  // One metre clear in z: it shares the sleeper's grid neighbourhood, but never overlaps.
  const int passer = makeBall(world, {-1.5f, 0.f, 1.f}, {3.f, 0.f, 0.f});
  stepFixed(world, 60);

  CHECK(readPos(world, passer).x > 1.f);
  CHECK(readPos(world, sleeper).x == 0.f);
  CHECK(readVel(world, sleeper).x == 0.f);
  // Only the passing ball is integrating: broadphase proximity alone does not wake anything.
  CHECK(world.getActiveBodyCount() == 1);
}

TEST_CASE("two sleepers neither pair nor wake each other", "[physics][sleep]") {
  PhysicsWorld world(quickSleepParams());
  world.setGravity(0.f, 0.f, 0.f);
  makeBall(world, {0.f, 0.f, 0.f});
  makeBall(world, {0.6f, 0.f, 0.f}); // same neighbourhood, 0.1 m apart surface-to-surface
  stepFixed(world, 30);
  REQUIRE(world.getActiveBodyCount() == 0);

  stepFixed(world, 10);
  CHECK(world.getLastBroadphasePairCount() == 0);
  CHECK(world.getActiveBodyCount() == 0);
}
