/**
 * Native unit tests for the static cylinder / static sphere colliders and
 * the rotated-static-box roll case (#383 Slice B).
 *
 *   npm run test:native
 */

#include "PhysicsWorld.h"
#include "test_helpers.hpp"

#include <catch2/catch_test_macros.hpp>

#include <climits>
#include <cmath>
#include <cstdint>
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

// ---------------------------------------------------------------------------
// clearStaticGeometry — statics are append-only, so a rebuilt scene must be
// able to drop the old one.
// ---------------------------------------------------------------------------

TEST_CASE("clearStaticGeometry removes every static, sensor and mover",
          "[physics][static-clear]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  world.addStaticBox(0.f, 0.f, 0.f, 1.f, 1.f, 1.f, 0.f, 0.f, 0.f, 1.f, 0.9f, 0.f);
  world.addStaticCylinder(0.f, 6.f, 0.f, 1.f, 2.f, 0.f, 0.f, 0.f, 1.f, 0.9f, 0.f);
  world.addStaticSphere(0.f, 12.f, 0.f, 1.f, 0.9f, 0.f);
  world.addStaticPlane(0.f, 1.f, 0.f, -50.f, 0.2f);

  const int ball = world.createRigidBody({
    {4.f, 0.f, 0.f}, {-4.f, 0.f, 0.f}, 0.08f, 0.1f, 0.9f, 0.f, BodyType::Dynamic
  });
  REQUIRE(stepUntilContact(world, STATIC_BOX_ID_BASE, 60).has_value());

  world.clearStaticGeometry();

  // Same ball, fired at the same spot: nothing left to hit.
  world.setBodyPosition(ball, 4.f, 0.f, 0.f);
  world.setVelocity(ball, -4.f, 0.f, 0.f);
  stepFixed(world, 120);  // 2 s at 4 m/s: from x=4 straight through to x=-4
  CHECK_FALSE(findContact(world, STATIC_BOX_ID_BASE).has_value());
  CHECK(readPos(world, ball).x < -3.f);
  CHECK(near(readVel(world, ball).x, -4.f, 1e-3f));
}

TEST_CASE("handles restart from the base after clearStaticGeometry",
          "[physics][static-clear]") {
  PhysicsWorld world;
  CHECK(world.addStaticBox(0.f, 0.f, 0.f, 1.f, 1.f, 1.f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f)
        == STATIC_BOX_ID_BASE);
  CHECK(world.addStaticCylinder(0.f, 0.f, 0.f, 1.f, 1.f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f)
        == STATIC_CYLINDER_ID_BASE);

  world.clearStaticGeometry();

  CHECK(world.addStaticBox(0.f, 0.f, 0.f, 1.f, 1.f, 1.f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f)
        == STATIC_BOX_ID_BASE);
  CHECK(world.addStaticCylinder(0.f, 0.f, 0.f, 1.f, 1.f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f)
        == STATIC_CYLINDER_ID_BASE);
}

TEST_CASE("re-adding after clearStaticGeometry leaves exactly one copy",
          "[physics][static-clear]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  for (int pass = 0; pass < 3; ++pass) {
    world.clearStaticGeometry();
    world.addStaticBox(0.f, 0.f, 0.f, 1.f, 1.f, 1.f, 0.f, 0.f, 0.f, 1.f, 0.9f, 0.f);
  }

  const int ball = world.createRigidBody({
    {3.f, 0.f, 0.f}, {-2.f, 0.f, 0.f}, 0.08f, 0.1f, 0.9f, 0.f, BodyType::Dynamic
  });
  stepFixed(world, 5);
  // One box in the world means one static ref per cell, so at most one pair.
  CHECK(world.getLastBroadphasePairCount() <= 1);
  REQUIRE(isFinite(readPos(world, ball)));
}

TEST_CASE("dynamic bodies and hinges survive clearStaticGeometry",
          "[physics][static-clear]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  const int ball = world.createRigidBody({
    {1.f, 2.f, 3.f}, {0.f, 0.f, 0.f}, 1.f, 0.2f, 0.4f, 0.f, BodyType::Dynamic
  });
  const int hinge = world.createHinge(ball, HingeDesc{});
  world.addStaticBox(0.f, 0.f, 0.f, 1.f, 1.f, 1.f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f);

  world.clearStaticGeometry();

  const Vec3 p = readPos(world, ball);
  CHECK(near(p.x, 1.f));
  CHECK(near(p.y, 2.f));
  CHECK(near(p.z, 3.f));
  CHECK(hinge >= 0);
  CHECK(isFinite(world.getHingeAngle(hinge)));
}

// ---------------------------------------------------------------------------
// Broadphase pair-key aliasing: a body-body pair and a body-static pair must
// never share a dedup key, or one of them is silently dropped.
// ---------------------------------------------------------------------------

TEST_CASE("a body-body pair does not suppress a body-cylinder pair with the same key",
          "[physics][broadphase]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  // Cylinder index 0, tall enough that both balls sit against its curved side.
  const int cylId = world.addStaticCylinder(0.f, 0.f, 0.f, 0.5f, 4.f,
                                            0.f, 0.f, 0.f, 1.f, 0.9f, 0.f);

  // Dense body 0, overlapping the cylinder's side.
  world.createRigidBody({
    {0.55f, 0.f, 0.f}, {0.f, 0.f, 0.f}, 0.08f, 0.1f, 0.9f, 0.f, BodyType::Dynamic
  });

  // Dense bodies 1..4 parked far away, each in its own cell, forming no pairs.
  for (int i = 1; i <= 4; ++i) {
    world.createRigidBody({
      {100.f + static_cast<float>(i) * 5.f, 0.f, 0.f}, {0.f, 0.f, 0.f},
      0.08f, 0.1f, 0.5f, 0.f, BodyType::Dynamic
    });
  }

  // Dense body 5, directly above body 0. The broadphase grid is XZ-only, so
  // these two share a cell permanently and always emit a body-body pair,
  // while being far enough apart in Y never to actually touch.
  world.createRigidBody({
    {0.55f, 0.6f, 0.f}, {0.f, 0.f, 0.f}, 0.08f, 0.1f, 0.9f, 0.f, BodyType::Dynamic
  });

  world.step(FIXED_DT);

  // Three pairs: body0-body5, body0-cylinder, body5-cylinder. The body-body
  // key for (0, 5) is 5, and so was the body-static key for
  // (body 0, cylinder 0, Pair::BodyCylinder) while both pair classes shared
  // one dedup set — the body-body pair went in first and evicted the
  // cylinder's, so body 0 could never hit the cylinder.
  CHECK(world.getLastBroadphasePairCount() == 3);
  CHECK(findContact(world, cylId).has_value());
}

// ---------------------------------------------------------------------------
// Static-handle families are spaced 1000 apart, so overrunning one would hand
// out the next family's base and silently alias two different shapes.
// ---------------------------------------------------------------------------

TEST_CASE("a static family refuses creation at its capacity instead of aliasing the next",
          "[physics][static-handles]") {
  PhysicsWorld world;

  int lastBox = 0;
  for (std::size_t i = 0; i < STATIC_HANDLE_CAPACITY; ++i) {
    lastBox = world.addStaticBox(static_cast<float>(i), 0.f, 0.f, 0.1f, 0.1f, 0.1f,
                                 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f);
  }
  CHECK(lastBox == STATIC_BOX_ID_BASE - static_cast<int>(STATIC_HANDLE_CAPACITY) + 1);
  CHECK(lastBox > STATIC_CAPSULE_ID_BASE);          // never reached the next base
  CHECK(world.getDroppedStaticCount() == 0);

  const int overflow = world.addStaticBox(0.f, 0.f, 0.f, 0.1f, 0.1f, 0.1f,
                                          0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f);
  CHECK(overflow == STATIC_HANDLE_OVERFLOW);
  CHECK(overflow > 0);                               // can never look like a static
  CHECK(world.getDroppedStaticCount() == 1);

  // A capsule added afterwards still gets its own family's first handle.
  CHECK(world.addStaticCapsule(0.f, 0.f, 0.f, 0.1f, 0.1f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f)
        == STATIC_CAPSULE_ID_BASE);
}

TEST_CASE("every static family enforces the same capacity", "[physics][static-handles]") {
  PhysicsWorld world;
  for (std::size_t i = 0; i < STATIC_HANDLE_CAPACITY; ++i) {
    world.addStaticCylinder(0.f, static_cast<float>(i), 0.f, 0.1f, 0.1f,
                            0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f);
    world.addStaticSphere(0.f, static_cast<float>(i), 0.f, 0.1f, 0.4f, 0.2f);
    world.addSensorVolume(SensorVolumeDesc{});
  }
  CHECK(world.getDroppedStaticCount() == 0);

  CHECK(world.addStaticCylinder(0.f, 0.f, 0.f, 0.1f, 0.1f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f)
        == STATIC_HANDLE_OVERFLOW);
  CHECK(world.addStaticSphere(0.f, 0.f, 0.f, 0.1f, 0.4f, 0.2f) == STATIC_HANDLE_OVERFLOW);
  CHECK(world.addSensorVolume(SensorVolumeDesc{}) == STATIC_HANDLE_OVERFLOW);
  CHECK(world.getDroppedStaticCount() == 3);

  // clearStaticGeometry() frees the families and resets the drop count.
  world.clearStaticGeometry();
  CHECK(world.getDroppedStaticCount() == 0);
  CHECK(world.addStaticCylinder(0.f, 0.f, 0.f, 0.1f, 0.1f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f)
        == STATIC_CYLINDER_ID_BASE);
}

TEST_CASE("meshes and force fields reject the 1001st entry without aliasing",
          "[physics][static-handles]") {
  // One small floor triangle per mesh, shifted so every mesh has its own content.
  const auto addMesh = [](PhysicsWorld& world, float x) {
    const float vertices[] = {x, 0.f, 0.f, x + 1.f, 0.f, 0.f, x, 0.f, -1.f};
    const uint32_t indices[] = {0, 1, 2};
    return world.addStaticTriangleMesh(vertices, 3, indices, 3, 0.4f, 0.2f, false);
  };
  const auto wind = [](float z) {
    ForceFieldDesc desc;
    desc.center = {0.f, 0.5f, z};
    desc.force = {0.f, 1.f, 0.f};
    return desc;
  };

  // The dropped count is part of the content hash, as for every family; the
  // refused geometry is not. Two worlds that refused different shapes hash equal.
  SECTION("triangle meshes") {
    const auto fill = [&](PhysicsWorld& world) {
      for (std::size_t i = 0; i < STATIC_HANDLE_CAPACITY; ++i) {
        REQUIRE(addMesh(world, static_cast<float>(i) * 0.01f) == STATIC_MESH_ID_BASE - static_cast<int>(i));
      }
      CHECK(world.getDroppedStaticCount() == 0);
    };
    PhysicsWorld world;
    PhysicsWorld other;
    fill(world);
    fill(other);

    // The 1001st mesh used to be handed -7000, the first force field's id.
    CHECK(addMesh(world, 50.f) == STATIC_HANDLE_OVERFLOW);
    CHECK(addMesh(other, -50.f) == STATIC_HANDLE_OVERFLOW);
    CHECK(world.getDroppedStaticCount() == 1);
    CHECK(world.staticContentHash() == other.staticContentHash());  // no triangle reached either table
    CHECK(world.getStateHash() == other.getStateHash());

    const int field = world.addForceField(wind(0.f));
    CHECK(field == FORCE_FIELD_ID_BASE);
    other.addForceField(wind(0.f));
    world.setForceFieldEnabled(field, false);
    world.setCollisionGroups(field, 0x2u, 0x2u);
    CHECK(world.staticContentHash() == other.staticContentHash());  // edits the field, never a mesh
  }

  SECTION("force fields") {
    const auto fill = [&](PhysicsWorld& world) {
      for (std::size_t i = 0; i < STATIC_HANDLE_CAPACITY; ++i) {
        REQUIRE(world.addForceField(wind(static_cast<float>(i) * 0.01f)) ==
                FORCE_FIELD_ID_BASE - static_cast<int>(i));
      }
      CHECK(world.getDroppedStaticCount() == 0);
    };
    PhysicsWorld world;
    PhysicsWorld other;
    fill(world);
    fill(other);

    // The 1001st field used to be handed -8000, the first static sphere's id.
    CHECK(world.addForceField(wind(50.f)) == STATIC_HANDLE_OVERFLOW);
    CHECK(other.addForceField(wind(-50.f)) == STATIC_HANDLE_OVERFLOW);
    CHECK(world.getDroppedStaticCount() == 1);
    CHECK(world.staticContentHash() == other.staticContentHash());
    CHECK(world.getStateHash() == other.getStateHash());

    const int sphere = world.addStaticSphere(0.f, 0.f, 0.f, 0.1f, 0.4f, 0.2f);
    CHECK(sphere == STATIC_SPHERE_ID_BASE);
    const uint64_t withSphere = world.getStateHash();
    world.setForceFieldEnabled(sphere, false);
    world.setForceFieldVector(sphere, 5.f, 5.f, 5.f);
    CHECK(world.getStateHash() == withSphere);  // a sphere id names no field

    world.clearStaticGeometry();
    CHECK(world.getDroppedStaticCount() == 0);
    CHECK(world.addForceField(wind(0.f)) == FORCE_FIELD_ID_BASE);
  }
}

TEST_CASE("field ids at the integer limits are rejected and never decoded",
          "[physics][static-handles]") {
  PhysicsWorld world;
  ForceFieldDesc desc;
  desc.force = {0.f, 1.f, 0.f};
  world.addForceField(desc);
  world.addForceField(desc);
  PinFieldDesc pins;
  pins.rows = 2;
  pins.cols = 2;
  world.addPinField(pins);
  const uint64_t state = world.getStateHash();

  // INT_MAX is also STATIC_HANDLE_OVERFLOW, the id a refused add*() returns:
  // BASE - id used to overflow before any range check.
  const int fieldCount = 2;
  const int pinFieldCount = 1;
  for (const int id : {INT_MIN, INT_MAX, STATIC_HANDLE_OVERFLOW, -1, 0,
                       FORCE_FIELD_ID_BASE + 1, FORCE_FIELD_ID_BASE - fieldCount,
                       PIN_FIELD_ID_BASE + 1, PIN_FIELD_ID_BASE - pinFieldCount}) {
    INFO("id " << id);
    world.setForceFieldEnabled(id, false);
    world.setForceFieldVector(id, 9.f, 9.f, 9.f);
    CHECK(world.getPinFieldPinCount(id) == -1);
    CHECK(world.getStateHash() == state);
  }
  CHECK(world.getPinFieldPinCount(PIN_FIELD_ID_BASE) == 4);
}
