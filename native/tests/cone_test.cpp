/**
 * Static cone collider (#420) — the ball-trap funnel shape. Local +Y axis,
 * apex at +halfHeight, base disc at -halfHeight (Rapier's
 * `ColliderDesc.cone(halfHeight, radius)`).
 *
 *   npm run test:native
 */

#include "PhysicsWorld.h"
#include "test_helpers.hpp"

#include <catch2/catch_test_macros.hpp>

#include <cmath>
#include <optional>

using namespace pachinball;
using namespace pachinball::test;

namespace {

std::optional<ContactEvent> findContact(const PhysicsWorld& world, int colliderId) {
  for (const ContactEvent& e : world.lastContactEvents()) {
    if (e.bodyId2 == colliderId) return e;
  }
  return std::nullopt;
}

std::optional<ContactEvent> stepUntilContact(PhysicsWorld& world, int colliderId, int maxSteps) {
  for (int i = 0; i < maxSteps; ++i) {
    world.step(FIXED_DT);
    auto hit = findContact(world, colliderId);
    if (hit) return hit;
  }
  return std::nullopt;
}

int fire(PhysicsWorld& world, Vec3 pos, Vec3 vel, float radius = 0.1f) {
  return world.createRigidBody({pos, vel, 0.08f, radius, 0.9f, 0.f, BodyType::Dynamic});
}

int addUprightCone(PhysicsWorld& world, float radius, float halfHeight) {
  return world.addStaticCone(0.f, 0.f, 0.f, radius, halfHeight, 0.f, 0.f, 0.f, 1.f, 0.9f, 0.f);
}

} // namespace

TEST_CASE("a ball dropped on the apex bounces straight up", "[physics][static-cone]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);
  const int cone = addUprightCone(world, 0.5f, 1.f);
  CHECK(cone == STATIC_CONE_ID_BASE);

  const int ball = fire(world, {0.f, 2.f, 0.f}, {0.f, -3.f, 0.f});
  auto hit = stepUntilContact(world, cone, 60);
  REQUIRE(hit.has_value());
  CHECK(isFinite(hit->normal));
  CHECK(hit->normal.y > 0.99f);

  stepFixed(world, 5);
  CHECK(readVel(world, ball).y > 0.f);
  CHECK(readPos(world, ball).y > 1.f);
}

TEST_CASE("a ball hitting the slant gets the slant normal", "[physics][static-cone]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  // R = 1, h = 1: the slant runs from (1, -1) up to the apex (0, 1).
  const int cone = addUprightCone(world, 1.f, 1.f);
  const int ball = fire(world, {2.f, 0.f, 0.f}, {-4.f, 0.f, 0.f});

  auto hit = stepUntilContact(world, cone, 60);
  REQUIRE(hit.has_value());
  const float inv = 1.f / std::sqrt(5.f);
  CHECK(near(hit->normal.x, 2.f * inv, 2e-2f));
  CHECK(near(hit->normal.y, 1.f * inv, 2e-2f));
  CHECK(near(hit->normal.z, 0.f, 1e-3f));

  stepFixed(world, 20);
  CHECK(readVel(world, ball).x > 0.f);   // deflected back out
  CHECK(readVel(world, ball).y > 0.f);   // and up the slope
}

TEST_CASE("a ball hitting the base from below gets a -Y normal", "[physics][static-cone]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  const int cone = addUprightCone(world, 1.f, 0.5f);
  const int ball = fire(world, {0.2f, -1.5f, 0.1f}, {0.f, 4.f, 0.f});

  auto hit = stepUntilContact(world, cone, 60);
  REQUIRE(hit.has_value());
  CHECK(near(hit->normal.y, -1.f, 1e-3f));
  stepFixed(world, 10);
  CHECK(readVel(world, ball).y < 0.f);
}

TEST_CASE("a ball passing inside the bounding cylinder but clear of the slant is untouched",
          "[physics][static-cone]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  // Near the apex the cone is thin; a cylinder of the same size would be hit.
  const int cone = addUprightCone(world, 1.f, 1.f);
  const int ball = fire(world, {0.6f, 0.8f, 2.f}, {0.f, 0.f, -4.f});

  stepFixed(world, 60);
  CHECK_FALSE(findContact(world, cone).has_value());
  CHECK(near(readVel(world, ball).z, -4.f, 1e-4f));
  CHECK(readPos(world, ball).z < -1.f);
}

TEST_CASE("a rotated cone reports its normal in world space", "[physics][static-cone]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  // Rotate local +Y onto world +X: the apex points along +X.
  const float s = std::sin(-0.25f * 3.14159265f);
  const float c = std::cos(-0.25f * 3.14159265f);
  const int cone = world.addStaticCone(0.f, 0.f, 0.f, 0.5f, 1.f, 0.f, 0.f, s, c, 0.9f, 0.f);
  fire(world, {3.f, 0.f, 0.f}, {-4.f, 0.f, 0.f});

  auto hit = stepUntilContact(world, cone, 60);
  REQUIRE(hit.has_value());
  CHECK(hit->normal.x > 0.99f);
}

TEST_CASE("a ball whose centre starts inside the cone is pushed out", "[physics][static-cone]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  const int cone = addUprightCone(world, 1.f, 1.f);
  // Near the axis, 0.2 above the base and ~0.76 inside the slant.
  const int ball = fire(world, {0.05f, -0.8f, 0.f}, {0.f, 0.f, 0.f});

  world.step(FIXED_DT);
  auto hit = findContact(world, cone);
  REQUIRE(hit.has_value());
  CHECK(isFinite(hit->normal));
  CHECK(near(hit->normal.length(), 1.f, 1e-3f));
  stepFixed(world, 60);
  // Out through the nearer face: the base.
  CHECK(readPos(world, ball).y < -1.f);
}

TEST_CASE("a trap funnel stops a ball rolling across the table", "[physics][static-cone]") {
  // BallTrapBuilder: cone(halfHeight 0.6, radius 0.2) centred 0.5 above the
  // owner table plane; the ball (radius 0.5) rolls into it along +Z.
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);
  world.addStaticPlane(0.f, 1.f, 0.f, 0.f, 0.3f);
  const int cone = world.addStaticCone(-5.f, 0.5f, 10.f, 0.2f, 0.6f, 0.f, 0.f, 0.f, 1.f, 0.6f, 0.3f);
  const int ball = world.createRigidBody({{-5.f, 0.5f, 7.f}, {0.f, 0.f, 6.f}, 1.f, 0.5f, 0.5f, 0.f,
                                          BodyType::Dynamic});

  auto hit = stepUntilContact(world, cone, 120);
  REQUIRE(hit.has_value());
  stepFixed(world, 30);
  CHECK(readPos(world, ball).z < 10.f);
}

TEST_CASE("cone handles: groups, clear and capacity", "[physics][static-cone][static-handles]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  const int cone = addUprightCone(world, 1.f, 1.f);
  world.setCollisionGroups(cone, 0x0002, 0x0002);
  const int ball = fire(world, {2.f, 0.f, 0.f}, {-4.f, 0.f, 0.f});
  world.setCollisionGroups(ball, 0x0001, 0x0001);
  stepFixed(world, 60);
  CHECK_FALSE(findContact(world, cone).has_value());
  CHECK(readPos(world, ball).x < -1.f);

  world.clearStaticGeometry();
  CHECK(addUprightCone(world, 1.f, 1.f) == STATIC_CONE_ID_BASE);
  for (std::size_t i = 1; i < STATIC_HANDLE_CAPACITY; ++i) addUprightCone(world, 0.1f, 0.1f);
  CHECK(world.getDroppedStaticCount() == 0);
  CHECK(addUprightCone(world, 0.1f, 0.1f) == STATIC_HANDLE_OVERFLOW);
  CHECK(world.getDroppedStaticCount() == 1);

  // A sphere-family group edit never lands on a cone and vice versa.
  CHECK(world.addStaticSphere(0.f, 0.f, 0.f, 0.1f, 0.4f, 0.2f) == STATIC_SPHERE_ID_BASE);
  world.setCollisionGroups(STATIC_SPHERE_ID_BASE, 0, 0);
}
