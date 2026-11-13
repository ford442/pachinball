/**
 * Regression tests for the #520 §1 correctness rows that leave a healthy
 * world bit-identical (rows 8, 9, 10, 12). Each test failed before its fix.
 *
 *   npm run test:native
 */

#include "Boundary.h"
#include "PhysicsWorld.h"
#include "test_helpers.hpp"

#include <catch2/catch_test_macros.hpp>

#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <vector>

using namespace pachinball;
using namespace pachinball::test;

namespace {

constexpr float kNaN = std::numeric_limits<float>::quiet_NaN();
constexpr float kInf = std::numeric_limits<float>::infinity();

uint32_t floatBits(float f) {
  uint32_t u;
  std::memcpy(&u, &f, 4);
  return u;
}

uint32_t readWord(const std::vector<uint8_t>& blob, std::size_t word) {
  uint32_t v;
  std::memcpy(&v, blob.data() + word * 4, 4);
  return v;
}

void patchWord(std::vector<uint8_t>& blob, std::size_t word, uint32_t v) {
  std::memcpy(blob.data() + word * 4, &v, 4);
}

void patchFloat(std::vector<uint8_t>& blob, std::size_t word, float f) {
  patchWord(blob, word, floatBits(f));
}

/**
 * Word offsets inside a `serialize()` blob (Snapshot.cpp `writeState`), found
 * by walking the variable-length sections the way `restore()` reads them.
 */
struct BlobLayout {
  std::size_t accumulator = 0;
  std::size_t bodyCount = 0; ///< bodies in the blob
  std::size_t bodies = 0; ///< first word of the body section (after its count)
  std::size_t nextHingeId = 0;
  std::size_t hingeCount = 0;
  std::size_t hinges = 0; ///< first hinge record
  std::size_t targetCount = 0;

  /** Float column `col` (Snapshot.cpp kFloatCols order) of dense body `i`. */
  std::size_t bodyFloat(std::size_t col, std::size_t i) const { return bodies + bodyCount + col * bodyCount + i; }
  std::size_t hingeWord(std::size_t hinge, std::size_t field) const { return hinges + hinge * 21 + field; }
};

BlobLayout layoutOf(const std::vector<uint8_t>& blob) {
  BlobLayout l;
  l.accumulator = SNAPSHOT_HEADER_WORDS + 2;
  const std::size_t handles = l.accumulator + 1 + 10;
  const std::size_t slots = readWord(blob, handles + 1);
  const std::size_t bodyCountWord = handles + 2 + slots * 2;
  l.bodyCount = readWord(blob, bodyCountWord);
  l.bodies = bodyCountWord + 1;
  // public id + 28 float + 3 byte + sleep + 2 word columns.
  l.nextHingeId = l.bodies + l.bodyCount * 35;
  l.hingeCount = l.nextHingeId + 1;
  l.hinges = l.hingeCount + 1;
  l.targetCount = l.hinges + readWord(blob, l.hingeCount) * 21;
  return l;
}

// kFloatCols indices (Snapshot.cpp).
constexpr std::size_t COL_POS_X = 0;
constexpr std::size_t COL_ROT_W = 12;
constexpr std::size_t COL_INV_MASS = 16;
constexpr std::size_t COL_RADIUS = 18;
// Hinge record fields.
constexpr std::size_t HINGE_BODY = 1;
constexpr std::size_t HINGE_AXIS_X = 6;
constexpr std::size_t HINGE_MOTOR_TORQUE = 19;
constexpr std::size_t HINGE_BAUMGARTE = 20;

RigidBodyDesc ballAt(float x, float y, float z, float radius = 0.25f) {
  RigidBodyDesc d;
  d.position = {x, y, z};
  d.radius = radius;
  d.restitution = 0.f;
  d.linearDamping = 0.f;
  return d;
}

/** A ball plus a hinged capsule, stepped once: every snapshot section is populated. */
struct HingedWorld {
  PhysicsWorld world;
  int ball = -1;
  int blade = -1;
  int hinge = -1;
  HingedWorld() {
    world.addStaticPlane(0.f, 1.f, 0.f, 0.f);
    ball = world.createRigidBody(ballAt(0.f, 1.f, 0.f));
    RigidBodyDesc capsule;
    capsule.position = {2.f, 0.5f, 0.f};
    capsule.shape = Shape::Capsule;
    capsule.radius = 0.1f;
    capsule.capsuleHalfHeight = 0.5f;
    blade = world.createRigidBody(capsule);
    HingeDesc h;
    h.worldAnchor = {2.f, 0.5f, 0.f};
    h.worldAxis = {0.f, 1.f, 0.f};
    hinge = world.createHinge(blade, h);
    world.setHingeMotor(hinge, 4.f, 10.f);
    world.step(FIXED_DT);
  }
};

/** `restore(bad)` must refuse with `Corrupt` and leave the world byte-for-byte as it was. */
void requireRefused(PhysicsWorld& world, const std::vector<uint8_t>& bad) {
  const std::vector<uint8_t> before = world.serialize();
  CHECK(world.restore(bad.data(), bad.size()) == SnapshotStatus::Corrupt);
  CHECK((world.serialize() == before));
}

} // namespace

// ---- Row 9: negative / NaN rawDt ------------------------------------------

TEST_CASE("a negative rawDt cannot drive the accumulator below zero (#520 row 9)", "[step]") {
  PhysicsWorld world;
  world.createRigidBody(ballAt(0.f, 5.f, 0.f));
  for (int i = 0; i < 10; ++i) world.step(-1.f);
  CHECK(world.step(-kInf) == 0.f);
  // One fixed tick must run exactly one substep, as if the bad calls never happened.
  const uint64_t before = world.getStepCount();
  world.step(FIXED_DT);
  CHECK(world.getStepCount() == before + 1);
}

TEST_CASE("a NaN rawDt is a zero-length tick, not a max-length one (#520 row 9)", "[step]") {
  PhysicsWorld world;
  world.createRigidBody(ballAt(0.f, 5.f, 0.f));
  const float alpha = world.step(kNaN);
  CHECK(world.getStepCount() == 0);
  CHECK(alpha == 0.f);
  world.step(FIXED_DT);
  CHECK(world.getStepCount() == 1);
}

TEST_CASE("the accumulator stays within maxSubsteps fixed steps (#520 row 9)", "[step]") {
  WorldParams p;
  p.maxSubsteps = 1.f;
  PhysicsWorld world(p);
  world.createRigidBody(ballAt(0.f, 5.f, 0.f));
  // 1/30 s per call against one 1/60 substep: the debt used to grow without bound.
  float alpha = 0.f;
  for (int i = 0; i < 600; ++i) alpha = world.step(1.f / 30.f);
  CHECK(alpha >= 0.f);
  CHECK(alpha <= 1.f);
  // Its own snapshot restores (row 8 refuses an accumulator past the bound).
  const std::vector<uint8_t> blob = world.serialize();
  CHECK(world.restore(blob.data(), blob.size()) == SnapshotStatus::Ok);
}

// ---- Row 8: snapshot restore validates every column -----------------------

TEST_CASE("restore refuses a non-finite or out-of-range accumulator (#520 row 8)", "[snapshot]") {
  HingedWorld h;
  const std::vector<uint8_t> blob = h.world.serialize();
  const BlobLayout l = layoutOf(blob);
  REQUIRE(h.world.restore(blob.data(), blob.size()) == SnapshotStatus::Ok);
  for (float acc : {kNaN, kInf, -kInf, -1e-3f, 1e30f, 10.f}) {
    std::vector<uint8_t> bad = blob;
    patchFloat(bad, l.accumulator, acc);
    requireRefused(h.world, bad);
  }
}

TEST_CASE("restore refuses non-finite body columns and forged mass properties (#520 row 8)", "[snapshot]") {
  HingedWorld h;
  const std::vector<uint8_t> blob = h.world.serialize();
  const BlobLayout l = layoutOf(blob);
  REQUIRE(l.bodyCount == 2);

  std::vector<uint8_t> bad = blob;
  patchFloat(bad, l.bodyFloat(COL_POS_X, 0), kNaN);
  requireRefused(h.world, bad);

  bad = blob;
  patchFloat(bad, l.bodyFloat(COL_ROT_W, 1), kInf);
  requireRefused(h.world, bad);

  // invMass is derived from (type, mass): a feather-weight ball is a forgery.
  bad = blob;
  patchFloat(bad, l.bodyFloat(COL_INV_MASS, 0), 1000.f);
  requireRefused(h.world, bad);

  // A kilometre-wide ball would make the broadphase walk ~10^12 cells.
  bad = blob;
  patchFloat(bad, l.bodyFloat(COL_RADIUS, 0), 1e30f);
  requireRefused(h.world, bad);

  bad = blob;
  patchFloat(bad, l.bodyFloat(COL_RADIUS, 0), -0.25f);
  requireRefused(h.world, bad);
}

TEST_CASE("restore refuses corrupt hinge records (#520 row 8)", "[snapshot][hinge]") {
  HingedWorld h;
  const std::vector<uint8_t> blob = h.world.serialize();
  const BlobLayout l = layoutOf(blob);
  REQUIRE(readWord(blob, l.hingeCount) == 1);

  std::vector<uint8_t> bad = blob;
  patchFloat(bad, l.hingeWord(0, HINGE_AXIS_X), kNaN);
  requireRefused(h.world, bad);

  // createHinge stores a unit axis.
  bad = blob;
  patchFloat(bad, l.hingeWord(0, HINGE_AXIS_X), 3.f);
  requireRefused(h.world, bad);

  bad = blob;
  patchFloat(bad, l.hingeWord(0, HINGE_MOTOR_TORQUE), -5.f);
  requireRefused(h.world, bad);

  bad = blob;
  patchFloat(bad, l.hingeWord(0, HINGE_BAUMGARTE), kInf);
  requireRefused(h.world, bad);

  // An active hinge on a body the blob does not hold.
  bad = blob;
  patchWord(bad, l.hingeWord(0, HINGE_BODY), 77u);
  requireRefused(h.world, bad);

  // Hinge ids are issued below nextHingeId.
  bad = blob;
  patchWord(bad, l.nextHingeId, 0u);
  requireRefused(h.world, bad);
}

TEST_CASE("restore refuses non-finite kinematic targets, mover poses and field vectors (#520 row 8)", "[snapshot]") {
  PhysicsWorld world;
  KinematicMoverDesc mover;
  mover.position = {0.f, 0.5f, 0.f};
  const int moverId = world.addKinematicMover(mover);
  ForceFieldDesc field;
  field.force = {0.f, 1.f, 0.f};
  world.addForceField(field);
  const int ball = world.createRigidBody(ballAt(3.f, 1.f, 0.f));
  world.setBodyType(ball, BodyType::Kinematic);
  world.step(FIXED_DT);
  world.setNextKinematicTransform(ball, 3.f, 1.5f, 0.f, 0.f, 0.f, 0.f, 1.f);
  world.setNextKinematicTransform(moverId, 0.f, 0.6f, 0.f, 0.f, 0.f, 0.f, 1.f);

  const std::vector<uint8_t> blob = world.serialize();
  const BlobLayout l = layoutOf(blob);
  REQUIRE(readWord(blob, l.targetCount) == 1);
  REQUIRE(world.restore(blob.data(), blob.size()) == SnapshotStatus::Ok);

  // Pending target: count, then id, position (3), rotation (4).
  std::vector<uint8_t> bad = blob;
  patchFloat(bad, l.targetCount + 2, kNaN);
  requireRefused(world, bad);

  // After the targets: driven ids, then (membership, filter) for the mover and
  // the field, then the mover pose block and the field vector.
  const std::size_t drivenCount = l.targetCount + 1 + 8;
  const std::size_t groups = drivenCount + 1 + readWord(blob, drivenCount);
  const std::size_t moverPose = groups + 2 * 2;
  bad = blob;
  patchFloat(bad, moverPose + 1, kInf); // currentPos.y
  requireRefused(world, bad);

  const std::size_t fieldVec = moverPose + 21;
  bad = blob;
  patchFloat(bad, fieldVec, kNaN);
  requireRefused(world, bad);
}

TEST_CASE("restore refuses a manifold out of pair-key order or with a negative pin index (#520 row 8)", "[snapshot]") {
  PhysicsWorld world;
  world.addStaticPlane(0.f, 1.f, 0.f, 0.f);
  world.createRigidBody(ballAt(0.f, 0.3f, 0.f));
  world.createRigidBody(ballAt(2.f, 0.3f, 0.f));
  stepFixed(world, 30);
  const std::vector<uint8_t> blob = world.serialize();
  // The manifold closes the blob: its count, then 12 words per resting pair.
  const std::size_t words = blob.size() / 4;
  REQUIRE(readWord(blob, words - 25) == 2);
  REQUIRE(world.restore(blob.data(), blob.size()) == SnapshotStatus::Ok);

  std::vector<uint8_t> bad = blob;
  for (std::size_t w = 0; w < 12; ++w) {
    patchWord(bad, words - 24 + w, readWord(blob, words - 12 + w));
    patchWord(bad, words - 12 + w, readWord(blob, words - 24 + w));
  }
  requireRefused(world, bad);

  bad = blob;
  patchWord(bad, words - 1, 0xFFFFFFFFu); // last pair's subIndex = -1
  requireRefused(world, bad);
}

TEST_CASE("an angular velocity that overflows the rotation is quarantined, not zeroed (#520 row 8)",
          "[snapshot][nan]") {
  PhysicsWorld world;
  const int ball = world.createRigidBody(ballAt(0.f, 1.f, 0.f));
  // Finite, but q + ½·ω·q·dt overflows: normalized() divided by inf and stored (0, 0, 0, 0).
  world.setAngularVelocity(ball, 1e30f, 0.f, 0.f);
  world.step(FIXED_DT);
  const Quat q = readRot(world, ball);
  CHECK(isUnitQuat(q));
  REQUIRE(world.lastNaNQuarantines().size() == 1);
  CHECK(world.lastNaNQuarantines()[0].bodyId == ball);
  const std::vector<uint8_t> blob = world.serialize();
  CHECK(world.restore(blob.data(), blob.size()) == SnapshotStatus::Ok);
}

TEST_CASE("a hinge limit past ±π is clamped, not applied as a 1e24 rad error (#520 row 8)", "[snapshot][hinge]") {
  // Found by fuzz_command_stream: min 2.3e24 rad is violated at every angle by
  // its whole size, and the limit impulse spun the blade until its rotation
  // overflowed — after which the world refused its own snapshot.
  PhysicsWorld world;
  RigidBodyDesc blade;
  blade.position = {-6.f, -6.f, -6.f};
  blade.velocity = {10.5940952f, -3.42211032f, -8.1906147f};
  blade.mass = 1.83547723f;
  blade.radius = 0.0218991376f;
  blade.restitution = 0.f;
  blade.linearDamping = 0.281254292f;
  blade.shape = Shape::Capsule;
  blade.capsuleHalfHeight = 0.155046925f;
  blade.friction = 0.942015707f;
  blade.angularDamping = 0.945098042f;
  const int body = world.createRigidBody(blade);
  HingeDesc h;
  h.worldAnchor = {-5.98535109f, -5.42192698f, -1.1595329f};
  h.worldAxis = {-0.00257879496f, 0.0703288317f, 0.296437025f};
  h.minAngle = 2.28510671e+24f;
  h.maxAngle = -0.00773638487f;
  h.motorTargetVel = kNaN;
  h.motorMaxTorque = 177.575348f;
  h.baumgarte = 0.0776836872f;
  REQUIRE(world.createHinge(body, h) >= 0);
  world.step(0.05f);
  CHECK(isUnitQuat(readRot(world, body)));
  CHECK(world.lastNaNQuarantines().empty());
  const std::vector<uint8_t> blob = world.serialize();
  CHECK(world.restore(blob.data(), blob.size()) == SnapshotStatus::Ok);
}

// ---- Row 10: boundary validation -------------------------------------------

TEST_CASE("int → enum conversions at the boundary reject out-of-range values (#520 row 10)", "[boundary]") {
  CHECK(bodyTypeFromInt(2) == BodyType::Kinematic);
  CHECK(bodyTypeFromInt(3) == BodyType::Dynamic);
  // 256 truncates to 0 in a bare static_cast<uint8_t-backed enum>: still refused.
  CHECK(shapeFromInt(256 + 2) == Shape::Sphere);
  CHECK(shapeFromInt(-1) == Shape::Sphere);
  CHECK(shapeFromInt(2) == Shape::Box);
  CHECK(volumeShapeFromInt(1) == VolumeShape::Cylinder);
  CHECK(volumeShapeFromInt(9) == VolumeShape::Box);
  CHECK(forceSpaceFromInt(1) == ForceSpace::Local);
  CHECK(forceSpaceFromInt(7) == ForceSpace::World);
}

TEST_CASE("a body built from an out-of-range enum still round-trips its own snapshot (#520 row 10)",
          "[boundary][snapshot]") {
  PhysicsWorld world;
  RigidBodyDesc d = ballAt(0.f, 1.f, 0.f);
  d.shape = static_cast<Shape>(7);
  d.type = static_cast<BodyType>(9);
  world.createRigidBody(d);
  world.step(FIXED_DT);
  const std::vector<uint8_t> blob = world.serialize();
  CHECK(world.restore(blob.data(), blob.size()) == SnapshotStatus::Ok);
}

TEST_CASE("an out-of-range volume shape or force space hashes as the default it behaves as (#520 row 10)",
          "[boundary][hash]") {
  PhysicsWorld a;
  PhysicsWorld b;
  KinematicMoverDesc mover;
  a.addKinematicMover(mover);
  mover.shape = static_cast<VolumeShape>(9);
  b.addKinematicMover(mover);
  ForceFieldDesc field;
  a.addForceField(field);
  field.space = static_cast<ForceSpace>(5);
  b.addForceField(field);
  CHECK(a.staticContentHash() == b.staticContentHash());
}

TEST_CASE("a non-unit static box rotation is normalised, not applied as a scale (#520 row 10)", "[boundary]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);
  // 90° about z at length 2: rotate() is Rodrigues' formula, which skews and
  // scales by up to |q|² = 4 unless the quaternion is unit. Normalised, the
  // box stands 2 m tall (its local x half-extent along world y).
  world.addStaticBox(0.f, 0.f, 0.f, 2.f, 0.5f, 2.f, 0.f, 0.f, 1.41421356f, 1.41421356f);
  const int ball = world.createRigidBody(ballAt(0.f, 3.f, 0.f));
  stepFixed(world, 120);
  CHECK(near(readPos(world, ball).y, 2.25f, 0.02f));
}

TEST_CASE("a zero or non-finite rotation becomes the identity (#520 row 10)", "[boundary]") {
  CHECK(sanitizedRotation({0.f, 0.f, 0.f, 0.f}).w == 1.f);
  CHECK(sanitizedRotation({kNaN, 0.f, 0.f, 1.f}).w == 1.f);
  CHECK(sanitizedRotation({0.f, kInf, 0.f, 1.f}).w == 1.f);
  // Near-unit input is kept bit for bit: a caller's float32 rounding is not an error.
  const Quat q{0.f, 0.f, 0.70710677f, 0.70710677f};
  const Quat s = sanitizedRotation(q);
  CHECK(floatBits(s.z) == floatBits(q.z));
  CHECK(floatBits(s.w) == floatBits(q.w));

  PhysicsWorld world;
  const int ball = world.createRigidBody(ballAt(0.f, 1.f, 0.f));
  world.setBodyRotation(ball, 0.f, 0.f, 0.f, 0.f);
  const Quat r = readRot(world, ball);
  CHECK(r.w == 1.f);
  CHECK(r.x == 0.f);
}

TEST_CASE("a non-unit plane normal is normalised (#520 row 10)", "[boundary]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);
  world.addStaticPlane(0.f, 2.f, 0.f, 0.f);
  const int ball = world.createRigidBody(ballAt(0.f, 1.f, 0.f));
  stepFixed(world, 120);
  CHECK(near(readPos(world, ball).y, 0.25f, 0.02f));
}

TEST_CASE("a plane with no direction is refused and counted (#520 row 10)", "[boundary]") {
  PhysicsWorld world;
  world.addStaticPlane(0.f, 0.f, 0.f, 0.f);
  world.addStaticPlane(kNaN, 1.f, 0.f, 0.f);
  CHECK(world.getDroppedStaticCount() == 2);
  const int ball = world.createRigidBody(ballAt(0.f, 1.f, 0.f));
  stepFixed(world, 10);
  CHECK(isFinite(readPos(world, ball)));
}

TEST_CASE("non-finite gravity or rolling resistance is ignored (#520 row 10)", "[boundary][snapshot]") {
  PhysicsWorld world;
  world.createRigidBody(ballAt(0.f, 1.f, 0.f));
  world.setGravity(kNaN, -9.81f, 0.f);
  world.setRollingResistance(kInf);
  CHECK(world.getRollingResistance() == WorldParams{}.rollingResistance);
  world.step(FIXED_DT);
  // A world that accepted them could not restore its own snapshot.
  const std::vector<uint8_t> blob = world.serialize();
  CHECK(world.restore(blob.data(), blob.size()) == SnapshotStatus::Ok);
}

// ---- Row 12: hinge lifetime -------------------------------------------------

TEST_CASE("removeHinge erases the hinge from the snapshot (#520 row 12)", "[hinge][snapshot]") {
  HingedWorld h;
  h.world.removeHinge(h.hinge);
  const std::vector<uint8_t> blob = h.world.serialize();
  CHECK(readWord(blob, layoutOf(blob).hingeCount) == 0);
  // Ids are still never reissued (the worker client's id shadow relies on it).
  CHECK(h.world.createHinge(h.blade, HingeDesc{}) == h.hinge + 1);
}

TEST_CASE("removing a body erases its hinges (#520 row 12)", "[hinge][snapshot]") {
  HingedWorld h;
  h.world.removeRigidBody(h.blade);
  const std::vector<uint8_t> blob = h.world.serialize();
  CHECK(readWord(blob, layoutOf(blob).hingeCount) == 0);
  CHECK(h.world.getHingeAngle(h.hinge) == 0.f);
}

TEST_CASE("flipper rebuilds do not grow the hinge table (#520 row 12)", "[hinge][snapshot]") {
  PhysicsWorld world;
  std::size_t firstSize = 0;
  for (int i = 0; i < 500; ++i) {
    RigidBodyDesc blade;
    blade.shape = Shape::Capsule;
    blade.position = {0.f, 0.5f, 0.f};
    const int body = world.createRigidBody(blade);
    const int hinge = world.createHinge(body, HingeDesc{});
    world.step(FIXED_DT);
    world.removeHinge(hinge);
    world.removeRigidBody(body);
    const std::vector<uint8_t> blob = world.serialize();
    REQUIRE(readWord(blob, layoutOf(blob).hingeCount) == 0);
    if (i == 0) firstSize = blob.size();
  }
  // The handle table still grows by one slot per body until row 13; hinges add nothing.
  const std::vector<uint8_t> last = world.serialize();
  CHECK(last.size() <= firstSize + 499u * 8u);
}

TEST_CASE("hinges keep working after an earlier hinge is removed (#520 row 12)", "[hinge]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  int bodies[3];
  int hinges[3];
  for (int i = 0; i < 3; ++i) {
    RigidBodyDesc blade;
    blade.shape = Shape::Capsule;
    blade.position = {static_cast<float>(i) * 3.f, 0.5f, 0.f};
    bodies[i] = world.createRigidBody(blade);
    HingeDesc h;
    h.worldAnchor = blade.position;
    hinges[i] = world.createHinge(bodies[i], h);
  }
  world.removeHinge(hinges[0]);
  world.setHingeMotor(hinges[2], 3.f, 100.f);
  stepFixed(world, 30);
  CHECK(world.getHingeAngle(hinges[2]) > 0.5f);
  CHECK(world.getHingeAngle(hinges[1]) == 0.f);
  CHECK(world.getHingeAngle(hinges[0]) == 0.f);
}
