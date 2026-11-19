/**
 * Regression tests for the #520 §1 correctness rows that move the numbers
 * (rows 1, 3, 4, 6, 7, 11): each one failed before its fix. Their golden
 * traces and replay tapes were re-recorded with the fix that needed them.
 *
 *   npm run test:native
 */

#include "PhysicsWorld.h"
#include "test_helpers.hpp"

#include <catch2/catch_test_macros.hpp>

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
