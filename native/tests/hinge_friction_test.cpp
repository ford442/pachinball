/**
 * Native unit tests for PhysicsWorld friction/spin and world-anchored hinges
 * (split out of physics_world_test.cpp to keep that file under the split threshold).
 *
 * Build & run:
 *   npm run test:native
 */

#include "PhysicsWorld.h"
#include "test_helpers.hpp"

#include <catch2/catch_test_macros.hpp>
#include <cmath>

using namespace pachinball;
using namespace pachinball::test;

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
