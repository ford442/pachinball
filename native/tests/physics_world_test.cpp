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
#include "ContactListener.h"
#include "test_helpers.hpp"

#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <chrono>
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

TEST_CASE("stationary kinematic capsule supports resting ball", "[physics]") {
  // Parity check against "ball hits capsule" (static-geometry path) — a
  // Kinematic capsule RigidBody at rest should support a dropped ball the
  // same way a static CapsuleDesc does.
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);

  world.createRigidBody({
    {0.f, 1.f, 0.f}, {0.f, 0.f, 0.f},
    0.f, 0.4f, 0.5f, 0.f, BodyType::Kinematic, Shape::Capsule, 0.5f
  });

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

TEST_CASE("kinematic capsule flings ball", "[physics]") {
  // A moving Kinematic capsule (e.g. a flipper proxy) must impart its own
  // velocity onto the ball via the relative-velocity impulse term, unlike
  // the static-geometry capsule path which only sees the ball's velocity.
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  const int capsule = world.createRigidBody({
    {0.f, 1.f, 0.f}, {5.f, 0.f, 0.f},
    0.f, 0.4f, 0.5f, 0.f, BodyType::Kinematic, Shape::Capsule, 0.5f
  });

  const int ball = world.createRigidBody({
    {0.58f, 1.f, 0.f}, {0.f, 0.f, 0.f},
    1.f, 0.2f, 0.5f, 0.f, BodyType::Dynamic
  });

  stepFixed(world, 5);

  const Vec3 capsulePos = readPos(world, capsule);
  const Vec3 vel = readVel(world, ball);

  // Kinematic bodies never integrate — position is caller-controlled and
  // must stay exactly where it was created regardless of its velocity field.
  CHECK(near(capsulePos.x, 0.f, 1e-5f));

  // The ball must pick up momentum in the capsule's direction of travel.
  CHECK(vel.x > 1.0f);
}

TEST_CASE("ball rolls down inclined plane", "[physics][friction]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);
  world.setRollingResistance(0.01f);

  const float theta = 0.35f; // ~20 degrees
  const float nx = -std::sin(theta);
  const float ny =  std::cos(theta);
  world.addStaticPlane(nx, ny, 0.f, 0.f, 0.8f);

  RigidBodyDesc desc;
  desc.position = {nx * 0.26f, ny * 0.26f, 0.f};
  desc.mass = 1.f;
  desc.radius = 0.25f;
  desc.restitution = 0.f;
  desc.linearDamping = 0.f;
  desc.friction = 0.8f;
  desc.angularDamping = 0.02f;
  const int ball = world.createRigidBody(desc);

  stepFixed(world, 90);

  const Vec3 vel = readVel(world, ball);
  const Vec3 omega = readAngVel(world, ball);
  const Vec3 pos = readPos(world, ball);

  CHECK(pos.x < -0.05f);
  CHECK(omega.length() > 0.8f);

  // Rolling without slipping: |v + ω × r_contact| should be much smaller
  // than |v|. Contact radius is -normal * R.
  const Vec3 normal{nx, ny, 0.f};
  const Vec3 r = normal * -0.25f;
  const Vec3 contactVel = vel + omega.cross(r);
  const Vec3 vt = contactVel - normal * contactVel.dot(normal);
  CHECK(vt.length() < vel.length() * 0.55f);
}

TEST_CASE("spinning ball deflects on wall contact", "[physics][friction]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  world.setRollingResistance(0.f);
  // Wall at x = 1, inward normal -X, allowed half-space x <= 1.
  world.addStaticPlane(-1.f, 0.f, 0.f, -1.f, 0.8f);

  RigidBodyDesc desc;
  desc.position = {0.7f, 0.f, 0.f};
  desc.velocity = {2.f, 0.f, 0.f};
  desc.mass = 1.f;
  desc.radius = 0.25f;
  desc.restitution = 0.4f;
  desc.linearDamping = 0.f;
  desc.friction = 0.8f;
  desc.angularDamping = 0.f;
  const int ball = world.createRigidBody(desc);
  world.setAngularVelocity(ball, 0.f, 10.f, 0.f);

  stepFixed(world, 20);

  const Vec3 vel = readVel(world, ball);
  const Vec3 omega = readAngVel(world, ball);
  CHECK(vel.z > 0.15f);
  CHECK(omega.y < 10.f);
}

TEST_CASE("kinematic capsule flick imparts spin", "[physics][friction]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  world.setRollingResistance(0.f);

  RigidBodyDesc capDesc;
  capDesc.position = {0.f, 1.f, 0.f};
  capDesc.velocity = {0.f, 0.f, 5.f};
  capDesc.mass = 0.f;
  capDesc.radius = 0.4f;
  capDesc.restitution = 0.5f;
  capDesc.linearDamping = 0.f;
  capDesc.type = BodyType::Kinematic;
  capDesc.shape = Shape::Capsule;
  capDesc.capsuleHalfHeight = 0.5f;
  capDesc.friction = 0.8f;
  world.createRigidBody(capDesc);

  RigidBodyDesc ballDesc;
  ballDesc.position = {0.55f, 1.f, 0.f};
  ballDesc.mass = 1.f;
  ballDesc.radius = 0.2f;
  ballDesc.restitution = 0.5f;
  ballDesc.linearDamping = 0.f;
  ballDesc.friction = 0.8f;
  ballDesc.angularDamping = 0.f;
  const int ball = world.createRigidBody(ballDesc);

  stepFixed(world, 5);

  const Vec3 vel = readVel(world, ball);
  const Vec3 omega = readAngVel(world, ball);
  CHECK(vel.z > 0.5f);
  CHECK(omega.length() > 0.5f);
}

TEST_CASE("ball on flat plane comes to rest", "[physics][friction]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);
  world.setRollingResistance(0.12f);
  world.addStaticPlane(0.f, 1.f, 0.f, 0.f, 0.5f);

  RigidBodyDesc desc;
  desc.position = {0.f, 0.25f, 0.f};
  desc.velocity = {1.5f, 0.f, 0.f};
  desc.mass = 1.f;
  desc.radius = 0.25f;
  desc.restitution = 0.f;
  desc.linearDamping = 0.05f;
  desc.friction = 0.5f;
  desc.angularDamping = 0.15f;
  const int ball = world.createRigidBody(desc);

  stepFixed(world, 240);

  const Vec3 vel = readVel(world, ball);
  const Vec3 omega = readAngVel(world, ball);
  CHECK(vel.length() < 0.25f);
  CHECK(omega.length() < 1.5f);
}

TEST_CASE("orientation integrates from angular velocity", "[physics][friction]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  RigidBodyDesc desc;
  desc.position = {0.f, 2.f, 0.f};
  desc.mass = 1.f;
  desc.radius = 0.25f;
  desc.linearDamping = 0.f;
  desc.angularDamping = 0.f;
  const int ball = world.createRigidBody(desc);
  world.setAngularVelocity(ball, 0.f, 6.f, 0.f);

  stepFixed(world, 60);

  const Quat q = readRot(world, ball);
  const float len = std::sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  CHECK(near(len, 1.f, 1e-3f));
  CHECK(std::fabs(q.y) > 0.1f);
}

TEST_CASE("contact manifold enter/stay/exit for resting ball", "[physics][contacts]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);
  world.addStaticPlane(0.f, 1.f, 0.f, 0.f);

  RigidBodyDesc desc;
  desc.position = {0.f, 0.25f, 0.f};
  desc.mass = 1.f;
  desc.radius = 0.25f;
  desc.restitution = 0.f;
  desc.linearDamping = 0.05f;
  desc.friction = 0.5f;
  const int ball = world.createRigidBody(desc);

  world.step(FIXED_DT);
  const auto& first = world.lastContactEvents();
  REQUIRE(first.size() >= 1);
  bool sawEnter = false;
  for (const auto& e : first) {
    if ((e.bodyId1 == ball && e.bodyId2 == STATIC_PLANE_ID) ||
        (e.bodyId2 == ball && e.bodyId1 == STATIC_PLANE_ID)) {
      CHECK(e.phase == ContactPhase::Enter);
      sawEnter = true;
    }
  }
  REQUIRE(sawEnter);

  for (int i = 0; i < 10; ++i) {
    world.step(FIXED_DT);
    const auto& evts = world.lastContactEvents();
    int pairCount = 0;
    for (const auto& e : evts) {
      if ((e.bodyId1 == ball && e.bodyId2 == STATIC_PLANE_ID) ||
          (e.bodyId2 == ball && e.bodyId1 == STATIC_PLANE_ID)) {
        ++pairCount;
        CHECK(e.phase == ContactPhase::Stay);
      }
    }
    CHECK(pairCount == 1);
  }

  world.setBodyPosition(ball, 0.f, 8.f, 0.f);
  world.setVelocity(ball, 0.f, 0.f, 0.f);
  world.step(FIXED_DT);
  const auto& afterLift = world.lastContactEvents();
  bool sawExit = false;
  for (const auto& e : afterLift) {
    if ((e.bodyId1 == ball && e.bodyId2 == STATIC_PLANE_ID) ||
        (e.bodyId2 == ball && e.bodyId1 == STATIC_PLANE_ID)) {
      CHECK(e.phase == ContactPhase::Exit);
      sawExit = true;
    }
  }
  REQUIRE(sawExit);
}

TEST_CASE("one contact event per pair per step despite substeps", "[physics][contacts]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  const int a = world.createRigidBody({
    {-0.1f, 0.f, 0.f}, {0.f, 0.f, 0.f},
    1.f, 0.25f, 0.f, 0.f, BodyType::Dynamic
  });
  world.createRigidBody({
    {0.1f, 0.f, 0.f}, {0.f, 0.f, 0.f},
    1.f, 0.25f, 0.f, 0.f, BodyType::Dynamic
  });

  // 8 substeps in one step() call (maxSubsteps default is 8)
  world.step(8.f / 60.f);
  int pairEvents = 0;
  for (const auto& e : world.lastContactEvents()) {
    if (contactPairKey(e.bodyId1, e.bodyId2) == contactPairKey(a, 1)) {
      ++pairEvents;
      CHECK(e.phase == ContactPhase::Enter);
    }
  }
  CHECK(pairEvents == 1);
}

TEST_CASE("contact listener peak impulse and lossless overflow", "[physics][contacts]") {
  ContactListener listener;

  ContactEvent sample;
  sample.bodyId1 = 1;
  sample.bodyId2 = 2;
  sample.normal = {0.f, 1.f, 0.f};
  sample.point = {0.f, 0.f, 0.f};
  sample.impulse = 1.f;
  listener.pushContact(sample);
  sample.impulse = 7.5f;
  listener.pushContact(sample);
  sample.impulse = 3.f;
  listener.pushContact(sample);
  listener.flushEvents();

  REQUIRE(listener.lastEvents().size() == 1);
  CHECK(listener.lastEvents()[0].impulse == 7.5f);
  CHECK(listener.lastEvents()[0].phase == ContactPhase::Enter);
  CHECK(listener.getContactCount() == 1);
  CHECK(listener.getDroppedContactCount() == 0);

  const float* buf = listener.getContactBufferPtr();
  REQUIRE(buf != nullptr);
  CHECK(buf[0] == 1.f);
  CHECK(buf[1] == 2.f);
  CHECK(buf[8] == 7.5f);
  CHECK(buf[9] == static_cast<float>(static_cast<int>(ContactPhase::Enter)));

  listener.flushEvents();
  REQUIRE(listener.lastEvents().size() == 1);
  CHECK(listener.lastEvents()[0].phase == ContactPhase::Exit);

  ContactListener many;
  constexpr int N = 400;
  for (int i = 0; i < N; ++i) {
    ContactEvent e;
    e.bodyId1 = i;
    e.bodyId2 = 10000;
    e.impulse = 1.f;
    many.pushContact(e);
  }
  many.flushEvents();
  CHECK(many.getContactCount() == N);
  CHECK(many.getDroppedContactCount() == 0);
  CHECK(many.lastEvents().size() == static_cast<std::size_t>(N));

  ContactListener capped;
  capped.setMaxContacts(2);
  for (int i = 0; i < 10; ++i) {
    ContactEvent e;
    e.bodyId1 = i;
    e.bodyId2 = 99;
    e.impulse = 1.f;
    capped.pushContact(e);
  }
  capped.flushEvents();
  CHECK(capped.getContactCount() == 2);
  CHECK(capped.getDroppedContactCount() == 8);
}

TEST_CASE("broadphase culls distant static colliders", "[physics][broadphase]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  for (int i = 0; i < 200; ++i) {
    world.addStaticBox(500.f + static_cast<float>(i), 0.f, 500.f + static_cast<float>(i),
                       0.5f, 0.5f, 0.5f, 0.f, 0.f, 0.f, 1.f);
  }

  world.createRigidBody({
    {0.f, 1.f, 0.f}, {0.f, 0.f, 0.f},
    1.f, 0.2f, 0.5f, 0.02f, BodyType::Dynamic
  });

  world.step(FIXED_DT);
  CHECK(world.getLastBroadphasePairCount() == 0);
}

TEST_CASE("broadphase emits pairs for nearby static colliders", "[physics][broadphase]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);
  world.addStaticBox(0.f, 0.f, 0.f, 2.f, 0.5f, 2.f, 0.f, 0.f, 0.f, 1.f);

  world.createRigidBody({
    {0.f, 2.f, 0.f}, {0.f, 0.f, 0.f},
    1.f, 0.25f, 0.5f, 0.02f, BodyType::Dynamic
  });

  world.step(FIXED_DT);
  CHECK(world.getLastBroadphasePairCount() >= 1);
}

TEST_CASE("sleeping bodies reduce broadphase pair count", "[physics][sleep]") {
  WorldParams params;
  params.sleepFramesRequired = 8;
  params.sleepLinearThreshold = 0.1f;
  params.sleepAngularThreshold = 0.2f;
  PhysicsWorld world(params);
  world.setGravity(0.f, 0.f, 0.f);
  world.addStaticPlane(0.f, 1.f, 0.f, 0.f);

  world.createRigidBody({
    {0.f, 0.26f, 0.f}, {0.f, 0.f, 0.f},
    1.f, 0.25f, 0.f, 0.1f, BodyType::Dynamic
  });

  for (int i = 0; i < 30; ++i) {
    world.step(FIXED_DT);
  }
  CHECK(world.getActiveBodyCount() == 0);

  for (int i = 0; i < 200; ++i) {
    world.addStaticBox(500.f + static_cast<float>(i), 0.f, 500.f + static_cast<float>(i),
                       0.5f, 0.5f, 0.5f, 0.f, 0.f, 0.f, 1.f);
  }

  world.createRigidBody({
    {5.f, 3.f, 5.f}, {2.f, 0.f, 0.f},
    1.f, 0.2f, 0.5f, 0.02f, BodyType::Dynamic
  });

  world.step(FIXED_DT);
  CHECK(world.getLastBroadphasePairCount() == 0);
}

TEST_CASE("large scene step completes under time budget", "[physics][benchmark]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);
  world.addStaticPlane(0.f, 1.f, 0.f, 0.f);

  for (int i = 0; i < 200; ++i) {
    const float x = static_cast<float>((i % 20) - 10) * 1.2f;
    const float z = static_cast<float>(i / 20) * 1.2f;
    world.addStaticCapsule(x, 0.5f, z, 0.12f, 0.5f, 0.f, 0.f, 0.f, 1.f);
  }

  for (int i = 0; i < 40; ++i) {
    const float x = static_cast<float>((i % 8) - 4) * 0.8f;
    const float z = static_cast<float>(i / 8) * 0.8f;
    world.createRigidBody({
      {x, 2.f + 0.1f * static_cast<float>(i % 5), z},
      {0.f, 0.f, 0.f},
      1.f, 0.2f, 0.5f, 0.02f, BodyType::Dynamic
    });
  }

  const auto t0 = std::chrono::steady_clock::now();
  for (int s = 0; s < 30; ++s) {
    world.step(FIXED_DT);
  }
  const auto t1 = std::chrono::steady_clock::now();
  const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();
  CHECK(ms < 5000);
}

TEST_CASE("hinge holds angle under gravity", "[physics][hinge]") {
  WorldParams params;
  params.solverIterations = 12;
  params.gravity = {0.f, -9.81f, 0.f};
  PhysicsWorld world(params);

  RigidBodyDesc desc;
  desc.position = {1.f, 0.f, 0.f};
  desc.mass = 1.f;
  desc.radius = 0.15f;
  desc.linearDamping = 0.f;
  desc.angularDamping = 0.f;
  desc.type = BodyType::Dynamic;
  const int body = world.createRigidBody(desc);

  HingeDesc hinge;
  hinge.worldAnchor = {0.f, 0.f, 0.f};
  hinge.worldAxis = {0.f, 0.f, 1.f};
  hinge.minAngle = 0.f;
  hinge.maxAngle = 0.f;
  hinge.baumgarte = 0.8f;
  const int hid = world.createHinge(body, hinge);
  REQUIRE(hid >= 0);

  stepFixed(world, 60);

  const Vec3 pos = readPos(world, body);
  CHECK(near(world.getHingeAngle(hid), 0.f, 0.15f));
  CHECK(near(pos.x, 1.f, 0.2f));
  CHECK(near(pos.y, 0.f, 0.2f));
  CHECK(isFinite(pos));
}

TEST_CASE("hinge motor reaches target omega", "[physics][hinge]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  RigidBodyDesc desc;
  desc.position = {0.f, 0.f, 0.f};
  desc.mass = 1.f;
  desc.radius = 0.2f;
  desc.linearDamping = 0.f;
  desc.angularDamping = 0.f;
  desc.type = BodyType::Dynamic;
  const int body = world.createRigidBody(desc);

  HingeDesc hinge;
  hinge.worldAnchor = {0.f, 0.f, 0.f};
  hinge.worldAxis = {0.f, 1.f, 0.f};
  hinge.minAngle = -3.f;
  hinge.maxAngle =  3.f;
  const int hid = world.createHinge(body, hinge);
  REQUIRE(hid >= 0);

  constexpr float targetW = 2.0f;
  world.setHingeMotor(hid, targetW, 50.f);
  stepFixed(world, 30);

  const Vec3 w = readAngVel(world, body);
  CHECK(near(w.y, targetW, 0.15f));
  CHECK(isFinite(w));
}

TEST_CASE("hinge angle limits do not explode", "[physics][hinge]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  RigidBodyDesc desc;
  desc.position = {0.8f, 0.f, 0.f};
  desc.mass = 1.f;
  desc.radius = 0.15f;
  desc.linearDamping = 0.f;
  desc.angularDamping = 0.f;
  desc.type = BodyType::Dynamic;
  const int body = world.createRigidBody(desc);

  HingeDesc hinge;
  hinge.worldAnchor = {0.f, 0.f, 0.f};
  hinge.worldAxis = {0.f, 0.f, 1.f};
  hinge.minAngle = -0.2f;
  hinge.maxAngle =  0.2f;
  const int hid = world.createHinge(body, hinge);
  world.setHingeMotor(hid, 8.f, 80.f);

  stepFixed(world, 120);

  const float angle = world.getHingeAngle(hid);
  const Vec3 pos = readPos(world, body);
  const Vec3 w = readAngVel(world, body);
  CHECK(angle >= -0.35f);
  CHECK(angle <=  0.35f);
  CHECK(isFinite(angle));
  CHECK(isFinite(pos));
  CHECK(isFinite(w));
}

TEST_CASE("hinge motor wakes sleeping body", "[physics][hinge]") {
  WorldParams params;
  params.sleepLinearThreshold = 0.05f;
  params.sleepAngularThreshold = 0.1f;
  params.sleepFramesRequired = 10;
  params.solverIterations = 4;
  params.gravity = {0.f, 0.f, 0.f};
  PhysicsWorld world(params);

  RigidBodyDesc desc;
  desc.position = {0.f, 0.f, 0.f};
  desc.mass = 1.f;
  desc.radius = 0.2f;
  desc.linearDamping = 0.5f;
  desc.angularDamping = 0.5f;
  desc.type = BodyType::Dynamic;
  const int body = world.createRigidBody(desc);

  HingeDesc hinge;
  hinge.worldAnchor = {0.f, 0.f, 0.f};
  hinge.worldAxis = {0.f, 1.f, 0.f};
  const int hid = world.createHinge(body, hinge);

  stepFixed(world, 40);
  CHECK(world.getActiveBodyCount() == 0);

  world.setHingeMotor(hid, 3.f, 40.f);
  stepFixed(world, 5);
  CHECK(world.getActiveBodyCount() >= 1);
  const Vec3 w = readAngVel(world, body);
  CHECK(std::fabs(w.y) > 0.5f);
}
