/**
 * #520 row 4: dynamic capsules and boxes meet static geometry as capsules
 * and boxes (ShapeContacts.cpp). Every case here failed on the old
 * dispatch, which treated them as a sphere at their centre or skipped the
 * pair.
 *
 *   npm run test:native
 */

#include "PhysicsWorld.h"
#include "test_helpers.hpp"

#include <catch2/catch_test_macros.hpp>

#include <algorithm>
#include <cmath>
#include <cstdint>

using namespace pachinball;
using namespace pachinball::test;

// ---- Row 4: capsules and boxes meet statics as capsules and boxes ----------

namespace {

constexpr float kCapRadius = 0.1f;
constexpr float kCapHalf = 0.5f;

int addCapsuleBody(PhysicsWorld& w, const Vec3& at, const Quat& rotation) {
  RigidBodyDesc d;
  d.shape = Shape::Capsule;
  d.position = at;
  d.radius = kCapRadius;
  d.capsuleHalfHeight = kCapHalf;
  d.mass = 1.f;
  d.restitution = 0.f;
  d.friction = 0.5f;
  const int id = w.createRigidBody(d);
  w.setBodyRotation(id, rotation.x, rotation.y, rotation.z, rotation.w);
  return id;
}

int addCrate(PhysicsWorld& w, const Vec3& at, float half = 0.25f) {
  RigidBodyDesc d;
  d.shape = Shape::Box;
  d.position = at;
  d.boxHalfExtents = {half, half, half};
  d.radius = 0.1f;  // what the sphere fallback used to read
  d.mass = 0.5f;
  d.restitution = 0.f;
  d.friction = 0.5f;
  return w.createRigidBody(d);
}

/** World y of both capsule segment ends. */
void capsuleEnds(const PhysicsWorld& w, int id, float& lowY, float& highY) {
  const Vec3 p = readPos(w, id);
  const Vec3 axis = readRot(w, id).rotate(Vec3{0.f, kCapHalf, 0.f});
  lowY = std::min(p.y - axis.y, p.y + axis.y);
  highY = std::max(p.y - axis.y, p.y + axis.y);
}

WorldParams downward() {
  WorldParams p;
  p.gravity = {0.f, -9.81f, 0.f};
  return p;
}

const Quat kAlongX{0.f, 0.f, 0.70710677f, 0.70710677f};  // local +Y → world -x

} // namespace

TEST_CASE("a capsule falling end-first onto a plane lands on its end cap", "[520][shapes]") {
  // As a sphere at its centre, the lower half of the capsule sank through.
  PhysicsWorld w(downward());
  w.addStaticPlane(0.f, 1.f, 0.f, 0.f);
  const int id = addCapsuleBody(w, {0.f, 1.5f, 0.f}, Quat::identity());
  stepFixed(w, 90);
  float low = 0.f;
  float high = 0.f;
  capsuleEnds(w, id, low, high);
  CHECK(low - kCapRadius > -0.02f);
}

TEST_CASE("a tilted capsule settles flat on a static box floor", "[520][shapes]") {
  PhysicsWorld w(downward());
  w.addStaticBox(0.f, -0.5f, 0.f, 3.f, 0.5f, 3.f, 0.f, 0.f, 0.f, 1.f, 0.f, 0.5f);
  // 15° off horizontal, lower end 0.05 m above the floor.
  const Quat tilt = Quat{0.f, 0.f, 0.13052619f, 0.99144486f} * kAlongX;
  const int id = addCapsuleBody(w, {0.f, kCapRadius + 0.05f + 0.5f * std::sin(0.2617994f), 0.f}, tilt);
  stepFixed(w, 120);
  float low = 0.f;
  float high = 0.f;
  capsuleEnds(w, id, low, high);
  CHECK(low - kCapRadius > -0.02f);   // neither end inside the floor
  CHECK(high - low < 0.05f);          // lying flat on both ends
}

TEST_CASE("a capsule meets static cylinders, spheres, capsules and triangles", "[520][shapes]") {
  // Cylinders and spheres were skipped for capsules; capsules and triangles
  // saw a sphere at its centre, so the leading half went through first. A
  // capsule along x slides end-first into each wall (near face at x = 0).
  auto runInto = [](auto addWall) {
    WorldParams params;
    params.gravity = {0.f, 0.f, 0.f};
    PhysicsWorld w(params);
    addWall(w);
    const int id = addCapsuleBody(w, {-1.f, 0.f, 0.f}, kAlongX);
    w.setVelocity(id, 2.f, 0.f, 0.f);
    stepFixed(w, 60);
    return readPos(w, id).x;
  };
  const float cylinder = runInto([](PhysicsWorld& w) {
    w.addStaticCylinder(0.2f, 0.f, 0.f, 0.2f, 0.5f, 0.f, 0.f, 0.f, 1.f, 0.f, 0.f);
  });
  const float sphere = runInto([](PhysicsWorld& w) { w.addStaticSphere(0.2f, 0.f, 0.f, 0.2f, 0.f, 0.f); });
  const float capsule = runInto([](PhysicsWorld& w) {
    w.addStaticCapsule(0.1f, 0.f, 0.f, 0.1f, 0.5f, 0.70710677f, 0.f, 0.f, 0.70710677f, 0.f, 0.f);  // along z
  });
  const float triangle = runInto([](PhysicsWorld& w) {
    const float v[] = {0.f, -0.5f, -1.f, 0.f, -0.5f, 1.f, 0.f, 0.5f, 0.f};  // facing -x
    const uint32_t idx[] = {0, 1, 2};
    w.addStaticTriangleMesh(v, 3, idx, 3, 0.f, 0.f, false);
  });
  // The leading cap touches the wall with the centre at x = -(0.5 + 0.1).
  for (float x : {cylinder, sphere, capsule, triangle}) {
    CHECK(x < -0.55f);
    CHECK(x > -0.65f);
  }
}

TEST_CASE("a crate rests on static spheres, capsules, cylinders and cones", "[520][shapes]") {
  // Spheres, cylinders and cones were skipped for boxes (the crate fell
  // through); a static capsule met a sphere of the crate's `radius` (0.1)
  // at its centre, so it sank to 0.1 above the rail.
  auto restHeight = [](auto addSupport) {
    PhysicsWorld w(downward());
    addSupport(w);
    const int id = addCrate(w, {0.f, 1.f, 0.f});
    stepFixed(w, 120);
    return readPos(w, id).y;
  };
  // Each support's top is at y = 0.5, so the crate's centre should rest at 0.75.
  const float sphere = restHeight([](PhysicsWorld& w) { w.addStaticSphere(0.f, 0.2f, 0.f, 0.3f, 0.f, 0.5f); });
  const float capsule = restHeight([](PhysicsWorld& w) {
    w.addStaticCapsule(0.f, 0.4f, 0.f, 0.1f, 1.f, 0.70710677f, 0.f, 0.f, 0.70710677f, 0.f, 0.5f);
  });
  const float cylinder = restHeight([](PhysicsWorld& w) {
    w.addStaticCylinder(0.f, 0.25f, 0.f, 0.6f, 0.25f, 0.f, 0.f, 0.f, 1.f, 0.f, 0.5f);
  });
  const float cone = restHeight([](PhysicsWorld& w) {
    w.addStaticCone(0.f, 0.25f, 0.f, 0.5f, 0.25f, 0.f, 0.f, 0.f, 1.f, 0.f, 0.5f);  // apex at y = 0.5
  });
  INFO("sphere " << sphere << " capsule " << capsule << " cylinder " << cylinder << " cone " << cone);
  for (float y : {sphere, capsule, cylinder, cone}) {
    CHECK(y > 0.75f - 0.03f);
    CHECK(y < 0.75f + 0.03f);
  }
}

TEST_CASE("a crate is stopped by a pin row and lifted by a piston", "[520][shapes]") {
  {
    WorldParams params;
    params.gravity = {0.f, 0.f, 0.f};
    PhysicsWorld w(params);
    PinFieldDesc pins;
    pins.rows = 1;
    pins.cols = 8;
    pins.spacingX = 0.2f;
    pins.radius = 0.04f;
    pins.halfHeight = 0.5f;
    pins.restitution = 0.f;
    const int field = w.addPinField(pins);  // a fence along x at z = 0
    const int id = addCrate(w, {0.7f, 0.f, -1.f}, 0.2f);
    w.setVelocity(id, 0.f, 0.f, 3.f);
    bool touched = false;
    for (int f = 0; f < 60; ++f) {
      w.step(FIXED_DT);
      for (const ContactEvent& e : w.lastContactEvents()) touched |= e.bodyId1 == id && e.bodyId2 == field;
    }
    CHECK(touched);
    CHECK(readPos(w, id).z < -0.2f);  // front face at z = -0.04 at most
  }
  {
    PhysicsWorld w(downward());
    KinematicMoverDesc piston;
    piston.position = {0.f, 0.f, 0.f};
    piston.halfExtents = {0.6f, 0.1f, 0.6f};
    const int pistonId = w.addKinematicMover(piston);
    const int id = addCrate(w, {0.f, 0.36f, 0.f});
    stepFixed(w, 30);
    for (int f = 0; f < 30; ++f) {
      w.setNextKinematicTransform(pistonId, 0.f, 0.01f * static_cast<float>(f + 1), 0.f, 0.f, 0.f, 0.f, 1.f);
      w.step(FIXED_DT);
    }
    // Piston top at 0.4: the crate rests on it at 0.65 (as a sphere of radius
    // 0.1 it sat at 0.5, half sunk into the piston).
    CHECK(readPos(w, id).y > 0.65f - 0.03f);
  }
}
