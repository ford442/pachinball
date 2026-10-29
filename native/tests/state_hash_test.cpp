/**
 * PhysicsWorld::getStateHash() (#459 Slice A) — the cheap "same world?" check
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
#include <cstring>
#include <fstream>
#include <limits>
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

// ---------------------------------------------------------------------------
// Non-finite bodies (#487 slice 1a). WASM and native disagree on NaN payloads
// and on min/max of a NaN operand, so a NaN must neither reach the hash as raw
// bits nor live long enough to be paired with a healthy body.
// ---------------------------------------------------------------------------

namespace {

float nanWithBits(uint32_t bits) {
  float f = 0.f;
  std::memcpy(&f, &bits, sizeof f);
  return f;
}

uint32_t bitsOf(float f) {
  uint32_t u = 0;
  std::memcpy(&u, &f, sizeof u);
  return u;
}

bool sameBits(const Vec3& a, const Vec3& b) {
  return bitsOf(a.x) == bitsOf(b.x) && bitsOf(a.y) == bitsOf(b.y) && bitsOf(a.z) == bitsOf(b.z);
}

WorldParams stillWorld() {
  WorldParams params;
  params.gravity = {0.f, 0.f, 0.f};
  params.sleepFramesRequired = 1;  // a resting ball sleeps on its first substep
  return params;
}

RigidBodyDesc ballAt(Vec3 position, Vec3 velocity) {
  RigidBodyDesc d;
  d.position = position;
  d.velocity = velocity;
  d.radius = 0.2f;
  d.linearDamping = 0.f;
  return d;
}

} // namespace

TEST_CASE("a NaN body is quarantined on its first substep and the hash is payload-invariant",
          "[state-hash][nan]") {
  struct Scene {
    int roller = -1;
    int frozen = -1;
  };
  const auto build = [](PhysicsWorld& w) {
    Scene s;
    s.roller = w.createRigidBody(ballAt({-2.f, 0.5f, 0.f}, {1.5f, 0.f, 0.f}));
    s.frozen = w.createRigidBody(ballAt({0.f, 0.5f, 0.f}, {0.f, 0.f, 0.f}));
    return s;
  };
  PhysicsWorld quietNaN(stillWorld());
  PhysicsWorld loudNaN(stillWorld());
  PhysicsWorld asleep(stillWorld());  // the reference: the same ball, simply at rest
  const Scene s = build(quietNaN);
  build(loudNaN);
  build(asleep);
  quietNaN.setVelocity(s.frozen, nanWithBits(0x7fc00001u), 0.f, 0.f);
  loudNaN.setVelocity(s.frozen, nanWithBits(0xffffffffu), 0.f, 0.f);

  // Two payloads, one hash: the hasher canonicalises NaN.
  CHECK(quietNaN.getStateHash() == loudNaN.getStateHash());

  quietNaN.step(FIXED_DT);
  loudNaN.step(FIXED_DT);
  asleep.step(FIXED_DT);

  for (const PhysicsWorld* w : {&quietNaN, &loudNaN}) {
    REQUIRE(w->lastNaNQuarantines().size() == 1);
    const NaNQuarantine& q = w->lastNaNQuarantines()[0];
    CHECK(q.bodyId == s.frozen);
    CHECK(q.step == 0);
    CHECK(q.substep == 0);
    // Frozen where the substep started, at rest, asleep.
    CHECK(sameBits(readPos(*w, s.frozen), {0.f, 0.5f, 0.f}));
    CHECK(sameBits(readVel(*w, s.frozen), Vec3::zero()));
    CHECK(sameBits(readAngVel(*w, s.frozen), Vec3::zero()));
    CHECK(w->getActiveBodyCount() == 1);  // only the roller
  }
  CHECK(quietNaN.getStateHash() == loudNaN.getStateHash());
  CHECK(asleep.lastNaNQuarantines().empty());
  CHECK(asleep.getActiveBodyCount() == 1);

  // Nothing leaked: the roller meets the frozen ball exactly as it meets the
  // sleeping one, and both carry on bit for bit.
  for (int f = 0; f < 120; ++f) {
    quietNaN.step(FIXED_DT);
    asleep.step(FIXED_DT);
    CHECK(quietNaN.lastNaNQuarantines().empty());
    for (const int id : {s.roller, s.frozen}) {
      INFO("frame " << f << " body " << id);
      REQUIRE(sameBits(readPos(quietNaN, id), readPos(asleep, id)));
      REQUIRE(sameBits(readVel(quietNaN, id), readVel(asleep, id)));
    }
  }
  CHECK(readVel(asleep, s.frozen).x > 0.1f);  // the collision did happen
}

TEST_CASE("a body created at a non-finite pose is quarantined at the origin", "[state-hash][nan]") {
  PhysicsWorld world(stillWorld());
  const float inf = std::numeric_limits<float>::infinity();
  const int lost = world.createRigidBody(ballAt({std::numeric_limits<float>::quiet_NaN(), 1.f, inf},
                                                {0.f, 0.f, 0.f}));
  const int healthy = world.createRigidBody(ballAt({3.f, 0.5f, 0.f}, {1.f, 0.f, 0.f}));

  world.step(FIXED_DT);
  REQUIRE(world.lastNaNQuarantines().size() == 1);
  CHECK(world.lastNaNQuarantines()[0].bodyId == lost);
  CHECK(sameBits(readPos(world, lost), Vec3::zero()));
  const Quat q = readRot(world, lost);
  CHECK((q.x == 0.f && q.y == 0.f && q.z == 0.f && q.w == 1.f));
  CHECK(isFinite(readPos(world, healthy)));

  world.step(FIXED_DT);
  CHECK(world.lastNaNQuarantines().empty());
  CHECK(world.getActiveBodyCount() == 1);
}

TEST_CASE("state hash: writes the NaN quarantine parity fixture", "[state-hash][nan]") {
  // The §NaN quarantine block of scripts/run-wasm-parity.mjs builds this
  // scene through Embind — keep the two in step. The NaN here carries payload
  // 0xffffffff; the bundle's is whatever JS hands it (0x7fc00000), so equal
  // hashes mean both builds canonicalised it, then froze the ball alike.
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);
  world.addStaticBox(0.f, -0.5f, 0.f, 4.f, 0.5f, 4.f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f);
  RigidBodyDesc ball;
  ball.radius = 0.25f;
  ball.restitution = 0.5f;
  ball.linearDamping = 0.02f;
  ball.friction = 0.2f;
  ball.angularDamping = 0.1f;
  ball.position = {-1.f, 0.25f, 0.f};
  ball.velocity = {4.f, 0.f, 0.f};
  const int roller = world.createRigidBody(ball);
  ball.position = {0.5f, 0.25f, 0.f};
  ball.velocity = {0.f, 0.f, 0.f};
  const int lost = world.createRigidBody(ball);

  stepFixed(world, 10);
  world.setVelocity(lost, nanWithBits(0xffffffffu), 0.f, 0.f);
  const uint64_t withNaN = world.getStateHash();
  world.step(FIXED_DT);
  REQUIRE(world.lastNaNQuarantines().size() == 1);
  CHECK(world.lastNaNQuarantines()[0].bodyId == lost);
  stepFixed(world, 49);
  CHECK(isFinite(readPos(world, lost)));
  CHECK(readVel(world, lost).x > 0.f);  // the roller woke it
  CHECK(isFinite(readPos(world, roller)));

  if (const char* path = std::getenv("PACHINBALL_NAN_QUARANTINE_FIXTURE")) {
    char hex[34];
    std::snprintf(hex, sizeof hex, "%016llx %016llx", static_cast<unsigned long long>(withNaN),
                  static_cast<unsigned long long>(world.getStateHash()));
    std::ofstream out(path);
    REQUIRE(out.good());
    out << hex;
  }
}
