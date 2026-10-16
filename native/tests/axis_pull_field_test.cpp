/**
 * ForceMode::AxisPull — a vertical well that draws bodies toward its own Y
 * axis (the MagSpin feeder). Contrast with the directional box fields covered
 * in adventure_geometry_test.cpp: here the push is radial, horizontal-only and
 * fades to nothing at the rim.
 */

#include "PhysicsWorld.h"
#include "test_helpers.hpp"

#include <catch2/catch_test_macros.hpp>

#include <vector>

using namespace pachinball;
using namespace pachinball::test;

namespace {

constexpr float RADIUS = 3.f;

ForceFieldDesc well(float strength, bool acceleration = true) {
  ForceFieldDesc desc;
  desc.center = {0.f, 0.5f, 0.f};
  desc.halfExtents = {RADIUS, 2.f, RADIUS};
  desc.mode = ForceMode::AxisPull;
  desc.strength = strength;
  desc.acceleration = acceleration;
  return desc;
}

int makeBall(PhysicsWorld& world, Vec3 pos, float mass = 1.f) {
  RigidBodyDesc desc;
  desc.position = pos;
  desc.mass = mass;
  desc.radius = 0.25f;
  desc.restitution = 0.5f;
  desc.linearDamping = 0.f;
  desc.angularDamping = 0.f;
  return world.createRigidBody(desc);
}

} // namespace

TEST_CASE("axis pull draws a ball horizontally toward the axis", "[physics][force-field][axis-pull]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  world.addForceField(well(10.f));
  const int ball = makeBall(world, {1.f, 1.2f, 0.f}); // off the axis, and above its centre height

  stepFixed(world, 10);

  const Vec3 v = readVel(world, ball);
  CHECK(v.x < -0.1f);
  CHECK(near(v.y, 0.f, 1e-5f));
  CHECK(near(v.z, 0.f, 1e-5f));
  CHECK(readPos(world, ball).x < 1.f);
}

TEST_CASE("axis pull is strongest at the axis and fades linearly to the rim", "[physics][force-field][axis-pull]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  world.addForceField(well(10.f));
  const int near_ = makeBall(world, {0.5f, 0.5f, 0.f});   // d = 0.5 → 1 - 0.5/3
  const int far_  = makeBall(world, {0.f, 0.5f, -2.5f});  // d = 2.5 → 1 - 2.5/3 (pulled along +z)

  world.step(FIXED_DT);

  CHECK(near(readVel(world, near_).x, -10.f * (1.f - 0.5f / RADIUS) * FIXED_DT, 1e-4f));
  CHECK(near(readVel(world, far_).z, 10.f * (1.f - 2.5f / RADIUS) * FIXED_DT, 1e-4f));
}

TEST_CASE("axis pull does nothing outside its radius or its height", "[physics][force-field][axis-pull]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  world.addForceField(well(10.f));
  const int wide = makeBall(world, {RADIUS + 0.5f, 0.5f, 0.f});
  const int tall = makeBall(world, {1.f, 0.5f + 2.f + 0.5f, 0.f});

  stepFixed(world, 10);

  CHECK(readVel(world, wide).x == 0.f);
  CHECK(readVel(world, tall).x == 0.f);
}

TEST_CASE("axis pull applies nothing on the axis itself", "[physics][force-field][axis-pull]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  world.addForceField(well(10.f));
  const int ball = makeBall(world, {0.f, 0.5f, 0.f});

  stepFixed(world, 10);

  const Vec3 v = readVel(world, ball);
  CHECK(isFinite(v));
  CHECK(v.x == 0.f);
  CHECK(v.z == 0.f);
}

TEST_CASE("axis pull honours the acceleration flag", "[physics][force-field][axis-pull]") {
  const Vec3 start{1.f, 0.5f, 0.f};
  const float falloff = 1.f - 1.f / RADIUS;

  PhysicsWorld accel;
  accel.setGravity(0.f, 0.f, 0.f);
  accel.addForceField(well(6.f, true));
  const int a = makeBall(accel, start, 2.f);
  accel.step(FIXED_DT);
  // Mass-independent: 6 m/s² however heavy the ball is.
  CHECK(near(readVel(accel, a).x, -6.f * falloff * FIXED_DT, 1e-4f));

  PhysicsWorld newtons;
  newtons.setGravity(0.f, 0.f, 0.f);
  newtons.addForceField(well(6.f, false));
  const int n = makeBall(newtons, start, 2.f);
  newtons.step(FIXED_DT);
  // 6 N on a 2 kg ball is 3 m/s².
  CHECK(near(readVel(newtons, n).x, -3.f * falloff * FIXED_DT, 1e-4f));
}

TEST_CASE("a captured kinematic ball is not pulled", "[physics][force-field][axis-pull]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  world.addForceField(well(10.f));
  const int ball = makeBall(world, {1.f, 0.5f, 0.f});
  world.setBodyType(ball, BodyType::Kinematic);

  stepFixed(world, 20);

  CHECK(readPos(world, ball).x == 1.f);
  CHECK(readVel(world, ball).x == 0.f);
}

TEST_CASE("axis pull respects group masks and the enabled flag", "[physics][force-field][axis-pull]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  const int field = world.addForceField(well(10.f));
  const int ball = makeBall(world, {1.f, 0.5f, 0.f});

  // A filter word that excludes the ball: the well is invisible to it.
  world.setCollisionGroups(field, 0u, 0u);
  stepFixed(world, 5);
  CHECK(readVel(world, ball).x == 0.f);

  world.setCollisionGroups(field, COLLISION_GROUPS_ALL, COLLISION_GROUPS_ALL);
  world.setForceFieldEnabled(field, false);
  stepFixed(world, 5);
  CHECK(readVel(world, ball).x == 0.f);

  world.setForceFieldEnabled(field, true);
  stepFixed(world, 5);
  CHECK(readVel(world, ball).x < -0.05f);
}

TEST_CASE("axis pull wakes a sleeping ball inside it", "[physics][force-field][axis-pull]") {
  WorldParams params;
  params.sleepFramesRequired = 8;
  params.sleepLinearThreshold = 0.1f;
  params.sleepAngularThreshold = 0.2f;
  PhysicsWorld world(params);
  world.setGravity(0.f, 0.f, 0.f);
  const int field = world.addForceField(well(10.f));
  world.setForceFieldEnabled(field, false);
  const int ball = makeBall(world, {1.f, 0.5f, 0.f});

  stepFixed(world, 30);
  REQUIRE(world.getActiveBodyCount() == 0);

  world.setForceFieldEnabled(field, true);
  stepFixed(world, 5);

  CHECK(world.getActiveBodyCount() == 1);
  CHECK(readVel(world, ball).x < -0.05f);
}

TEST_CASE("a snapshot refuses a world whose well was built differently", "[physics][force-field][axis-pull][snapshot]") {
  PhysicsWorld a;
  a.setGravity(0.f, 0.f, 0.f);
  a.addForceField(well(10.f));
  makeBall(a, {1.f, 0.5f, 0.f});
  stepFixed(a, 5);
  const std::vector<uint8_t> blob = a.serialize();

  PhysicsWorld same;
  same.setGravity(0.f, 0.f, 0.f);
  same.addForceField(well(10.f));
  CHECK(same.restore(blob.data(), blob.size()) == SnapshotStatus::Ok);

  PhysicsWorld stronger;
  stronger.setGravity(0.f, 0.f, 0.f);
  stronger.addForceField(well(20.f));
  CHECK(stronger.restore(blob.data(), blob.size()) == SnapshotStatus::StaticMismatch);

  // Same strength but a directional field: a different table, not a retuned well.
  PhysicsWorld directional;
  directional.setGravity(0.f, 0.f, 0.f);
  ForceFieldDesc plain = well(10.f);
  plain.mode = ForceMode::Directional;
  directional.addForceField(plain);
  CHECK(directional.restore(blob.data(), blob.size()) == SnapshotStatus::StaticMismatch);
}

TEST_CASE("directional fields hash exactly as they did before AxisPull existed", "[physics][force-field][snapshot]") {
  // The new mode/strength words are mixed into the static hash only for
  // non-directional fields, so strength on a directional field changes nothing.
  PhysicsWorld a;
  a.setGravity(0.f, 0.f, 0.f);
  ForceFieldDesc wind;
  wind.center = {0.f, 0.5f, 0.f};
  wind.force = {0.f, 1.f, 0.f};
  a.addForceField(wind);

  PhysicsWorld b;
  b.setGravity(0.f, 0.f, 0.f);
  wind.strength = 99.f; // unused in Directional mode
  b.addForceField(wind);

  CHECK(a.staticContentHash() == b.staticContentHash());
}
