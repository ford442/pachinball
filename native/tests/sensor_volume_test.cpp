/**
 * Native unit tests for sensor volumes (#383 Slice A).
 *
 *   npm run test:native
 */

#include "PhysicsWorld.h"
#include "SensorVolume.h"
#include "test_helpers.hpp"

#include <catch2/catch_test_macros.hpp>

#include <cstdint>
#include <vector>

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

// ---- Thin sensors crossed inside one substep -----------------------------------
//
// The end-of-substep pose is not enough: a ball (or a captured, kinematic ball)
// that travels further than a thin sensor is thick ends the substep on the far
// side of it. These pin the sweep: Enter on the step it crosses, Exit on the next.

namespace {

struct SensorEdges {
  int enter = 0;
  int stay = 0;
  int exit = 0;
};

SensorEdges edgesFor(const PhysicsWorld& world, int sensorId) {
  SensorEdges e;
  for (const ContactEvent& evt : world.lastContactEvents()) {
    if (evt.bodyId2 != sensorId || !evt.isSensor) continue;
    if (evt.phase == ContactPhase::Enter) ++e.enter;
    else if (evt.phase == ContactPhase::Exit) ++e.exit;
    else ++e.stay;
  }
  return e;
}

int makeSensorBall(PhysicsWorld& world, Vec3 pos, Vec3 vel, float radius = 0.1f) {
  RigidBodyDesc desc;
  desc.position = pos;
  desc.velocity = vel;
  desc.mass = 1.f;
  desc.radius = radius;
  desc.restitution = 0.f;
  desc.linearDamping = 0.f;
  desc.angularDamping = 0.f;
  return world.createRigidBody(desc);
}

/** A 4 cm thick wall across x = 0 — far thinner than the ball diameter plus a tick of travel. */
int addThinWall(PhysicsWorld& world, uint32_t membership = COLLISION_GROUPS_ALL,
                uint32_t filter = COLLISION_GROUPS_ALL) {
  SensorVolumeDesc desc;
  desc.center = {0.f, 0.f, 0.f};
  desc.halfExtents = {0.02f, 0.5f, 0.5f};
  desc.membership = membership;
  desc.filter = filter;
  return world.addSensorVolume(desc);
}

} // namespace

TEST_CASE("kinematic body crossing a thin sensor in one substep emits begin, then end", "[physics][sensor][sweep]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  const int sensorId = addThinWall(world);

  const int ball = makeSensorBall(world, {-1.f, 0.f, 0.f}, Vec3::zero());
  world.setBodyType(ball, BodyType::Kinematic);

  // The captured ball is carried 2 m in a single tick: from x = -1 to x = +1.
  // Neither end pose touches the wall (|x| must be < 0.02 + 0.1 to overlap).
  world.setNextKinematicTransform(ball, 1.f, 0.f, 0.f, 0.f, 0.f, 0.f, 1.f);
  world.step(FIXED_DT);
  CHECK(near(readPos(world, ball).x, 1.f, 1e-5f));
  const SensorEdges crossed = edgesFor(world, sensorId);
  CHECK(crossed.enter == 1);
  CHECK(crossed.exit == 0);
  CHECK(crossed.stay == 0);

  // The next tick it is already past the wall: the contact ends.
  world.step(FIXED_DT);
  const SensorEdges left = edgesFor(world, sensorId);
  CHECK(left.enter == 0);
  CHECK(left.exit == 1);

  // And it stays ended.
  world.step(FIXED_DT);
  const SensorEdges after = edgesFor(world, sensorId);
  CHECK(after.enter == 0);
  CHECK(after.exit == 0);
  CHECK(after.stay == 0);
}

TEST_CASE("fast dynamic ball crossing a thin sensor in one substep emits begin, then end", "[physics][sensor][sweep]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  const int sensorId = addThinWall(world);

  // 120 m/s is 2 m per tick: the ball is at x = -1 before the step and x = +1 after.
  const int ball = makeSensorBall(world, {-1.f, 0.f, 0.f}, {120.f, 0.f, 0.f});

  world.step(FIXED_DT);
  CHECK(near(readPos(world, ball).x, 1.f, 1e-3f));
  const SensorEdges crossed = edgesFor(world, sensorId);
  CHECK(crossed.enter == 1);
  CHECK(crossed.exit == 0);

  world.step(FIXED_DT);
  const SensorEdges left = edgesFor(world, sensorId);
  CHECK(left.enter == 0);
  CHECK(left.exit == 1);

  // Unperturbed: a sensor never touches the body it reports.
  CHECK(near(readVel(world, ball).x, 120.f, 1e-3f));
}

TEST_CASE("swept sensor crossing works for a thin cylinder (an exit portal's shape)", "[physics][sensor][sweep]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  SensorVolumeDesc desc;
  desc.center = {0.f, 1.f, 0.f};
  desc.shape = VolumeShape::Cylinder;
  desc.halfExtents = {1.f, 0.02f, 1.f}; // radius 1, half-height 0.02 along local +Y
  const int sensorId = world.addSensorVolume(desc);

  const int ball = makeSensorBall(world, {0.2f, 0.f, 0.1f}, {0.f, 120.f, 0.f});
  world.step(FIXED_DT);
  CHECK(readPos(world, ball).y > 1.5f);
  CHECK(edgesFor(world, sensorId).enter == 1);

  world.step(FIXED_DT);
  CHECK(edgesFor(world, sensorId).exit == 1);
}

TEST_CASE("a fast ball that passes beside a thin sensor reports nothing", "[physics][sensor][sweep]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  const int sensorId = addThinWall(world);

  // Same 2 m / tick pass, but 1 m clear of the wall's 0.5 m z extent.
  makeSensorBall(world, {-1.f, 0.f, 1.f}, {120.f, 0.f, 0.f});
  for (int i = 0; i < 3; ++i) {
    world.step(FIXED_DT);
    const SensorEdges e = edgesFor(world, sensorId);
    CHECK(e.enter == 0);
    CHECK(e.stay == 0);
    CHECK(e.exit == 0);
  }
}

TEST_CASE("a teleport across a sensor between steps is not a crossing", "[physics][sensor][sweep]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  const int sensorId = addThinWall(world);

  const int ball = makeSensorBall(world, {-1.f, 0.f, 0.f}, Vec3::zero());
  world.step(FIXED_DT);
  world.setBodyPosition(ball, 1.f, 0.f, 0.f);
  for (int i = 0; i < 3; ++i) {
    world.step(FIXED_DT);
    const SensorEdges e = edgesFor(world, sensorId);
    CHECK(e.enter == 0);
    CHECK(e.exit == 0);
  }
}

TEST_CASE("a kinematic jump longer than the sweep limit is a teleport, not a crossing", "[physics][sensor][sweep]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  const int sensorId = addThinWall(world);

  const int ball = makeSensorBall(world, {-6.f, 0.f, 0.f}, Vec3::zero());
  world.setBodyType(ball, BodyType::Kinematic);
  world.setNextKinematicTransform(ball, 6.f, 0.f, 0.f, 0.f, 0.f, 0.f, 1.f);
  world.step(FIXED_DT);
  const SensorEdges e = edgesFor(world, sensorId);
  CHECK(e.enter == 0);
  CHECK(e.exit == 0);
}

TEST_CASE("a swept crossing still honours the sensor's filter mask", "[physics][sensor][sweep][filter]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  const int sensorId = addThinWall(world, 0x8u, 0x8u);

  const int ball = makeSensorBall(world, {-1.f, 0.f, 0.f}, {120.f, 0.f, 0.f});
  world.setCollisionGroups(ball, 0x1u, 0x1u);
  for (int i = 0; i < 3; ++i) {
    world.step(FIXED_DT);
    CHECK(edgesFor(world, sensorId).enter == 0);
  }
  CHECK(world.getContactCount() == 0);
}

TEST_CASE("a restored world sweeps the same crossing the original does", "[physics][sensor][sweep][snapshot]") {
  PhysicsWorld a;
  a.setGravity(0.f, 0.f, 0.f);
  const int sensorId = addThinWall(a);
  const int ball = makeSensorBall(a, {-1.f, 0.f, 0.f}, {120.f, 0.f, 0.f});
  a.step(FIXED_DT);
  CHECK(edgesFor(a, sensorId).enter == 1);
  const std::vector<uint8_t> blob = a.serialize();

  // A replay client: the same statics, no bodies; the snapshot supplies the ball.
  PhysicsWorld b;
  b.setGravity(0.f, 0.f, 0.f);
  REQUIRE(addThinWall(b) == sensorId);
  REQUIRE(b.restore(blob.data(), blob.size()) == SnapshotStatus::Ok);

  // The sweep origin is transient (re-taken at the top of every step), so the
  // restored world carries on exactly as the original: the manifold remembers
  // the Enter, the ball is past the wall, and both report the Exit.
  a.step(FIXED_DT);
  b.step(FIXED_DT);
  CHECK(edgesFor(a, sensorId).exit == 1);
  CHECK(edgesFor(b, sensorId).exit == 1);
  CHECK(readPos(a, ball).x == readPos(b, ball).x);
}
