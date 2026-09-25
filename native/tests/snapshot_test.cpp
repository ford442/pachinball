/**
 * World snapshots (#422): serialize → restore → step must reproduce the
 * original run bit-for-bit, in the same world (rewind) and in a freshly
 * built one (replay start), and a snapshot must refuse a different table.
 *
 *   npm run test:native
 *
 * `PACHINBALL_SNAPSHOT_FIXTURE=<path>` also writes the parity scene's blob at
 * frame SNAPSHOT_AT so scripts/run-wasm-parity.mjs can compare the WASM
 * bundle's bytes against it. Keep `buildParityScene` / `driveParityScene` in
 * step with `snapshotParityScene` in that script.
 */

#include "PhysicsWorld.h"
#include "test_helpers.hpp"

#include <catch2/catch_test_macros.hpp>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <memory>
#include <vector>

using namespace pachinball;
using namespace pachinball::test;

namespace {

constexpr int SNAPSHOT_AT = 90;
constexpr int RUN_FRAMES  = 180;
constexpr int BALLS       = 5;

struct Scene {
  int balls[BALLS] = {};
  int flipper = -1;
  int hinge = -1;
  int piston = 0;
};

/** Static table only — also what a fresh replay world rebuilds before restore(). */
int buildStatics(PhysicsWorld& w, bool extraBox = false) {
  w.setGravity(0.f, -9.81f, -4.f);
  w.addStaticBox(0.f, -0.5f, 0.f, 6.f, 0.5f, 8.f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f);
  w.addStaticBox(0.f, 0.5f, -6.5f, 6.f, 1.f, 0.5f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f);
  for (int ix = -1; ix <= 1; ++ix) {
    for (int iz = 1; iz <= 2; ++iz) {
      w.addStaticCylinder(static_cast<float>(ix), 0.4f, static_cast<float>(iz),
                          0.1f, 0.4f, 0.f, 0.f, 0.f, 1.f, 0.6f, 0.1f);
    }
  }
  PinFieldDesc pins;
  pins.origin = {-2.f, 0.4f, 3.f};
  pins.rows = 4;
  pins.cols = 3;
  pins.spacingX = 0.6f;
  pins.spacingZ = 0.6f;
  pins.rowOffsetX = 0.3f;
  pins.radius = 0.08f;
  pins.halfHeight = 0.4f;
  pins.restitution = 0.6f;
  pins.friction = 0.1f;
  pins.dropoutSeed = 7;
  pins.dropout = 0.2f;
  w.addPinField(pins);

  KinematicMoverDesc piston;
  piston.position = {0.75f, 0.25f, -1.5f};
  piston.halfExtents = {0.5f, 0.2f, 0.5f};
  const int pistonId = w.addKinematicMover(piston);

  SensorVolumeDesc drain;
  drain.center = {0.f, 0.5f, -5.f};
  drain.halfExtents = {6.f, 0.5f, 0.4f};
  w.addSensorVolume(drain);

  ForceFieldDesc wind;
  wind.center = {-3.f, 0.5f, 0.f};
  wind.halfExtents = {1.f, 1.f, 1.f};
  wind.force = {0.f, 0.f, -3.f};
  wind.acceleration = true;
  w.addForceField(wind);

  if (extraBox) w.addStaticBox(4.f, 0.5f, 4.f, 0.2f, 0.2f, 0.2f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f);
  return pistonId;
}

Scene buildParityScene(PhysicsWorld& w) {
  Scene s;
  s.piston = buildStatics(w);
  for (int i = 0; i < BALLS; ++i) {
    RigidBodyDesc ball;
    ball.position = {-1.5f + 0.75f * static_cast<float>(i), 0.5f, 5.5f};
    ball.velocity = {0.f, 0.f, -2.f};
    ball.mass = 0.08f;
    ball.radius = 0.2f;
    ball.restitution = 0.5f;
    s.balls[i] = w.createRigidBody(ball);
  }
  RigidBodyDesc blade;
  blade.position = {1.5f, 0.3f, -4.5f};
  blade.mass = 1.f;
  blade.radius = 0.12f;
  blade.shape = Shape::Capsule;
  blade.capsuleHalfHeight = 0.6f;
  s.flipper = w.createRigidBody(blade);
  w.setBodyRotation(s.flipper, 0.f, 0.f, 0.70710677f, 0.70710677f);
  HingeDesc hinge;
  hinge.worldAnchor = {0.9f, 0.3f, -4.5f};
  hinge.worldAxis = {0.f, 1.f, 0.f};
  hinge.minAngle = -0.5f;
  hinge.maxAngle = 0.5f;
  s.hinge = w.createHinge(s.flipper, hinge);
  return s;
}

/** Per-frame inputs as a pure function of the frame index (the "input tape"). */
void driveParityScene(PhysicsWorld& w, const Scene& s, int frame) {
  const int t = frame % 60;
  // Dyadic steps: exact in float and in JS doubles, so both sides push the same pose.
  const float y = static_cast<float>(t < 30 ? t : 60 - t) / 64.f + 0.25f;
  w.setNextKinematicTransform(s.piston, 0.75f, y, -1.5f, 0.f, 0.f, 0.f, 1.f);
  w.setHingeMotor(s.hinge, (frame % 40) < 20 ? 8.f : -8.f, 50.f);

  // A toy captures ball 0 for frames [50, 110): kinematic, steered, released.
  const int ball = s.balls[0];
  if (frame == 50) w.setBodyType(ball, BodyType::Kinematic);
  if (frame >= 50 && frame < 110) {
    const float k = static_cast<float>(frame - 50);
    w.setNextKinematicTransform(ball, -1.5f, 1.f, 2.f - k / 32.f, 0.f, 0.f, 0.f, 1.f);
  }
  if (frame == 110) w.setBodyType(ball, BodyType::Dynamic);
}

uint32_t bits(float f) {
  uint32_t u;
  std::memcpy(&u, &f, sizeof u);
  return u;
}

/** Everything observable after one frame, as raw bits. */
void record(const PhysicsWorld& w, const Scene& s, std::vector<uint32_t>& out) {
  auto body = [&](int id) {
    const Vec3 p = readPos(w, id), v = readVel(w, id), a = readAngVel(w, id);
    const Quat q = readRot(w, id);
    for (float f : {p.x, p.y, p.z, v.x, v.y, v.z, a.x, a.y, a.z, q.x, q.y, q.z, q.w}) out.push_back(bits(f));
  };
  for (int id : s.balls) body(id);
  body(s.flipper);
  out.push_back(bits(w.getHingeAngle(s.hinge)));
  out.push_back(static_cast<uint32_t>(w.getContactCount()));
  for (const ContactEvent& e : w.lastContactEvents()) {
    out.push_back(static_cast<uint32_t>(e.bodyId1));
    out.push_back(static_cast<uint32_t>(e.bodyId2));
    out.push_back(static_cast<uint32_t>(e.phase));
    out.push_back(static_cast<uint32_t>(e.subIndex));
    out.push_back(bits(e.impulse));
  }
}

/** Contacts per collider across a run, so the tests can prove the scene exercises it. */
struct Touches {
  int piston = 0;
  int pins = 0;
  int flipper = 0;
  int sensor = 0;
};

void run(PhysicsWorld& w, const Scene& s, int from, int to, std::vector<uint32_t>* out = nullptr,
         Touches* touches = nullptr) {
  for (int f = from; f < to; ++f) {
    driveParityScene(w, s, f);
    w.step(FIXED_DT);
    if (out) record(w, s, *out);
    if (!touches) continue;
    for (const ContactEvent& e : w.lastContactEvents()) {
      if (e.bodyId2 == s.piston) ++touches->piston;
      if (e.bodyId2 == PIN_FIELD_ID_BASE) ++touches->pins;
      if (e.bodyId1 == s.flipper || e.bodyId2 == s.flipper) ++touches->flipper;
      if (e.bodyId2 == SENSOR_VOLUME_ID_BASE) ++touches->sensor;
    }
  }
}

} // namespace

TEST_CASE("snapshot rewind reproduces the run bit-for-bit", "[snapshot]") {
  PhysicsWorld world;
  const Scene s = buildParityScene(world);
  Touches before;
  run(world, s, 0, SNAPSHOT_AT, nullptr, &before);
  const std::vector<uint8_t> blob = world.serialize();

  std::vector<uint32_t> original;
  Touches touched;
  run(world, s, SNAPSHOT_AT, RUN_FRAMES, &original, &touched);
  REQUIRE(world.getStepCount() == static_cast<uint64_t>(RUN_FRAMES));
  // The run must actually exercise the pins, and the replayed window the
  // mover, hinge and sensor — otherwise bit-equality proves little.
  CHECK(before.pins > 0);
  CHECK(touched.piston > 0);
  CHECK(touched.flipper > 0);
  CHECK(touched.sensor > 0);

  REQUIRE(world.restore(blob.data(), blob.size()) == SnapshotStatus::Ok);
  CHECK(world.getStepCount() == static_cast<uint64_t>(SNAPSHOT_AT));
  // Round trip is lossless: re-serializing the restored world is the same blob.
  CHECK((world.serialize() == blob));

  std::vector<uint32_t> replayed;
  run(world, s, SNAPSHOT_AT, RUN_FRAMES, &replayed);
  CHECK((replayed == original));
}

TEST_CASE("snapshot restores into a freshly built table", "[snapshot]") {
  PhysicsWorld live;
  const Scene s = buildParityScene(live);
  run(live, s, 0, SNAPSHOT_AT);
  const std::vector<uint8_t> blob = live.serialize();
  std::vector<uint32_t> original;
  run(live, s, SNAPSHOT_AT, RUN_FRAMES, &original);

  // A replay client: same statics, no bodies, then the snapshot supplies them
  // under the same public ids.
  PhysicsWorld fresh;
  const int piston = buildStatics(fresh);
  REQUIRE(piston == s.piston);
  REQUIRE(fresh.restore(blob.data(), blob.size()) == SnapshotStatus::Ok);
  CHECK(fresh.getTransformSlotCount() == live.getTransformSlotCount());
  // Poses are readable straight from the transform buffer before any step.
  const float* slot = fresh.getTransformBufferPtr() + static_cast<std::size_t>(s.balls[1]) * TRANSFORM_STRIDE;
  CHECK(static_cast<int>(slot[0]) == s.balls[1]);

  std::vector<uint32_t> replayed;
  run(fresh, s, SNAPSHOT_AT, RUN_FRAMES, &replayed);
  CHECK((replayed == original));
}

TEST_CASE("restored manifold does not re-fire Enter for resting contacts", "[snapshot]") {
  PhysicsWorld live;
  live.setGravity(0.f, -9.81f, 0.f);
  live.addStaticBox(0.f, -0.5f, 0.f, 4.f, 0.5f, 4.f, 0.f, 0.f, 0.f, 1.f, 0.f, 0.2f);
  RigidBodyDesc ball;
  ball.position = {0.f, 0.2f, 0.f};
  ball.radius = 0.2f;
  ball.restitution = 0.f;
  const int id = live.createRigidBody(ball);
  stepFixed(live, 20);
  const std::vector<uint8_t> blob = live.serialize();
  const uint64_t generation = live.getContactGeneration();
  CHECK(generation == 20u);

  PhysicsWorld fresh;
  fresh.setGravity(0.f, -9.81f, 0.f);
  fresh.addStaticBox(0.f, -0.5f, 0.f, 4.f, 0.5f, 4.f, 0.f, 0.f, 0.f, 1.f, 0.f, 0.2f);
  REQUIRE(fresh.restore(blob.data(), blob.size()) == SnapshotStatus::Ok);
  CHECK(fresh.getContactGeneration() == generation);
  CHECK(fresh.getContactCount() == 0);

  fresh.step(FIXED_DT);
  bool sawStay = false;
  for (const ContactEvent& e : fresh.lastContactEvents()) {
    if (e.bodyId1 != id) continue;
    CHECK(e.phase != ContactPhase::Enter);
    sawStay = sawStay || e.phase == ContactPhase::Stay;
  }
  CHECK(sawStay);
  CHECK(fresh.getContactGeneration() == generation + 1);
}

TEST_CASE("snapshot refuses a differently built table and leaves the world untouched", "[snapshot]") {
  PhysicsWorld live;
  const Scene s = buildParityScene(live);
  run(live, s, 0, 30);
  const std::vector<uint8_t> blob = live.serialize();

  PhysicsWorld other;
  buildStatics(other, /*extraBox=*/true);
  CHECK(other.staticContentHash() != live.staticContentHash());
  const std::vector<uint8_t> before = other.serialize();
  CHECK(other.restore(blob.data(), blob.size()) == SnapshotStatus::StaticMismatch);
  CHECK((other.serialize() == before));

  // Same shape count, one material changed: still a different table.
  PhysicsWorld tweaked;
  buildStatics(tweaked);
  tweaked.clearStaticGeometry();
  tweaked.addStaticBox(0.f, -0.5f, 0.f, 6.f, 0.5f, 8.f, 0.f, 0.f, 0.f, 1.f, 0.41f, 0.2f);
  CHECK(tweaked.restore(blob.data(), blob.size()) == SnapshotStatus::StaticMismatch);
}

TEST_CASE("snapshot rejects malformed blobs without side effects", "[snapshot]") {
  PhysicsWorld world;
  const Scene s = buildParityScene(world);
  run(world, s, 0, 10);
  const std::vector<uint8_t> blob = world.serialize();
  const std::vector<uint8_t> before = world.serialize();

  // Header: 'PBSN' little-endian, then the version word, then the length.
  REQUIRE(blob.size() % 4 == 0);
  CHECK(blob[0] == 'P');
  CHECK(blob[1] == 'B');
  CHECK(blob[2] == 'S');
  CHECK(blob[3] == 'N');
  CHECK(blob[4] == SNAPSHOT_VERSION);
  const uint32_t words = static_cast<uint32_t>(blob[8]) | (static_cast<uint32_t>(blob[9]) << 8) |
                         (static_cast<uint32_t>(blob[10]) << 16) | (static_cast<uint32_t>(blob[11]) << 24);
  CHECK(static_cast<std::size_t>(words) * 4 == blob.size());

  std::vector<uint8_t> bad = blob;
  bad[0] ^= 0xFF;
  CHECK(world.restore(bad.data(), bad.size()) == SnapshotStatus::BadMagic);
  bad = blob;
  bad[4] = 99;
  CHECK(world.restore(bad.data(), bad.size()) == SnapshotStatus::BadVersion);
  CHECK(world.restore(blob.data(), blob.size() - 4) == SnapshotStatus::Truncated);
  CHECK(world.restore(blob.data(), 8) == SnapshotStatus::Truncated);
  CHECK(world.restore(nullptr, 0) == SnapshotStatus::Truncated);
  bad = blob;
  bad.insert(bad.end(), {0, 0, 0, 0});
  CHECK(world.restore(bad.data(), bad.size()) == SnapshotStatus::Corrupt);

  // A dangling handle binding (body count word bumped, length kept honest by
  // re-patching) is caught by the consistency pass, not trusted.
  bad = blob;
  const std::size_t handleWord = SNAPSHOT_HEADER_WORDS + 2 /*step*/ + 1 /*acc*/ + 10 /*params*/;
  const std::size_t firstSlot = (handleWord + 2) * 4;
  bad[firstSlot] = 0x7F; // slot 0 → dense index 127
  CHECK(world.restore(bad.data(), bad.size()) == SnapshotStatus::Corrupt);

  CHECK((world.serialize() == before));
}

TEST_CASE("serialize is deterministic and writes the parity fixture", "[snapshot]") {
  PhysicsWorld a;
  PhysicsWorld b;
  const Scene sa = buildParityScene(a);
  const Scene sb = buildParityScene(b);
  run(a, sa, 0, SNAPSHOT_AT);
  run(b, sb, 0, SNAPSHOT_AT);
  const std::vector<uint8_t> blob = a.serialize();
  CHECK((blob == b.serialize()));
  CHECK(a.staticContentHash() == b.staticContentHash());

  if (const char* path = std::getenv("PACHINBALL_SNAPSHOT_FIXTURE")) {
    std::ofstream out(path, std::ios::binary);
    REQUIRE(out.good());
    out.write(reinterpret_cast<const char*>(blob.data()), static_cast<std::streamsize>(blob.size()));
  }
}

TEST_CASE("hinge angle uses a libm-independent atan2", "[snapshot][hinge]") {
  // computeHingeAngle feeds the solver, so it must not depend on glibc vs
  // musl atan2 (native vs WASM bytes). It must still be an accurate atan2.
  HingeJoint joint;
  joint.worldAxis = {0.f, 1.f, 0.f};
  float worst = 0.f;
  for (int i = -3140; i <= 3140; i += 7) {
    const float theta = static_cast<float>(i) / 1000.f;
    const float s = std::sin(0.5f * theta), c = std::cos(0.5f * theta);
    const Quat q{0.f, s, 0.f, c};
    const float expected = 2.f * std::atan2(s, c);
    worst = std::max(worst, std::fabs(computeHingeAngle(joint, q) - expected));
  }
  CHECK(worst <= 1e-6f);
  // Degenerate / sign conventions.
  CHECK(computeHingeAngle(joint, Quat{0.f, 0.f, 0.f, 1.f}) == 0.f);
  CHECK(near(computeHingeAngle(joint, Quat{0.f, 1.f, 0.f, 0.f}), 3.14159265f, 1e-6f));
  CHECK(near(computeHingeAngle(joint, Quat{0.f, -0.70710677f, 0.f, 0.70710677f}), -1.5707963f, 1e-6f));
}
