/**
 * Golden traces (#442): a fixed hash of the full solver state over a few
 * deterministic scenes, so every engine change says whether it moved the
 * numbers. Build-only refactors (warning flags, -ffp-contract=off, a new
 * broadphase that emits the same pairs, column loops) must leave every
 * constant below untouched; a numeric slice (speculative contacts, the sleep
 * fix, compacted transform slots) updates the constants it moves and says so
 * in its commit message.
 *
 * Each trace is FNV-1a 64 over every contact event of every frame plus the
 * world's `serialize()` blob every TRACE_EVERY frames — bodies, hinges,
 * movers, force fields, manifold, step count.
 *
 *   npm run test:native                              # check
 *   PACHINBALL_PRINT_GOLDEN=1 npm run test:native    # print fresh constants
 *
 * scripts/run-wasm-parity.mjs keeps the WASM bundle byte-identical to this
 * native build, so these constants pin both.
 */

#include "PhysicsWorld.h"
#include "test_helpers.hpp"

#include <catch2/catch_test_macros.hpp>

#include <cinttypes>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

using namespace pachinball;
using namespace pachinball::test;

namespace {

constexpr int TRACE_EVERY = 15;

struct Trace {
  SnapshotHasher h;

  void events(const PhysicsWorld& w) {
    h.i32(w.getContactCount());
    for (const ContactEvent& e : w.lastContactEvents()) {
      h.i32(e.bodyId1);
      h.i32(e.bodyId2);
      h.i32(static_cast<int32_t>(e.phase));
      h.i32(e.subIndex);
      h.f32(e.impulse);
      h.f32(e.normal.x);
      h.f32(e.normal.y);
      h.f32(e.normal.z);
    }
  }

  void state(const PhysicsWorld& w) {
    const std::vector<uint8_t> blob = w.serialize();
    h.u32(static_cast<uint32_t>(blob.size()));
    std::size_t i = 0;
    for (; i + 4 <= blob.size(); i += 4) {
      h.u32(static_cast<uint32_t>(blob[i]) | static_cast<uint32_t>(blob[i + 1]) << 8 |
            static_cast<uint32_t>(blob[i + 2]) << 16 | static_cast<uint32_t>(blob[i + 3]) << 24);
    }
    for (; i < blob.size(); ++i) h.u32(blob[i]);
  }
};

template <typename Drive>
uint64_t runTrace(PhysicsWorld& w, int frames, Drive drive) {
  Trace t;
  for (int f = 0; f < frames; ++f) {
    drive(f);
    w.step(FIXED_DT);
    t.events(w);
    if ((f + 1) % TRACE_EVERY == 0) t.state(w);
  }
  t.state(w);
  return t.h.value();
}

RigidBodyDesc ball(float x, float y, float z, float vx, float vy, float vz) {
  RigidBodyDesc d;
  d.position = {x, y, z};
  d.velocity = {vx, vy, vz};
  d.mass = 0.08f;
  d.radius = 0.2f;
  d.restitution = 0.5f;
  d.friction = 0.3f;
  return d;
}

/**
 * A table: floor, back wall, a yawed deflector, every static family, a pin
 * field, a ramp mesh, a piston, a sensor, wind + an axis-pull well, a hinged
 * capsule flipper, a dynamic crate and a ball captured by a toy.
 */
uint64_t tableTrace() {
  PhysicsWorld w;
  w.setGravity(0.f, -9.81f, -4.f);

  w.addStaticBox(0.f, -0.5f, 0.f, 7.f, 0.5f, 9.f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f);
  w.addStaticBox(0.f, 0.5f, -7.5f, 7.f, 1.f, 0.5f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f);
  // Yawed 30° about Y.
  w.addStaticBox(-3.f, 0.4f, -2.f, 1.2f, 0.4f, 0.1f, 0.f, 0.25881904f, 0.f, 0.96592583f, 0.7f, 0.1f);
  w.addStaticPlane(1.f, 0.f, 0.f, -7.f);
  w.addStaticCapsule(3.5f, 0.3f, 1.f, 0.15f, 0.8f, 0.70710677f, 0.f, 0.f, 0.70710677f, 0.5f, 0.2f);
  w.addStaticSphere(-4.f, 0.2f, 4.f, 0.4f, 0.8f, 0.1f);
  w.addStaticCone(4.f, 0.5f, -3.f, 0.6f, 0.5f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f);
  for (int ix = -2; ix <= 2; ++ix) {
    w.addStaticCylinder(static_cast<float>(ix) * 1.1f, 0.4f, 1.5f, 0.1f, 0.4f, 0.f, 0.f, 0.f, 1.f, 0.6f, 0.1f);
  }

  PinFieldDesc pins;
  pins.origin = {-2.5f, 0.4f, 4.5f};
  pins.rows = 6;
  pins.cols = 5;
  pins.spacingX = 0.7f;
  pins.spacingZ = 0.6f;
  pins.rowOffsetX = 0.35f;
  pins.radius = 0.06f;
  pins.halfHeight = 0.4f;
  pins.restitution = 0.6f;
  pins.friction = 0.1f;
  pins.dropoutSeed = 11;
  pins.dropout = 0.15f;
  w.addPinField(pins);

  // A ramp: two triangles rising toward -z, single-sided.
  const float rampV[] = {
      2.f, 0.f, 6.f,   5.f, 0.f, 6.f,   5.f, 0.8f, 3.f,   2.f, 0.8f, 3.f,
  };
  const uint32_t rampI[] = {0, 1, 2, 0, 2, 3};
  w.addStaticTriangleMesh(rampV, 4, rampI, 6, 0.3f, 0.3f, false);

  KinematicMoverDesc piston;
  piston.position = {1.f, 0.25f, -1.f};
  piston.halfExtents = {0.6f, 0.2f, 0.4f};
  const int pistonId = w.addKinematicMover(piston);

  SensorVolumeDesc drain;
  drain.center = {0.f, 0.5f, -6.5f};
  drain.halfExtents = {7.f, 0.5f, 0.4f};
  w.addSensorVolume(drain);

  ForceFieldDesc wind;
  wind.center = {-4.f, 0.5f, 0.f};
  wind.halfExtents = {1.f, 1.f, 1.5f};
  wind.force = {1.5f, 0.f, -2.f};
  wind.acceleration = true;
  w.addForceField(wind);

  ForceFieldDesc well;
  well.mode = ForceMode::AxisPull;
  well.center = {2.f, 0.5f, -4.f};
  well.halfExtents = {1.2f, 0.6f, 1.2f};
  well.strength = 4.f;
  well.acceleration = true;
  w.addForceField(well);

  std::vector<int> balls;
  for (int i = 0; i < 10; ++i) {
    const float fi = static_cast<float>(i);
    balls.push_back(w.createRigidBody(
        ball(-3.f + 0.65f * fi, 0.5f + 0.1f * static_cast<float>(i % 3), 7.5f - 0.2f * fi,
             0.25f * static_cast<float>((i % 5) - 2), 0.f, -1.5f - 0.1f * fi)));
  }
  w.setAngularVelocity(balls[3], 0.f, 0.f, 12.f);

  RigidBodyDesc blade;
  blade.position = {1.5f, 0.3f, -5.5f};
  blade.mass = 1.f;
  blade.radius = 0.12f;
  blade.shape = Shape::Capsule;
  blade.capsuleHalfHeight = 0.6f;
  const int flipper = w.createRigidBody(blade);
  w.setBodyRotation(flipper, 0.f, 0.f, 0.70710677f, 0.70710677f);
  HingeDesc hinge;
  hinge.worldAnchor = {0.9f, 0.3f, -5.5f};
  hinge.worldAxis = {0.f, 1.f, 0.f};
  hinge.minAngle = -0.5f;
  hinge.maxAngle = 0.5f;
  const int hingeId = w.createHinge(flipper, hinge);

  RigidBodyDesc crate;
  crate.position = {-1.5f, 1.2f, -3.f};
  crate.mass = 0.5f;
  crate.shape = Shape::Box;
  crate.boxHalfExtents = {0.25f, 0.25f, 0.25f};
  crate.restitution = 0.2f;
  w.createRigidBody(crate);

  const int captured = balls[0];
  return runTrace(w, 300, [&](int f) {
    const int t = f % 60;
    const float y = static_cast<float>(t < 30 ? t : 60 - t) / 64.f + 0.25f;
    w.setNextKinematicTransform(pistonId, 1.f, y, -1.f, 0.f, 0.f, 0.f, 1.f);
    w.setHingeMotor(hingeId, (f % 40) < 20 ? 9.f : -9.f, 60.f);
    if (f == 40) w.setBodyType(captured, BodyType::Kinematic);
    if (f >= 40 && f < 100) {
      const float k = static_cast<float>(f - 40);
      w.setNextKinematicTransform(captured, -2.f, 1.f, 3.f - k / 32.f, 0.f, 0.f, 0.f, 1.f);
    }
    if (f == 100) w.setBodyType(captured, BodyType::Dynamic);
    if (f == 150) w.applyImpulse(balls[5], 0.f, 0.15f, -0.3f);
  });
}

/**
 * Fast balls: thin plates (box and mesh), a pin field crossed at speed and a
 * flipper swinging into a resting ball. Speculative contacts (#442 slice A)
 * are expected to move this constant; nothing else should.
 */
uint64_t fastTrace() {
  PhysicsWorld w;
  w.setGravity(0.f, -9.81f, 0.f);
  w.addStaticBox(0.f, -0.5f, 0.f, 12.f, 0.5f, 12.f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f);
  // 1 cm plate across x = 4.
  w.addStaticBox(4.f, 1.f, 0.f, 0.005f, 1.f, 3.f, 0.f, 0.f, 0.f, 1.f, 0.6f, 0.1f);
  // Single-sided mesh plate across z = -4, facing +z.
  const float plateV[] = {
      -3.f, 0.f, -4.f,   3.f, 0.f, -4.f,   3.f, 2.f, -4.f,   -3.f, 2.f, -4.f,
  };
  const uint32_t plateI[] = {0, 1, 2, 0, 2, 3};
  w.addStaticTriangleMesh(plateV, 4, plateI, 6, 0.5f, 0.1f, false);

  PinFieldDesc pins;
  pins.origin = {-6.f, 0.4f, 3.f};
  pins.rows = 12;
  pins.cols = 12;
  pins.spacingX = 0.6f;
  pins.spacingZ = 0.6f;
  pins.rowOffsetX = 0.3f;
  pins.radius = 0.05f;
  pins.halfHeight = 0.4f;
  pins.restitution = 0.5f;
  w.addPinField(pins);

  w.createRigidBody(ball(0.f, 0.5f, 0.f, 15.f, 0.f, 0.f));
  w.createRigidBody(ball(0.f, 0.5f, 2.f, 22.f, 0.f, 0.f));
  w.createRigidBody(ball(0.5f, 0.5f, 0.f, 0.f, 0.f, -18.f));
  w.createRigidBody(ball(-6.5f, 0.3f, 4.f, 20.f, 0.f, 3.f));

  RigidBodyDesc blade;
  blade.position = {-3.f, 0.3f, -1.f};
  blade.mass = 1.f;
  blade.radius = 0.12f;
  blade.shape = Shape::Capsule;
  blade.capsuleHalfHeight = 0.6f;
  const int flipper = w.createRigidBody(blade);
  w.setBodyRotation(flipper, 0.f, 0.f, 0.70710677f, 0.70710677f);
  HingeDesc hinge;
  hinge.worldAnchor = {-3.6f, 0.3f, -1.f};
  hinge.worldAxis = {0.f, 1.f, 0.f};
  hinge.minAngle = -0.8f;
  hinge.maxAngle = 0.8f;
  const int hingeId = w.createHinge(flipper, hinge);
  w.createRigidBody(ball(-2.6f, 0.2f, -1.6f, 0.f, 0.f, 0.f));

  return runTrace(w, 120, [&](int f) {
    w.setHingeMotor(hingeId, f < 20 ? -30.f : 30.f, 400.f);
  });
}

/**
 * Sleep: zero-gravity balls coast to rest and sleep, then a rolling ball
 * wakes them; plus a world where a small stack rests on the floor under
 * gravity (which never sleeps before the #442 slice C sleep fix).
 */
uint64_t sleepTrace() {
  WorldParams params;
  params.gravity = {0.f, 0.f, 0.f};
  params.sleepFramesRequired = 8;
  PhysicsWorld w(params);
  w.addStaticBox(0.f, -0.5f, 0.f, 8.f, 0.5f, 8.f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f);

  RigidBodyDesc slow = ball(-1.f, 1.f, 0.f, 0.f, 0.f, 0.f);
  slow.linearDamping = 2.f;
  slow.angularDamping = 2.f;
  const int a = w.createRigidBody(slow);
  slow.position = {1.f, 1.f, 0.f};
  w.createRigidBody(slow);
  slow.position = {0.f, 1.f, 1.f};
  w.createRigidBody(slow);
  w.setVelocity(a, 0.3f, 0.f, 0.f);
  const int roller = w.createRigidBody(ball(-6.f, 1.f, 0.f, 0.f, 0.f, 0.f));

  const uint64_t coast = runTrace(w, 200, [&](int f) {
    if (f == 120) w.setVelocity(roller, 4.f, 0.f, 0.f);
  });

  WorldParams heavy;
  heavy.sleepFramesRequired = 8;
  PhysicsWorld g(heavy);
  g.setGravity(0.f, -9.81f, 0.f);
  g.addStaticBox(0.f, -0.5f, 0.f, 4.f, 0.5f, 4.f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f);
  for (int i = 0; i < 3; ++i) {
    g.createRigidBody(ball(0.f, 0.2f + 0.4f * static_cast<float>(i), 0.f, 0.f, 0.f, 0.f));
  }
  const uint64_t stack = runTrace(g, 150, [](int) {});

  SnapshotHasher h;
  h.u32(static_cast<uint32_t>(coast));
  h.u32(static_cast<uint32_t>(coast >> 32));
  h.u32(static_cast<uint32_t>(stack));
  h.u32(static_cast<uint32_t>(stack >> 32));
  return h.value();
}

bool printGolden() {
  const char* v = std::getenv("PACHINBALL_PRINT_GOLDEN");
  return v && *v && std::strcmp(v, "0") != 0;
}

void checkGolden(const char* name, uint64_t actual, uint64_t expected) {
  if (printGolden()) {
    std::printf("[golden] %-6s 0x%016" PRIx64 "ull\n", name, actual);
  }
  char hex[19];
  std::snprintf(hex, sizeof hex, "0x%016" PRIx64, actual);
  INFO(name << " trace is " << hex << "ull — if this change is meant to move the numbers, "
               "update the constant and say so in the commit message");
  CHECK(actual == expected);
}

} // namespace

TEST_CASE("golden trace: table", "[golden]") {
  checkGolden("table", tableTrace(), 0xa401ea04967f59d3ull);
}

TEST_CASE("golden trace: fast balls", "[golden]") {
  checkGolden("fast", fastTrace(), 0x98a089c8d8b2efe6ull);
}

TEST_CASE("golden trace: sleep", "[golden]") {
  checkGolden("sleep", sleepTrace(), 0x4a3b9679f08aba0bull);
}

TEST_CASE("golden traces are reproducible within one build", "[golden]") {
  CHECK(tableTrace() == tableTrace());
  CHECK(fastTrace() == fastTrace());
  CHECK(sleepTrace() == sleepTrace());
}
