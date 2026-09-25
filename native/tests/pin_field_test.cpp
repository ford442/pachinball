/**
 * Pin fields (#421) — a whole pachinko lattice as one static collider.
 *
 *   npm run test:native
 */

#include "PhysicsWorld.h"
#include "test_helpers.hpp"

#include <catch2/catch_test_macros.hpp>

#include <cmath>
#include <memory>
#include <set>
#include <vector>

using namespace pachinball;
using namespace pachinball::test;

namespace {

constexpr float PIN_RADIUS = 0.09f;
constexpr float PIN_HALF_HEIGHT = 0.75f;
constexpr float BALL_RADIUS = 0.2f;

/** 12×12 staggered lattice, 0.6 apart, origin at (-3.3, 0, 0): x ∈ [-3.3, 3.6], z ∈ [0, 6.6]. */
PinFieldDesc denseField() {
  PinFieldDesc d;
  d.origin = {-3.3f, 0.f, 0.f};
  d.rows = 12;
  d.cols = 12;
  d.spacingX = 0.6f;
  d.spacingZ = 0.6f;
  d.rowOffsetX = 0.3f;
  d.radius = PIN_RADIUS;
  d.halfHeight = PIN_HALF_HEIGHT;
  d.restitution = 0.65f;
  d.friction = 0.1f;
  return d;
}

/** Zero-g world: a ball placed on a slot either overlaps that pin or nothing. */
std::unique_ptr<PhysicsWorld> makeStillWorld() {
  auto world = std::make_unique<PhysicsWorld>();
  world->setGravity(0.f, 0.f, 0.f);
  return world;
}

int placeBall(PhysicsWorld& world, Vec3 pos, Vec3 vel = Vec3::zero()) {
  RigidBodyDesc desc{pos, vel, 0.08f, BALL_RADIUS, 0.5f, 0.f, BodyType::Dynamic};
  return world.createRigidBody(desc);
}

int countContacts(const PhysicsWorld& world, int colliderId, std::set<int>* subIndices = nullptr) {
  int n = 0;
  for (const ContactEvent& e : world.lastContactEvents()) {
    if (e.bodyId2 != colliderId) continue;
    ++n;
    if (subIndices) subIndices->insert(e.subIndex);
  }
  return n;
}

/** Drop a ball down -Z through the lattice; returns every pin index it touched. */
std::set<int> dropThrough(PhysicsWorld& world, int fieldId, float x, int steps = 240) {
  world.setGravity(0.f, 0.f, -9.81f);
  placeBall(world, {x, 0.f, 8.f});
  std::set<int> hits;
  for (int i = 0; i < steps; ++i) {
    world.step(FIXED_DT);
    countContacts(world, fieldId, &hits);
  }
  return hits;
}

} // namespace

TEST_CASE("a ball falling through a 12x12 field contacts its pins", "[physics][pin-field]") {
  PhysicsWorld world;
  const int field = world.addPinField(denseField());
  CHECK(field == PIN_FIELD_ID_BASE);
  CHECK(world.getPinFieldPinCount(field) == 144);

  const std::set<int> hits = dropThrough(world, field, 0.05f);
  REQUIRE(!hits.empty());
  for (int idx : hits) {
    CHECK(idx >= 0);
    CHECK(idx < 144);
  }
  // A 0.2 m ball cannot slip through a 0.6 m lattice without touching
  // several rows on the way down.
  std::set<int> rows;
  for (int idx : hits) rows.insert(idx / 12);
  CHECK(rows.size() >= 2);
}

TEST_CASE("a keep-out AABB holds no pin", "[physics][pin-field]") {
  PinFieldDesc desc = denseField();
  // Rows 0–1, cols 0–1 of an even row sit at x ∈ {-3.3, -2.7}, z ∈ {0, 0.6}.
  desc.keepOuts.push_back({-3.5f, -2.5f, -0.1f, 0.7f});
  auto world = makeStillWorld();
  const int field = world->addPinField(desc);
  // Row 0: cols 0, 1 (x -3.3, -2.7). Row 1 (offset 0.3): col 0 (x -3.0) only.
  CHECK(world->getPinFieldPinCount(field) == 144 - 3);

  placeBall(*world, {-3.3f, 0.f, 0.f});      // on the kept-out slot (0, 0)
  world->step(FIXED_DT);
  CHECK(countContacts(*world, field) == 0);

  auto control = makeStillWorld();
  const int full = control->addPinField(denseField());
  placeBall(*control, {-3.3f, 0.f, 0.f});
  control->step(FIXED_DT);
  CHECK(countContacts(*control, full) == 1);
}

TEST_CASE("an occupancy mask punches a hole", "[physics][pin-field]") {
  PinFieldDesc desc = denseField();
  desc.occupancy.assign(18, 0xFF);           // 144 bits
  const int hole = 5 * 12 + 6;               // row 5 (odd), col 6
  desc.occupancy[hole >> 3] &= static_cast<uint8_t>(~(1u << (hole & 7)));

  auto world = makeStillWorld();
  const int field = world->addPinField(desc);
  CHECK(world->getPinFieldPinCount(field) == 143);

  // Slot (5, 6): x = -3.3 + 6 * 0.6 + 0.3 = 0.6, z = 3.0.
  placeBall(*world, {0.6f, 0.f, 3.f});
  world->step(FIXED_DT);
  CHECK(countContacts(*world, field) == 0);

  // The neighbouring slot (5, 7) is still there, and reports its own index.
  placeBall(*world, {1.2f, 0.f, 3.f});
  world->step(FIXED_DT);
  std::set<int> hit;
  CHECK(countContacts(*world, field, &hit) == 1);
  CHECK(hit == std::set<int>{hole + 1});
}

TEST_CASE("a short mask clears the slots it does not cover", "[physics][pin-field]") {
  PinFieldDesc desc = denseField();
  desc.occupancy = {0xFF};                   // first 8 slots only
  PhysicsWorld world;
  CHECK(world.getPinFieldPinCount(world.addPinField(desc)) == 8);
}

TEST_CASE("seeded dropout is deterministic and shared with TypeScript", "[physics][pin-field]") {
  // Golden values locked on both sides — tests/pin-field.test.ts repeats them.
  CHECK(pinFieldHash(0u, 0u) == 0u);
  CHECK(pinFieldHash(12345u, 0u) == 0x912EFCF7u);
  CHECK(pinFieldHash(12345u, 77u) == 0x7C96F560u);

  PinFieldDesc desc = denseField();
  desc.dropoutSeed = 12345u;
  desc.dropout = 0.25f;
  PhysicsWorld a;
  PhysicsWorld b;
  const int countA = a.getPinFieldPinCount(a.addPinField(desc));
  CHECK(countA == b.getPinFieldPinCount(b.addPinField(desc)));
  CHECK(countA == 116);  // tests/pin-field.test.ts resolves the same 116 in TS

  desc.dropout = 0.f;
  PhysicsWorld none;
  CHECK(none.getPinFieldPinCount(none.addPinField(desc)) == 144);
  desc.dropout = 1.f;
  PhysicsWorld all;
  CHECK(all.getPinFieldPinCount(all.addPinField(desc)) == 0);
}

TEST_CASE("a pin field steps like the same pins added one cylinder at a time", "[physics][pin-field]") {
  const PinFieldDesc desc = denseField();
  PhysicsWorld fieldWorld;
  PhysicsWorld loopWorld;
  fieldWorld.setGravity(0.f, 0.f, -9.81f);
  loopWorld.setGravity(0.f, 0.f, -9.81f);

  fieldWorld.addPinField(desc);
  const PinField resolved = buildPinField(desc);
  for (int r = 0; r < desc.rows; ++r) {
    for (int c = 0; c < desc.cols; ++c) {
      const Vec3 p = resolved.worldPin(r, c);
      loopWorld.addStaticCylinder(p.x, p.y, p.z, desc.radius, desc.halfHeight,
                                  0.f, 0.f, 0.f, 1.f, desc.restitution, desc.friction);
    }
  }

  const int a = placeBall(fieldWorld, {0.05f, 0.f, 8.f});
  const int b = placeBall(loopWorld, {0.05f, 0.f, 8.f});
  for (int i = 0; i < 90; ++i) {
    fieldWorld.step(FIXED_DT);
    loopWorld.step(FIXED_DT);
  }
  const Vec3 pa = readPos(fieldWorld, a);
  const Vec3 pb = readPos(loopWorld, b);
  CHECK(isFinite(pa));
  CHECK(near(pa.x, pb.x, 1e-3f));
  CHECK(near(pa.z, pb.z, 1e-3f));
  CHECK(pa.z < 7.f);  // it did fall into the field
}

TEST_CASE("a rotated field collides where its pins actually are", "[physics][pin-field]") {
  PinFieldDesc desc = denseField();
  desc.origin = Vec3::zero();
  desc.rows = 3;
  desc.cols = 3;
  desc.rowOffsetX = 0.f;
  // 90° about +Y: local +X maps to world -Z, local +Z to world +X.
  const float s = std::sqrt(0.5f);
  desc.rotation = {0.f, s, 0.f, s};

  auto world = makeStillWorld();
  const int field = world->addPinField(desc);

  placeBall(*world, {0.6f, 0.f, -1.2f});      // slot (row 1, col 2)
  world->step(FIXED_DT);
  std::set<int> hit;
  CHECK(countContacts(*world, field, &hit) == 1);
  CHECK(hit == std::set<int>{1 * 3 + 2});

  auto miss = makeStillWorld();
  const int missField = miss->addPinField(desc);
  placeBall(*miss, {-0.6f, 0.f, 1.2f});       // the unrotated slot — nothing there now
  miss->step(FIXED_DT);
  CHECK(countContacts(*miss, missField) == 0);
}

TEST_CASE("a ball above the pin tops never touches the field", "[physics][pin-field]") {
  auto world = makeStillWorld();
  const int field = world->addPinField(denseField());
  placeBall(*world, {-3.3f, PIN_HALF_HEIGHT + BALL_RADIUS + 0.05f, 0.f});
  world->step(FIXED_DT);
  CHECK(countContacts(*world, field) == 0);
}

TEST_CASE("collision groups on the field id gate every pin at once", "[physics][pin-field]") {
  auto world = makeStillWorld();
  const int field = world->addPinField(denseField());
  world->setCollisionGroups(field, 0u, 0u);
  placeBall(*world, {-3.3f, 0.f, 0.f});
  world->step(FIXED_DT);
  CHECK(countContacts(*world, field) == 0);

  world->setCollisionGroups(field, COLLISION_GROUPS_ALL, COLLISION_GROUPS_ALL);
  world->step(FIXED_DT);
  CHECK(countContacts(*world, field) == 1);
}

TEST_CASE("four dense fields plus table statics fit without dropping a handle", "[physics][pin-field]") {
  PhysicsWorld world;
  // A realistic table's worth of statics alongside the fields.
  for (int i = 0; i < 40; ++i) world.addStaticBox(0.f, 0.f, static_cast<float>(i), 1.f, 1.f, 1.f, 0.f, 0.f, 0.f, 1.f);
  for (int i = 0; i < 20; ++i) world.addStaticCylinder(static_cast<float>(i), 0.f, 0.f, 0.2f, 0.5f, 0.f, 0.f, 0.f, 1.f);

  PinFieldDesc desc = denseField();
  desc.rows = 20;
  desc.cols = 20;                            // 400 pins each — 1600 in total
  int pins = 0;
  for (int f = 0; f < 4; ++f) {
    desc.origin = {static_cast<float>(f) * 20.f, 0.f, 0.f};
    const int id = world.addPinField(desc);
    CHECK(id == PIN_FIELD_ID_BASE - f);
    pins += world.getPinFieldPinCount(id);
  }
  CHECK(pins == 1600);
  CHECK(world.getDroppedStaticCount() == 0);
}

TEST_CASE("the pin-field family has its own capacity and clears with the statics", "[physics][pin-field]") {
  PhysicsWorld world;
  PinFieldDesc desc = denseField();
  desc.rows = 1;
  desc.cols = 1;
  for (std::size_t i = 0; i < STATIC_HANDLE_CAPACITY; ++i) world.addPinField(desc);
  CHECK(world.getDroppedStaticCount() == 0);
  CHECK(world.addPinField(desc) == STATIC_HANDLE_OVERFLOW);
  CHECK(world.getDroppedStaticCount() == 1);

  world.clearStaticGeometry();
  CHECK(world.getDroppedStaticCount() == 0);
  CHECK(world.addPinField(desc) == PIN_FIELD_ID_BASE);
  CHECK(world.getPinFieldPinCount(PIN_FIELD_ID_BASE - 1) == -1);
}

TEST_CASE("the cone family no longer swallows pin-field ids", "[physics][pin-field]") {
  // setCollisionGroups used to treat every id <= -9000 as a cone.
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  const int cone = world.addStaticCone(50.f, 0.f, 50.f, 0.5f, 0.5f, 0.f, 0.f, 0.f, 1.f, 0.4f, 0.2f);
  const int field = world.addPinField(denseField());
  world.setCollisionGroups(field, 0u, 0u);
  placeBall(world, {-3.3f, 0.f, 0.f});
  world.step(FIXED_DT);
  CHECK(countContacts(world, field) == 0);
  CHECK(cone == STATIC_CONE_ID_BASE);
}
