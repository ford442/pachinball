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
