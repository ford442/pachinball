/**
 * Native unit tests for the static cylinder / static sphere colliders and
 * the rotated-static-box roll case (#383 Slice B).
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

Quat axisAngle(const Vec3& axis, float radians) {
  const Vec3 a = axis.normalized();
  const float s = std::sin(radians * 0.5f);
  return Quat{a.x * s, a.y * s, a.z * s, std::cos(radians * 0.5f)};
}

/** Most recent emitted contact against `colliderId`, if any. */
std::optional<ContactEvent> findContact(const PhysicsWorld& world, int colliderId) {
  for (const ContactEvent& e : world.lastContactEvents()) {
    if (e.bodyId2 == colliderId) return e;
  }
  return std::nullopt;
}

/** Step until a contact against `colliderId` is emitted; returns it (or nullopt). */
std::optional<ContactEvent> stepUntilContact(PhysicsWorld& world, int colliderId, int maxSteps) {
  for (int i = 0; i < maxSteps; ++i) {
    world.step(FIXED_DT);
    auto hit = findContact(world, colliderId);
    if (hit) return hit;
  }
  return std::nullopt;
}

} // namespace

// ---------------------------------------------------------------------------
// Rotated static box — the shape adventure ramps are actually built from.
// ---------------------------------------------------------------------------

TEST_CASE("ball rolls down a static box rotated 15 degrees without tunnelling or jitter",
          "[physics][static-box]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);

  // Ramp tilted 15° about +X: its top face descends towards +Z.
  const float tilt = 15.f * 3.14159265f / 180.f;
  const Quat rot = axisAngle({1.f, 0.f, 0.f}, tilt);
  const int rampId = world.addStaticBox(0.f, 0.f, 0.f, 2.f, 0.25f, 6.f,
                                        rot.x, rot.y, rot.z, rot.w, 0.1f, 0.4f);

  // Start just above the ramp's top face at its uphill end.
  const Vec3 surfaceNormal = rot.rotate(Vec3{0.f, 1.f, 0.f});
  const Vec3 upSlope = rot.rotate(Vec3{0.f, 0.f, -4.f});
  const Vec3 start = upSlope + surfaceNormal * 0.40f;

  const int ball = world.createRigidBody({
    {start.x, start.y, start.z}, {0.f, 0.f, 0.f}, 0.08f, 0.1f, 0.1f, 0.f, BodyType::Dynamic
  });

  float minSignedHeight = 1e9f;
  for (int i = 0; i < 180; ++i) {
    world.step(FIXED_DT);
    const Vec3 p = readPos(world, ball);
    REQUIRE(isFinite(p));
    // Distance from the ball centre to the ramp's top plane, along its normal.
    const float h = p.dot(surfaceNormal) - 0.25f;
    if (i > 10) minSignedHeight = std::min(minSignedHeight, h);
  }

  // Never sank appreciably through the 0.5 m-thick slab (no tunnelling).
  CHECK(minSignedHeight > 0.05f);

  const Vec3 endPos = readPos(world, ball);
  const Vec3 endVel = readVel(world, ball);
  // It rolled downhill (towards +Z under this tilt), not stuck or launched.
  CHECK(endPos.z > start.z + 0.5f);
  CHECK(endVel.length() < 20.f);
  CHECK(std::fabs(endPos.x - start.x) < 0.5f);
  CHECK(findContact(world, rampId).has_value());
}

// ---------------------------------------------------------------------------
// Static cylinder — the three narrowphase regions.
// ---------------------------------------------------------------------------

TEST_CASE("ball bounces off a static cylinder SIDE wall with a radial normal",
          "[physics][static-cylinder]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  // Upright cylinder at the origin: radius 0.5, half-height 2.
  const int cylId = world.addStaticCylinder(0.f, 0.f, 0.f, 0.5f, 2.f,
                                            0.f, 0.f, 0.f, 1.f, 0.9f, 0.f);

  // Fire along -X at the cylinder's waist, well inside the flat caps.
  const int ball = world.createRigidBody({
    {1.2f, 0.f, 0.f}, {-4.f, 0.f, 0.f}, 0.08f, 0.1f, 0.9f, 0.f, BodyType::Dynamic
  });

  auto hit = stepUntilContact(world, cylId, 60);
  REQUIRE(hit.has_value());
  CHECK(isFinite(hit->normal));
  // Purely radial: +X, with no axial component.
  CHECK(near(hit->normal.x, 1.f, 1e-3f));
  CHECK(near(hit->normal.y, 0.f, 1e-3f));
  CHECK(near(hit->normal.z, 0.f, 1e-3f));

  stepFixed(world, 30);
  const Vec3 vel = readVel(world, ball);
  CHECK(vel.x > 0.5f);                          // reflected back along +X
  CHECK(readPos(world, ball).x > 0.6f);         // pushed outside the surface
  CHECK(near(readPos(world, ball).y, 0.f, 1e-2f));
}

TEST_CASE("ball bounces off a static cylinder END CAP with an axial normal",
          "[physics][static-cylinder]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  const int cylId = world.addStaticCylinder(0.f, 0.f, 0.f, 2.f, 0.5f,
                                            0.f, 0.f, 0.f, 1.f, 0.9f, 0.f);

  // Drop straight down onto the +Y cap, near the axis so the rim is not in play.
  const int ball = world.createRigidBody({
    {0.2f, 1.5f, 0.f}, {0.f, -4.f, 0.f}, 0.08f, 0.1f, 0.9f, 0.f, BodyType::Dynamic
  });

  auto hit = stepUntilContact(world, cylId, 60);
  REQUIRE(hit.has_value());
  CHECK(isFinite(hit->normal));
  CHECK(near(hit->normal.y, 1.f, 1e-3f));
  CHECK(near(hit->normal.x, 0.f, 1e-3f));
  CHECK(near(hit->normal.z, 0.f, 1e-3f));

  stepFixed(world, 30);
  CHECK(readVel(world, ball).y > 0.5f);
  CHECK(readPos(world, ball).y > 0.55f);
}

TEST_CASE("ball hitting the static cylinder RIM gets a finite, unit, outward-diagonal normal",
          "[physics][static-cylinder]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  const float radius = 1.f;
  const float halfHeight = 0.5f;
  const int cylId = world.addStaticCylinder(0.f, 0.f, 0.f, radius, halfHeight,
                                            0.f, 0.f, 0.f, 1.f, 0.6f, 0.f);

  // Aim exactly at the +X/+Y rim circle along the 45° diagonal.
  const float d = 0.70710678f;
  const int ball = world.createRigidBody({
    {radius + d * 0.9f, halfHeight + d * 0.9f, 0.f},
    {-4.f * d, -4.f * d, 0.f},
    0.08f, 0.1f, 0.6f, 0.f, BodyType::Dynamic
  });

  auto hit = stepUntilContact(world, cylId, 60);
  REQUIRE(hit.has_value());
  REQUIRE(isFinite(hit->normal));
  CHECK(near(hit->normal.length(), 1.f, 1e-3f));
  // Points away from the rim: outward in both the radial and axial sense.
  CHECK(hit->normal.x > 0.2f);
  CHECK(hit->normal.y > 0.2f);
  CHECK(near(hit->normal.z, 0.f, 1e-3f));

  for (int i = 0; i < 30; ++i) {
    world.step(FIXED_DT);
    REQUIRE(isFinite(readPos(world, ball)));
    REQUIRE(isFinite(readVel(world, ball)));
  }
  // Deflected back out along the rim diagonal rather than sinking into the solid.
  const Vec3 p = readPos(world, ball);
  CHECK((p.x * p.x + p.z * p.z > radius * radius || std::fabs(p.y) > halfHeight));
}

TEST_CASE("a ball whose centre starts inside a static cylinder is pushed out with a sane normal",
          "[physics][static-cylinder]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  const int cylId = world.addStaticCylinder(0.f, 0.f, 0.f, 1.f, 3.f,
                                            0.f, 0.f, 0.f, 1.f, 0.2f, 0.f);
  const int ball = world.createRigidBody({
    {0.3f, 0.f, 0.f}, {0.f, 0.f, 0.f}, 0.08f, 0.1f, 0.2f, 0.f, BodyType::Dynamic
  });

  auto hit = stepUntilContact(world, cylId, 30);
  REQUIRE(hit.has_value());
  REQUIRE(isFinite(hit->normal));
  CHECK(near(hit->normal.length(), 1.f, 1e-3f));
  // Shallowest exit from (0.3, 0, 0) in an r=1, h=3 cylinder is radially out (+X).
  CHECK(hit->normal.x > 0.9f);

  stepFixed(world, 120);
  const Vec3 p = readPos(world, ball);
  REQUIRE(isFinite(p));
  CHECK(std::sqrt(p.x * p.x + p.z * p.z) > 1.f);
}

TEST_CASE("a rotated static cylinder reports its normal in world space",
          "[physics][static-cylinder]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  // Lay the cylinder on its side: local +Y becomes world +X.
  const Quat rot = axisAngle({0.f, 0.f, 1.f}, -3.14159265f / 2.f);
  const int cylId = world.addStaticCylinder(0.f, 0.f, 0.f, 0.5f, 2.f,
                                            rot.x, rot.y, rot.z, rot.w, 0.9f, 0.f);

  // Drop onto the curved side from above — normal must be world +Y.
  world.createRigidBody({
    {0.f, 1.2f, 0.f}, {0.f, -4.f, 0.f}, 0.08f, 0.1f, 0.9f, 0.f, BodyType::Dynamic
  });

  auto hit = stepUntilContact(world, cylId, 60);
  REQUIRE(hit.has_value());
  CHECK(isFinite(hit->normal));
  CHECK(near(hit->normal.y, 1.f, 1e-3f));
  CHECK(near(hit->normal.x, 0.f, 1e-3f));
}

// ---------------------------------------------------------------------------
// Static sphere
// ---------------------------------------------------------------------------

TEST_CASE("ball bounces off a static sphere", "[physics][static-sphere]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  const int sphId = world.addStaticSphere(0.f, 0.f, 0.f, 0.5f, 0.9f, 0.f);
  const int ball = world.createRigidBody({
    {0.f, 0.f, 1.2f}, {0.f, 0.f, -4.f}, 0.08f, 0.1f, 0.9f, 0.f, BodyType::Dynamic
  });

  auto hit = stepUntilContact(world, sphId, 60);
  REQUIRE(hit.has_value());
  CHECK(isFinite(hit->normal));
  CHECK(near(hit->normal.z, 1.f, 1e-3f));

  stepFixed(world, 30);
  const Vec3 vel = readVel(world, ball);
  CHECK(vel.z > 0.5f);
  CHECK(readPos(world, ball).z > 0.6f);
}

TEST_CASE("static sphere handles have their own negative id range", "[physics][static-sphere]") {
  PhysicsWorld world;
  const int cyl0 = world.addStaticCylinder(0.f, 0.f, 0.f, 1.f, 1.f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f);
  const int cyl1 = world.addStaticCylinder(3.f, 0.f, 0.f, 1.f, 1.f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f);
  const int sph0 = world.addStaticSphere(0.f, 5.f, 0.f, 1.f, 0.4f, 0.2f);
  const int box0 = world.addStaticBox(0.f, 9.f, 0.f, 1.f, 1.f, 1.f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f);

  CHECK(cyl0 == STATIC_CYLINDER_ID_BASE);
  CHECK(cyl1 == STATIC_CYLINDER_ID_BASE - 1);
  CHECK(sph0 == STATIC_SPHERE_ID_BASE);
  CHECK(box0 == STATIC_BOX_ID_BASE);
  // Ranges must not overlap — setCollisionGroups routes purely on the handle.
  CHECK(cyl0 < SENSOR_VOLUME_ID_BASE);
  CHECK(sph0 < STATIC_CYLINDER_ID_BASE);
}

// ---------------------------------------------------------------------------
// Collision-group filtering on the new shapes
// ---------------------------------------------------------------------------

TEST_CASE("a filter word excludes a static cylinder from a ball that should pass through",
          "[physics][static-cylinder][filter]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  const int cylId = world.addStaticCylinder(0.f, 0.f, 0.f, 1.f, 2.f,
                                            0.f, 0.f, 0.f, 1.f, 0.9f, 0.f);
  world.setCollisionGroups(cylId, GROUP_ADVENTURE, GROUP_BALL);

  // Membership BUMPER / filter WALL: neither side's membership meets the
  // other's filter, so the pair must never reach the narrowphase.
  const int ghost = world.createRigidBody({
    {2.f, 0.f, 0.f}, {-4.f, 0.f, 0.f}, 0.08f, 0.1f, 0.9f, 0.f, BodyType::Dynamic
  });
  world.setCollisionGroups(ghost, GROUP_BUMPER, GROUP_WALL);

  stepFixed(world, 60);
  CHECK_FALSE(findContact(world, cylId).has_value());
  // Sailed straight through the cylinder, still travelling at its initial speed.
  const Vec3 p = readPos(world, ghost);
  CHECK(p.x < -1.f);
  CHECK(near(readVel(world, ghost).x, -4.f, 1e-3f));
}

TEST_CASE("a matching filter word lets a ball collide with a static cylinder",
          "[physics][static-cylinder][filter]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  const int cylId = world.addStaticCylinder(0.f, 0.f, 0.f, 1.f, 2.f,
                                            0.f, 0.f, 0.f, 1.f, 0.9f, 0.f);
  world.setCollisionGroups(cylId, GROUP_ADVENTURE, GROUP_BALL);

  const int ball = world.createRigidBody({
    {2.f, 0.f, 0.f}, {-4.f, 0.f, 0.f}, 0.08f, 0.1f, 0.9f, 0.f, BodyType::Dynamic
  });
  world.setCollisionGroups(ball, GROUP_BALL, GROUP_ADVENTURE);

  auto hit = stepUntilContact(world, cylId, 60);
  CHECK(hit.has_value());
  CHECK(readPos(world, ball).x > 0.f);
}

TEST_CASE("a filter word excludes a static sphere from a ball that should pass through",
          "[physics][static-sphere][filter]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  const int sphId = world.addStaticSphere(0.f, 0.f, 0.f, 1.f, 0.9f, 0.f);
  world.setCollisionGroups(sphId, GROUP_ADVENTURE, GROUP_BALL);

  const int ghost = world.createRigidBody({
    {2.f, 0.f, 0.f}, {-4.f, 0.f, 0.f}, 0.08f, 0.1f, 0.9f, 0.f, BodyType::Dynamic
  });
  world.setCollisionGroups(ghost, GROUP_BUMPER, GROUP_WALL);

  stepFixed(world, 60);
  CHECK_FALSE(findContact(world, sphId).has_value());
  CHECK(readPos(world, ghost).x < -1.f);
}
