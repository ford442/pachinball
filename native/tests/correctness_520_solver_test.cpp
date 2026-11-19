/**
 * Regression tests for the #520 §1 correctness rows that move the numbers
 * (rows 1, 3, 6, 7, 11; row 4 is shape_contacts_test.cpp): each one failed
 * before its fix. Their golden traces and replay tapes were re-recorded with
 * the fix that needed them.
 *
 *   npm run test:native
 */

#include "PhysicsWorld.h"
#include "test_helpers.hpp"

#include <catch2/catch_test_macros.hpp>

#include <algorithm>
#include <cmath>
#include <set>
#include <vector>

using namespace pachinball;
using namespace pachinball::test;

namespace {

struct PhaseCounts {
  int enters = 0;
  int stays = 0;
  int exits = 0;
  std::set<int> enteredPins;
};

} // namespace

// ---- Row 7: a pin is its own contact ---------------------------------------

TEST_CASE("a ball rolling pin to pin enters every pin it touches", "[520][contacts]") {
  // A pin field is one collider. Keyed by (body, field) alone, a ball rolling
  // along a row of pins was one Enter and then a single long Stay — per-pin
  // scoring and hit audio heard the first pin only.
  WorldParams params;
  params.gravity = {3.f, 0.f, -9.81f};  // along the row, and into it
  PhysicsWorld w(params);
  PinFieldDesc pins;
  pins.rows = 1;
  pins.cols = 10;
  pins.spacingX = 0.25f;
  pins.radius = 0.05f;
  pins.halfHeight = 0.5f;
  pins.restitution = 0.f;
  pins.friction = 0.f;
  const int field = w.addPinField(pins);

  RigidBodyDesc ball;
  ball.position = {-0.1f, 0.f, 0.22f};
  ball.velocity = {1.5f, 0.f, 0.f};
  ball.radius = 0.2f;
  ball.restitution = 0.f;
  ball.friction = 0.f;
  ball.linearDamping = 0.f;
  w.createRigidBody(ball);

  PhaseCounts counts;
  std::set<int> touched;
  for (int f = 0; f < 90; ++f) {
    w.step(FIXED_DT);
    for (const ContactEvent& e : w.lastContactEvents()) {
      if (e.bodyId2 != field) continue;
      touched.insert(e.subIndex);
      if (e.phase == ContactPhase::Enter) {
        ++counts.enters;
        counts.enteredPins.insert(e.subIndex);
      } else if (e.phase == ContactPhase::Exit) {
        ++counts.exits;
      }
    }
  }

  REQUIRE(touched.size() >= 5);
  CHECK(counts.enteredPins == touched);           // every pin touched had its own Enter
  CHECK(counts.enters == static_cast<int>(touched.size()));
  CHECK(counts.exits == counts.enters - 1);       // all but the pin it is still on
}

TEST_CASE("two pins touched in one step are two contacts", "[520][contacts]") {
  WorldParams params;
  params.gravity = {0.f, 0.f, -9.81f};
  PhysicsWorld w(params);
  PinFieldDesc pins;
  pins.rows = 1;
  pins.cols = 2;
  pins.spacingX = 0.3f;
  pins.radius = 0.05f;
  pins.halfHeight = 0.5f;
  const int field = w.addPinField(pins);

  RigidBodyDesc ball;
  ball.position = {0.15f, 0.f, 0.2f};  // cradled between the two pins
  ball.radius = 0.2f;
  w.createRigidBody(ball);

  w.step(FIXED_DT);
  std::vector<int> subs;
  for (const ContactEvent& e : w.lastContactEvents()) {
    if (e.bodyId2 == field) subs.push_back(e.subIndex);
  }
  CHECK(subs == std::vector<int>{0, 1});  // ContactKey order: pair, then pin
}

// ---- Row 1: the hinge motor clamp bounds the accumulated impulse ----------

namespace {

struct Blade {
  int body = -1;
  int hinge = -1;
};

/** A 1 kg capsule blade along world x, hinged about +Y at `anchorX` (0 = its centre). */
Blade addBlade(PhysicsWorld& w, float anchorX, float minAngle = -3.14159265f, float maxAngle = 3.14159265f) {
  RigidBodyDesc d;
  d.position = {0.f, 0.f, 0.f};
  d.mass = 1.f;
  d.radius = 0.1f;
  d.shape = Shape::Capsule;
  d.capsuleHalfHeight = 0.5f;
  d.angularDamping = 0.f;
  d.linearDamping = 0.f;
  Blade b;
  b.body = w.createRigidBody(d);
  w.setBodyRotation(b.body, 0.f, 0.f, 0.70710677f, 0.70710677f);  // local +Y → world -x
  HingeDesc h;
  h.worldAnchor = {anchorX, 0.f, 0.f};
  h.worldAxis = {0.f, 1.f, 0.f};
  h.minAngle = minAngle;
  h.maxAngle = maxAngle;
  b.hinge = w.createHinge(b.body, h);
  return b;
}

WorldParams zeroGravity(int iterations) {
  WorldParams p;
  p.gravity = {0.f, 0.f, 0.f};
  p.solverIterations = iterations;
  return p;
}

} // namespace

TEST_CASE("a saturated hinge motor is as strong at every solverIterations", "[520][hinge]") {
  // The motor's maxTorque bound was applied to each iteration's lambda, so a
  // motor that could not reach its target velocity added maxTorque·dt per
  // iteration: 8 iterations made the flipper 8× as strong as 1 did.
  constexpr float kMaxTorque = 5.f;
  std::vector<float> spin;
  for (int iterations : {1, 4, 8, 16}) {
    PhysicsWorld w(zeroGravity(iterations));
    const Blade b = addBlade(w, 0.f);
    w.setHingeMotor(b.hinge, 100.f, kMaxTorque);  // unreachable in one step
    w.step(FIXED_DT);
    spin.push_back(readAngVel(w, b.body).y);
  }

  // Capsule r = 0.1, h = 1: I = (½mr² + 2·m(3r² + h²)/12) / 3.
  const float inertia = (0.5f * 0.01f + 2.f * (0.03f + 1.f) / 12.f) / 3.f;
  const float expected = kMaxTorque * FIXED_DT / inertia;
  for (float w : spin) {
    CHECK(std::fabs(w - expected) <= 1e-4f * expected);
  }
}

TEST_CASE("an off-centre flipper swings the same at 4 and 8 iterations", "[520][hinge]") {
  // Pivot at one end (a real flipper): the anchor's linear rows also act, so
  // the two counts are not bit-identical, but the motor no longer doubles.
  float angle4 = 0.f;
  float angle8 = 0.f;
  for (int iterations : {4, 8}) {
    PhysicsWorld w(zeroGravity(iterations));
    const Blade b = addBlade(w, -0.6f);
    for (int f = 0; f < 6; ++f) {
      w.setHingeMotor(b.hinge, 40.f, 3.f);
      w.step(FIXED_DT);
    }
    (iterations == 4 ? angle4 : angle8) = w.getHingeAngle(b.hinge);
  }
  REQUIRE(angle4 > 0.f);
  CHECK(std::fabs(angle8 - angle4) <= 0.1f * angle4);
}

TEST_CASE("a hinge limit holds a motor driving into it at any iteration count", "[520][hinge]") {
  for (int iterations : {1, 4, 8}) {
    PhysicsWorld w(zeroGravity(iterations));
    const Blade b = addBlade(w, -0.6f, -0.3f, 0.3f);
    for (int f = 0; f < 120; ++f) {
      w.setHingeMotor(b.hinge, 20.f, 50.f);
      w.step(FIXED_DT);
    }
    INFO("solverIterations " << iterations);
    CHECK(w.getHingeAngle(b.hinge) < 0.3f + 0.02f);
    CHECK(w.getHingeAngle(b.hinge) > 0.3f - 0.05f);
  }
}

// ---- Row 11: a plane has its own restitution -------------------------------

namespace {

/** Peak upward speed after a 0.8-restitution body falls 2 m onto a y = 0 plane. */
float reboundSpeed(Shape shape, float planeRestitution) {
  WorldParams params;
  params.gravity = {0.f, -9.81f, 0.f};
  PhysicsWorld w(params);
  w.addStaticPlane(0.f, 1.f, 0.f, 0.f, 0.f, planeRestitution);
  RigidBodyDesc d;
  d.shape = shape;
  d.position = {0.f, 2.f, 0.f};
  d.radius = 0.2f;
  d.boxHalfExtents = {0.2f, 0.2f, 0.2f};
  d.restitution = 0.8f;
  d.friction = 0.f;
  d.linearDamping = 0.f;
  d.angularDamping = 0.f;
  const int id = w.createRigidBody(d);
  float peak = 0.f;
  for (int f = 0; f < 90; ++f) {
    w.step(FIXED_DT);
    peak = std::max(peak, readVel(w, id).y);
  }
  return peak;
}

} // namespace

TEST_CASE("plane restitution combines by min for spheres and boxes alike", "[520][plane]") {
  // ~6 m/s at impact. Spheres used to bounce with their own 0.8 whatever the
  // plane, and boxes always met a hard-coded 0.4.
  const float impact = std::sqrt(2.f * 9.81f * 1.8f);

  CHECK(reboundSpeed(Shape::Sphere, 0.f) < 0.05f * impact);
  CHECK(reboundSpeed(Shape::Box, 0.f) < 0.05f * impact);

  const float sphereHalf = reboundSpeed(Shape::Sphere, 0.5f);
  CHECK(sphereHalf > 0.45f * impact);
  CHECK(sphereHalf < 0.55f * impact);

  // No restitution given: the body's own 0.8, for the crate as well.
  CHECK(reboundSpeed(Shape::Sphere, PLANE_DEFAULT_RESTITUTION) > 0.75f * impact);
  CHECK(reboundSpeed(Shape::Box, PLANE_DEFAULT_RESTITUTION) > 0.6f * impact);
}

TEST_CASE("a non-finite or negative plane restitution falls back to the default", "[520][plane]") {
  const float impact = std::sqrt(2.f * 9.81f * 1.8f);
  CHECK(reboundSpeed(Shape::Sphere, std::nanf("")) > 0.75f * impact);
  CHECK(reboundSpeed(Shape::Sphere, -1.f) > 0.75f * impact);
}

// ---- Row 6: a pose push spans every substep of its tick --------------------

namespace {

/** Peak upward speed of a ball resting on a piston that rises 0.3 m in one tick of `substeps` fixed steps. */
float pistonLaunchSpeed(int substeps) {
  WorldParams params;
  params.gravity = {0.f, 0.f, 0.f};
  PhysicsWorld w(params);
  KinematicMoverDesc piston;
  piston.position = {0.f, 0.f, 0.f};
  piston.halfExtents = {0.5f, 0.1f, 0.5f};
  piston.restitution = 0.f;
  const int pistonId = w.addKinematicMover(piston);
  RigidBodyDesc ball;
  ball.position = {0.f, 0.3f, 0.f};
  ball.radius = 0.2f;
  ball.restitution = 0.f;
  ball.linearDamping = 0.f;
  const int id = w.createRigidBody(ball);

  w.setNextKinematicTransform(pistonId, 0.f, 0.3f, 0.f, 0.f, 0.f, 0.f, 1.f);
  w.step(static_cast<float>(substeps) * FIXED_DT);
  return readVel(w, id).y;
}

} // namespace

TEST_CASE("a mover's velocity is its push over the whole tick", "[520][kinematic]") {
  // 0.3 m over one fixed step is 18 m/s; over two it is 9. The old step()
  // derived the velocity over one fixed step whatever the tick ran, so a
  // 30 fps tick launched the ball at 18.
  const float oneStep = pistonLaunchSpeed(1);
  const float twoSteps = pistonLaunchSpeed(2);
  CHECK(oneStep > 0.9f * 18.f);
  CHECK(twoSteps > 0.9f * 9.f);
  CHECK(twoSteps < 1.1f * 9.f);
}

TEST_CASE("a kinematic body moves substep by substep and carries the tick's velocity", "[520][kinematic]") {
  WorldParams params;
  params.gravity = {0.f, 0.f, 0.f};
  PhysicsWorld w(params);
  RigidBodyDesc d;
  d.position = {0.f, 1.f, 0.f};
  const int id = w.createRigidBody(d);
  w.setBodyType(id, BodyType::Kinematic);

  w.setNextKinematicTransform(id, 0.6f, 1.f, 0.f, 0.f, 0.f, 0.f, 1.f);
  w.step(2.f * FIXED_DT);  // two substeps (step() caps a tick at 1/30 s)
  CHECK(near(readPos(w, id).x, 0.6f, 1e-6f));
  CHECK(near(readVel(w, id).x, 0.6f / (2.f * FIXED_DT), 1e-3f));  // 18 m/s, not 36
}

TEST_CASE("a tick that runs no substep leaves the pose push pending", "[520][kinematic]") {
  WorldParams params;
  params.gravity = {0.f, 0.f, 0.f};
  PhysicsWorld w(params);
  RigidBodyDesc d;
  d.position = {0.f, 1.f, 0.f};
  const int id = w.createRigidBody(d);
  w.setBodyType(id, BodyType::Kinematic);

  w.setNextKinematicTransform(id, 0.5f, 1.f, 0.f, 0.f, 0.f, 0.f, 1.f);
  w.step(0.25f * FIXED_DT);  // accumulates, no substep
  CHECK(readPos(w, id).x == 0.f);  // it used to teleport here, with no substep to see it
  w.step(0.75f * FIXED_DT);
  CHECK(near(readPos(w, id).x, 0.5f, 1e-6f));
  CHECK(near(readVel(w, id).x, 0.5f / FIXED_DT, 1e-2f));
}
