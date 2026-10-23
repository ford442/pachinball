/**
 * PhysicsWorld::getStateHash() (#463 Slice A) — the cheap "same world?" check
 * a headless replay verifier compares instead of shipping snapshot blobs.
 *
 * The plunge scene uses today's gameplay numbers: ball radius 0.25, mass 1,
 * plunger impulse 36 (src/config/physics.ts) fired up a lane into a 0.09
 * radius pin field. `PACHINBALL_STATE_HASH_FIXTURE=<path>` writes the hash at
 * PLUNGE_FRAMES as 16 hex chars so scripts/run-wasm-parity.mjs can compare the
 * WASM bundle against it. Keep `buildPlungeScene` / `drivePlunge` in step with
 * the §state hash block of that script.
 */

#include "PhysicsWorld.h"
#include "test_helpers.hpp"

#include <catch2/catch_test_macros.hpp>

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <vector>

using namespace pachinball;
using namespace pachinball::test;

namespace {

constexpr int PLUNGE_AT     = 10;
constexpr int SNAPSHOT_AT   = 40;
constexpr int PLUNGE_FRAMES = 120;

struct PlungeScene {
  int ball = -1;
  int flipper = -1;
  int hinge = -1;
};

PlungeScene buildPlungeScene(PhysicsWorld& w) {
  PlungeScene s;
  w.addStaticBox(0.f, -0.5f, 0.f, 4.f, 0.5f, 10.f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f);   // floor
  w.addStaticBox(-4.5f, 1.f, 0.f, 0.5f, 1.f, 10.f, 0.f, 0.f, 0.f, 1.f, 0.6f, 0.1f);   // left wall
  w.addStaticBox(4.5f, 1.f, 0.f, 0.5f, 1.f, 10.f, 0.f, 0.f, 0.f, 1.f, 0.6f, 0.1f);    // right wall
  w.addStaticBox(0.f, 1.f, 10.5f, 4.f, 1.f, 0.5f, 0.f, 0.f, 0.f, 1.f, 0.6f, 0.1f);    // top wall

  PinFieldDesc pins;
  pins.origin = {-2.7f, 0.75f, 2.f};
  pins.rows = 8;
  pins.cols = 10;
  pins.spacingX = 0.6f;
  pins.spacingZ = 0.6f;
  pins.rowOffsetX = 0.3f;
  pins.radius = 0.09f;
  pins.halfHeight = 0.75f;
  pins.restitution = 0.65f;
  pins.friction = 0.1f;
  w.addPinField(pins);

  RigidBodyDesc ball;
  ball.position = {0.1f, 0.25f, -8.f};
  ball.mass = 1.f;
  ball.radius = 0.25f;
  ball.restitution = 0.5f;
  s.ball = w.createRigidBody(ball);

  RigidBodyDesc blade;
  blade.position = {1.5f, 0.3f, -6.f};
  blade.mass = 1.f;
  blade.radius = 0.12f;
  blade.shape = Shape::Capsule;
  blade.capsuleHalfHeight = 0.6f;
  s.flipper = w.createRigidBody(blade);
  w.setBodyRotation(s.flipper, 0.f, 0.f, 0.70710677f, 0.70710677f);
  HingeDesc hinge;
  hinge.worldAnchor = {0.9f, 0.3f, -6.f};
  hinge.worldAxis = {0.f, 1.f, 0.f};
  hinge.minAngle = -0.5f;
  hinge.maxAngle = 0.5f;
  s.hinge = w.createHinge(s.flipper, hinge);
  return s;
}

/** The input tape: a full-power plunge at PLUNGE_AT, a flipper flapping. */
void drivePlunge(PhysicsWorld& w, const PlungeScene& s, int frame) {
  if (frame == PLUNGE_AT) w.applyImpulse(s.ball, 0.f, 0.f, 36.f);
  w.setHingeMotor(s.hinge, (frame % 40) < 20 ? 8.f : -8.f, 50.f);
}

void run(PhysicsWorld& w, const PlungeScene& s, int from, int to, int* pinTouches = nullptr) {
  for (int f = from; f < to; ++f) {
    drivePlunge(w, s, f);
    w.step(FIXED_DT);
    if (!pinTouches) continue;
    for (const ContactEvent& e : w.lastContactEvents()) {
      if (e.bodyId2 == PIN_FIELD_ID_BASE) ++*pinTouches;
    }
  }
}

std::vector<uint64_t> hashTrace(PhysicsWorld& w, const PlungeScene& s, int from, int to) {
  std::vector<uint64_t> out;
  for (int f = from; f < to; ++f) {
    run(w, s, f, f + 1);
    out.push_back(w.getStateHash());
  }
  return out;
}

} // namespace

TEST_CASE("state hash: same inputs give the same hash every step", "[state-hash]") {
  PhysicsWorld a;
  PhysicsWorld b;
  const PlungeScene sa = buildPlungeScene(a);
  const PlungeScene sb = buildPlungeScene(b);
  CHECK(a.getStateHash() == b.getStateHash());

  int pinTouches = 0;
  run(a, sa, 0, PLUNGE_AT + 1, &pinTouches);
  std::vector<uint64_t> ha = hashTrace(a, sa, PLUNGE_AT + 1, PLUNGE_FRAMES);
  run(b, sb, 0, PLUNGE_AT + 1);
  std::vector<uint64_t> hb = hashTrace(b, sb, PLUNGE_AT + 1, PLUNGE_FRAMES);
  CHECK((ha == hb));

  // The hash moves as the world steps (a frozen hash would prove nothing).
  for (std::size_t i = 1; i < ha.size(); ++i) CHECK(ha[i] != ha[i - 1]);

  // And the plunge actually reaches the pins.
  PhysicsWorld c;
  const PlungeScene sc = buildPlungeScene(c);
  run(c, sc, 0, PLUNGE_FRAMES, &pinTouches);
  CHECK(pinTouches > 0);
}

TEST_CASE("state hash: one touched value changes it", "[state-hash]") {
  PhysicsWorld a;
  PhysicsWorld b;
  const PlungeScene sa = buildPlungeScene(a);
  const PlungeScene sb = buildPlungeScene(b);
  run(a, sa, 0, SNAPSHOT_AT);
  run(b, sb, 0, SNAPSHOT_AT);
  REQUIRE(a.getStateHash() == b.getStateHash());

  const uint64_t before = b.getStateHash();
  const Vec3 v = readVel(b, sb.ball);
  b.setVelocity(sb.ball, v.x, v.y, std::nextafter(v.z, v.z + 1.f)); // one ulp
  CHECK(b.getStateHash() != before);
  b.setVelocity(sb.ball, v.x, v.y, v.z);
  CHECK(b.getStateHash() == before);

  // Motor target is solver input the next step reads.
  b.setHingeMotor(sb.hinge, 7.f, 50.f);
  CHECK(b.getStateHash() != before);
  b.setHingeMotor(sb.hinge, (SNAPSHOT_AT - 1) % 40 < 20 ? 8.f : -8.f, 50.f);
  CHECK(b.getStateHash() == before);

  // The static table is part of it: same bodies, different table.
  PhysicsWorld c;
  const PlungeScene sc = buildPlungeScene(c);
  run(c, sc, 0, SNAPSHOT_AT);
  REQUIRE(c.getStateHash() == before);
  c.addStaticSphere(3.f, 0.5f, 9.f, 0.2f);
  CHECK(c.getStateHash() != before);
}

TEST_CASE("state hash: restore gives back the original hash", "[state-hash]") {
  PhysicsWorld world;
  const PlungeScene s = buildPlungeScene(world);
  run(world, s, 0, SNAPSHOT_AT);
  const uint64_t atSnapshot = world.getStateHash();
  const std::vector<uint8_t> blob = world.serialize();
  CHECK(world.getStateHash() == atSnapshot); // serialize is read-only

  const std::vector<uint64_t> original = hashTrace(world, s, SNAPSHOT_AT, PLUNGE_FRAMES);
  REQUIRE(original.back() != atSnapshot);

  REQUIRE(world.restore(blob.data(), blob.size()) == SnapshotStatus::Ok);
  CHECK(world.getStateHash() == atSnapshot);
  CHECK((hashTrace(world, s, SNAPSHOT_AT, PLUNGE_FRAMES) == original));

  // A replay client: rebuild the statics only, then restore.
  PhysicsWorld fresh;
  buildPlungeScene(fresh); // same statics; its bodies are replaced by the blob
  REQUIRE(fresh.restore(blob.data(), blob.size()) == SnapshotStatus::Ok);
  CHECK(fresh.getStateHash() == atSnapshot);
  CHECK((hashTrace(fresh, s, SNAPSHOT_AT, PLUNGE_FRAMES) == original));
}

TEST_CASE("state hash: writes the parity fixture", "[state-hash]") {
  PhysicsWorld world;
  const PlungeScene s = buildPlungeScene(world);
  run(world, s, 0, PLUNGE_FRAMES);
  if (const char* path = std::getenv("PACHINBALL_STATE_HASH_FIXTURE")) {
    char hex[17];
    std::snprintf(hex, sizeof hex, "%016llx", static_cast<unsigned long long>(world.getStateHash()));
    std::ofstream out(path);
    REQUIRE(out.good());
    out << hex;
  }
}
