/**
 * Runtime body types + kinematic rigid-body targets (#420): a toy captures a
 * live ball (Dynamic → Kinematic), steers it with pose targets, and releases
 * it (Kinematic → Dynamic) carrying the well's motion.
 */

#include "PhysicsWorld.h"
#include "ContactListener.h"
#include "test_helpers.hpp"

#include <catch2/catch_test_macros.hpp>
#include <cmath>

using namespace pachinball;
using namespace pachinball::test;

namespace {

int makeBall(PhysicsWorld& world, Vec3 pos, float mass = 1.f, float radius = 0.25f, Vec3 vel = Vec3::zero()) {
  RigidBodyDesc desc;
  desc.position = pos;
  desc.velocity = vel;
  desc.mass = mass;
  desc.radius = radius;
  desc.restitution = 0.5f;
  desc.linearDamping = 0.f;
  desc.angularDamping = 0.f;
  desc.friction = 0.2f;
  return world.createRigidBody(desc);
}

void pushTarget(PhysicsWorld& world, int id, Vec3 p, Quat q = Quat::identity()) {
  world.setNextKinematicTransform(id, p.x, p.y, p.z, q.x, q.y, q.z, q.w);
}

bool sawContact(const PhysicsWorld& world, int a, int b) {
  for (const ContactEvent& e : world.lastContactEvents()) {
    if ((e.bodyId1 == a && e.bodyId2 == b) || (e.bodyId1 == b && e.bodyId2 == a)) return true;
  }
  return false;
}

} // namespace

TEST_CASE("Dynamic <-> Kinematic round trip preserves mass", "[physics][kinematic-body]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  const int ball = makeBall(world, {0.f, 1.f, 0.f}, 2.f);

  CHECK(world.getBodyType(ball) == static_cast<int>(BodyType::Dynamic));
  world.applyImpulse(ball, 1.f, 0.f, 0.f);
  CHECK(near(readVel(world, ball).x, 0.5f, 1e-6f));

  world.setBodyType(ball, BodyType::Kinematic);
  CHECK(world.getBodyType(ball) == static_cast<int>(BodyType::Kinematic));
  // Captured: velocity zeroed, and an infinite-mass body ignores impulses.
  CHECK(near(readVel(world, ball).x, 0.f, 1e-6f));
  world.applyImpulse(ball, 1.f, 0.f, 0.f);
  CHECK(near(readVel(world, ball).x, 0.f, 1e-6f));

  world.setBodyType(ball, BodyType::Dynamic);
  world.applyImpulse(ball, 1.f, 0.f, 0.f);
  CHECK(near(readVel(world, ball).x, 0.5f, 1e-6f));

  // Retyping to the current type, or an unknown id, is a no-op.
  world.setBodyType(ball, BodyType::Dynamic);
  world.setBodyType(9999, BodyType::Kinematic);
  CHECK(near(readVel(world, ball).x, 0.5f, 1e-6f));
  CHECK(world.getBodyType(9999) == -1);
}

TEST_CASE("kinematic ball does not respond to gravity", "[physics][kinematic-body]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, -5.f);
  const int ball = makeBall(world, {1.f, 2.f, 3.f}, 1.f, 0.25f, {4.f, 0.f, 0.f});

  world.setBodyType(ball, BodyType::Kinematic);
  world.applyForce(ball, 0.f, 100.f, 0.f);
  stepFixed(world, 60);

  const Vec3 pos = readPos(world, ball);
  CHECK(near(pos.x, 1.f, 1e-6f));
  CHECK(near(pos.y, 2.f, 1e-6f));
  CHECK(near(pos.z, 3.f, 1e-6f));
  CHECK(near(readVel(world, ball).length(), 0.f, 1e-6f));

  // Back to dynamic it falls again — the force pushed while captured is gone.
  world.setBodyType(ball, BodyType::Dynamic);
  stepFixed(world, 1);
  CHECK(readVel(world, ball).y < 0.f);
  CHECK(near(readVel(world, ball).y, -9.81f * FIXED_DT, 1e-4f));
}

TEST_CASE("kinematic targets move the body and derive its velocity", "[physics][kinematic-body]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  const int ball = makeBall(world, {0.f, 0.f, 0.f});
  world.setBodyType(ball, BodyType::Kinematic);

  const float stepX = 0.05f;
  const float spin = 3.f; // rad/s about +Y
  for (int i = 1; i <= 10; ++i) {
    const float half = 0.5f * spin * FIXED_DT * static_cast<float>(i);
    pushTarget(world, ball, {stepX * static_cast<float>(i), 0.f, 0.f}, {0.f, std::sin(half), 0.f, std::cos(half)});
    world.step(FIXED_DT);
    // The body sits exactly on the target after each step.
    CHECK(near(readPos(world, ball).x, stepX * static_cast<float>(i), 1e-5f));
  }

  const Vec3 vel = readVel(world, ball);
  const Vec3 ang = readAngVel(world, ball);
  CHECK(near(vel.x, stepX / FIXED_DT, 1e-3f));
  CHECK(near(vel.y, 0.f, 1e-5f));
  CHECK(near(ang.y, spin, 1e-2f));

  // Last push wins within one tick.
  pushTarget(world, ball, {5.f, 0.f, 0.f});
  pushTarget(world, ball, {stepX * 11.f, 0.f, 0.f});
  world.step(FIXED_DT);
  CHECK(near(readPos(world, ball).x, stepX * 11.f, 1e-5f));
}

TEST_CASE("release velocity matches the last kinematic delta", "[physics][kinematic-body]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  const int ball = makeBall(world, {0.f, 0.f, 0.f});
  world.setBodyType(ball, BodyType::Kinematic);

  Vec3 target = Vec3::zero();
  const Vec3 delta{0.02f, 0.01f, -0.03f};
  for (int i = 0; i < 8; ++i) {
    target = target + delta;
    pushTarget(world, ball, target);
    world.step(FIXED_DT);
  }
  const Vec3 heldVel = readVel(world, ball);
  CHECK(near(heldVel.x, delta.x / FIXED_DT, 1e-3f));
  CHECK(near(heldVel.y, delta.y / FIXED_DT, 1e-3f));
  CHECK(near(heldVel.z, delta.z / FIXED_DT, 1e-3f));

  world.setBodyType(ball, BodyType::Dynamic);
  const Vec3 released = readVel(world, ball);
  CHECK(near(released.x, heldVel.x, 1e-6f));
  CHECK(near(released.y, heldVel.y, 1e-6f));
  CHECK(near(released.z, heldVel.z, 1e-6f));

  // Free flight continues the well's motion: one more tick moves one more delta.
  world.step(FIXED_DT);
  const Vec3 pos = readPos(world, ball);
  CHECK(near(pos.x, target.x + delta.x, 1e-4f));
  CHECK(near(pos.y, target.y + delta.y, 1e-4f));
  CHECK(near(pos.z, target.z + delta.z, 1e-4f));
}

TEST_CASE("a tick without a target leaves a driven body at rest", "[physics][kinematic-body]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);
  const int ball = makeBall(world, {0.f, 1.f, 0.f});
  world.setBodyType(ball, BodyType::Kinematic);

  pushTarget(world, ball, {0.1f, 1.f, 0.f});
  world.step(FIXED_DT);
  CHECK(readVel(world, ball).x > 1.f);

  world.step(FIXED_DT);
  CHECK(near(readVel(world, ball).length(), 0.f, 1e-6f));
  CHECK(near(readPos(world, ball).x, 0.1f, 1e-6f));

  // Released from rest: a plain drop, no stale well velocity.
  world.setBodyType(ball, BodyType::Dynamic);
  CHECK(near(readVel(world, ball).length(), 0.f, 1e-6f));
}

TEST_CASE("a target sent to a dynamic body is ignored", "[physics][kinematic-body]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  const int ball = makeBall(world, {0.f, 0.f, 0.f}, 1.f, 0.25f, {1.f, 0.f, 0.f});
  pushTarget(world, ball, {5.f, 5.f, 5.f});
  world.step(FIXED_DT);
  CHECK(near(readPos(world, ball).x, FIXED_DT, 1e-5f));
  CHECK(near(readPos(world, ball).y, 0.f, 1e-6f));

  // A stale target does not leak into a later capture either.
  world.setBodyType(ball, BodyType::Kinematic);
  world.step(FIXED_DT);
  CHECK(near(readPos(world, ball).y, 0.f, 1e-6f));
}

TEST_CASE("captured ball holds for 30 frames while a second ball rolls past", "[physics][kinematic-body]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);
  world.addStaticPlane(0.f, 1.f, 0.f, 0.f, 0.3f);

  const float r = 0.25f;
  const Vec3 well{0.f, r, 0.f};
  const int captured = makeBall(world, {0.3f, r, 0.2f}, 1.f, r);
  const int roller = makeBall(world, {-1.2f, r, 0.f}, 1.f, r, {8.f, 0.f, 0.f});
  world.setBodyType(captured, BodyType::Kinematic);

  bool hit = false;
  float minGap = 1e9f;
  for (int frame = 0; frame < 30; ++frame) {
    // Steer toward the well (the MagSpin CATCH lerp), then hold there.
    const Vec3 cur = readPos(world, captured);
    const Vec3 next = cur + (well - cur) * 0.5f;
    pushTarget(world, captured, next);
    world.step(FIXED_DT);

    const Vec3 held = readPos(world, captured);
    CHECK(near(held.x, next.x, 1e-5f));
    CHECK(near(held.y, next.y, 1e-5f));
    CHECK(near(held.z, next.z, 1e-5f));

    const float gap = (readPos(world, roller) - held).length() - 2.f * r;
    minGap = std::min(minGap, gap);
    hit = hit || sawContact(world, captured, roller);
  }

  REQUIRE(hit);
  // The roller never tunnels into (or through) the captured ball…
  CHECK(minGap > -0.1f);
  CHECK(readPos(world, roller).x < readPos(world, captured).x);
  // …and bounces off it: an infinite-mass well ball is a wall.
  CHECK(readVel(world, roller).x < 0.f);

  world.setBodyType(captured, BodyType::Dynamic);
  world.applyImpulse(captured, 0.f, 0.f, 2.f);
  CHECK(near(readVel(world, captured).z, 2.f, 1e-3f));
}

TEST_CASE("kinematic body skips static solids but still trips sensors", "[physics][kinematic-body]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  const int box = world.addStaticBox(0.f, 0.f, 0.f, 1.f, 1.f, 1.f, 0.f, 0.f, 0.f, 1.f);
  SensorVolumeDesc sensorDesc;
  sensorDesc.center = {3.f, 0.f, 0.f};
  sensorDesc.halfExtents = {0.5f, 0.5f, 0.5f};
  const int sensor = world.addSensorVolume(sensorDesc);

  const int ball = makeBall(world, {0.5f, 0.f, 0.f});
  world.setBodyType(ball, BodyType::Kinematic);
  pushTarget(world, ball, {0.6f, 0.f, 0.f});
  world.step(FIXED_DT);
  // Deep inside the box: no push-out, no contact.
  CHECK(near(readPos(world, ball).x, 0.6f, 1e-6f));
  CHECK_FALSE(sawContact(world, ball, box));

  pushTarget(world, ball, {3.f, 0.f, 0.f});
  world.step(FIXED_DT);
  CHECK(sawContact(world, ball, sensor));
}

TEST_CASE("removing a body with a pending target is safe", "[physics][kinematic-body]") {
  PhysicsWorld world;
  const int ball = makeBall(world, {0.f, 0.f, 0.f});
  world.setBodyType(ball, BodyType::Kinematic);
  pushTarget(world, ball, {1.f, 0.f, 0.f});
  world.step(FIXED_DT);
  pushTarget(world, ball, {2.f, 0.f, 0.f});
  world.removeRigidBody(ball);
  world.step(FIXED_DT);
  world.step(FIXED_DT);
  CHECK(world.getBodyType(ball) == -1);
}
