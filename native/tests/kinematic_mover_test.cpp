/**
 * Native unit tests for kinematic OBB movers (#383 Slice A).
 *
 *   npm run test:native
 */

#include "PhysicsWorld.h"
#include "KinematicMover.h"
#include "test_helpers.hpp"

#include <catch2/catch_test_macros.hpp>
#include <cmath>

using namespace pachinball;
using namespace pachinball::test;

TEST_CASE("ball resting on a rising kinematic piston is launched upward", "[physics][mover]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);

  KinematicMoverDesc desc;
  desc.position = {0.f, 0.f, 0.f};
  desc.halfExtents = {1.f, 0.1f, 1.f};
  desc.restitution = 0.3f;
  desc.friction = 0.2f;
  const int piston = world.addKinematicMover(desc);

  const int ball = world.createRigidBody({
    {0.f, 0.3f, 0.f}, {0.f, 0.f, 0.f},
    1.f, 0.2f, 0.3f, 0.f, BodyType::Dynamic
  });

  // Let the ball settle to rest on the (stationary) piston top face first.
  stepFixed(world, 15);
  const float velBefore = readVel(world, ball).y;
  CHECK(std::fabs(velBefore) < 1.0f);

  // Piston rises 0.05m in one tick (3 m/s) — must launch the resting ball,
  // not just teleport the geometry through it or leave the ball sitting.
  constexpr float riseDist = 0.05f;
  const float pistonVy = riseDist / FIXED_DT;
  world.setNextKinematicTransform(piston, 0.f, riseDist, 0.f, 0.f, 0.f, 0.f, 1.f);
  world.step(FIXED_DT);

  const float velAfter = readVel(world, ball).y;
  CHECK(velAfter > pistonVy * 0.5f);
  CHECK(velAfter > 1.0f);
  CHECK(isFinite(velAfter));
}

TEST_CASE("ball on a rotating kinematic platter picks up tangential velocity", "[physics][mover]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);

  KinematicMoverDesc desc;
  desc.position = {0.f, 0.f, 0.f};
  desc.halfExtents = {2.f, 0.1f, 2.f};
  desc.restitution = 0.1f;
  desc.friction = 0.9f;
  const int platter = world.addKinematicMover(desc);

  const int ball = world.createRigidBody({
    {1.f, 0.31f, 0.f}, {0.f, 0.f, 0.f},
    1.f, 0.2f, 0.1f, 0.f, BodyType::Dynamic, Shape::Sphere, 0.5f, 0.9f
  });

  constexpr float omega = 3.f; // rad/s around +Y
  float angle = 0.f;
  for (int i = 0; i < 90; ++i) {
    angle += omega * FIXED_DT;
    const float half = angle * 0.5f;
    world.setNextKinematicTransform(platter, 0.f, 0.f, 0.f, 0.f, std::sin(half), 0.f, std::cos(half));
    world.step(FIXED_DT);
  }

  const Vec3 vel = readVel(world, ball);
  const float tangentialSpeed = std::sqrt(vel.x * vel.x + vel.z * vel.z);
  CHECK(tangentialSpeed > 0.15f);
  CHECK(isFinite(vel));
}

TEST_CASE("mover does not respond to bodies excluded by its filter mask", "[physics][mover][filter]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);

  KinematicMoverDesc desc;
  desc.position = {0.f, 0.f, 0.f};
  desc.halfExtents = {1.f, 0.5f, 1.f};
  desc.membership = 0x100u;
  desc.filter = 0x100u; // only interacts with things carrying 0x100
  const int mover = world.addKinematicMover(desc);
  (void)mover;

  const int ball = world.createRigidBody({
    {0.f, 0.6f, 0.f}, {0.f, 0.f, 0.f},
    1.f, 0.2f, 0.3f, 0.f, BodyType::Dynamic
  });
  world.setCollisionGroups(ball, 0x1u, 0x1u); // does not share a bit with the mover

  stepFixed(world, 30);

  // Falls straight through — no launch, no support.
  const Vec3 pos = readPos(world, ball);
  CHECK(pos.y < 0.f);
}
