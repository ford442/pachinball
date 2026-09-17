/**
 * Native unit tests for the adventure geometry set (#383 Slice B): static
 * cylinders, kinematic cylinder movers, shaped sensor volumes, static
 * triangle meshes, force fields and dynamic boxes.
 *
 *   npm run test:native
 */

#include "PhysicsWorld.h"
#include "Cylinder.h"
#include "ForceField.h"
#include "TriangleMesh.h"
#include "test_helpers.hpp"

#include <catch2/catch_test_macros.hpp>

#include <array>
#include <cmath>
#include <vector>

using namespace pachinball;
using namespace pachinball::test;

namespace {

/**
 * A flat quad, split into two triangles sharing the a–c diagonal, tilted by
 * `slopeDeg` about the X axis so +Z runs downhill. Winding is CCW seen from
 * above, so the face normals point up out of the ramp.
 */
struct RampMesh {
  std::vector<float>    vertices;
  std::vector<uint32_t> indices;
};

RampMesh makeRamp(float halfWidth, float halfLength, float slopeDeg, float centreY) {
  const float s = std::sin(slopeDeg * 3.14159265358979f / 180.f);
  const float c = std::cos(slopeDeg * 3.14159265358979f / 180.f);

  // Corners in the ramp plane: (x, z) rotated about X so height falls with +z.
  auto corner = [&](float x, float z) {
    return Vec3{x, centreY - z * s, z * c};
  };

  const Vec3 v0 = corner(-halfWidth, -halfLength);
  const Vec3 v1 = corner( halfWidth, -halfLength);
  const Vec3 v2 = corner( halfWidth,  halfLength);
  const Vec3 v3 = corner(-halfWidth,  halfLength);

  RampMesh mesh;
  for (const Vec3& v : {v0, v1, v2, v3}) {
    mesh.vertices.push_back(v.x);
    mesh.vertices.push_back(v.y);
    mesh.vertices.push_back(v.z);
  }
  // CCW from above: (0,3,2) and (0,2,1) share the 0–2 diagonal.
  mesh.indices = {0, 3, 2, 0, 2, 1};
  return mesh;
}

int addRamp(PhysicsWorld& world, const RampMesh& mesh, float friction = 0.05f) {
  return world.addStaticTriangleMesh(mesh.vertices.data(),
                                     static_cast<int>(mesh.vertices.size() / 3),
                                     mesh.indices.data(),
                                     static_cast<int>(mesh.indices.size()),
                                     0.1f, friction, false);
}

/**
 * Closed triangular prism, axis +Y, ring vertex j at angle -j·120° — the same
 * layout as `triangularPrismLayout` in src/adventure/track-geometry.ts, which
 * replaced prism-pathway's Rapier convex hull. Winding is fixed per face so
 * every normal points out of the solid.
 */
RampMesh makePrism(float radius, float height) {
  RampMesh mesh;
  const float h = height / 2.f;
  for (float y : {-h, h}) {
    for (int j = 0; j < 3; ++j) {
      const float a = static_cast<float>(j) * 2.f * 3.14159265358979f / 3.f;
      mesh.vertices.push_back(std::cos(-a) * radius);
      mesh.vertices.push_back(y);
      mesh.vertices.push_back(std::sin(-a) * radius);
    }
  }
  std::vector<std::array<uint32_t, 3>> faces = {{0, 1, 2}, {3, 4, 5}};
  for (uint32_t j = 0; j < 3; ++j) {
    const uint32_t k = (j + 1) % 3;
    faces.push_back({j, k, k + 3});
    faces.push_back({j, k + 3, j + 3});
  }
  auto at = [&](uint32_t i) {
    return Vec3{mesh.vertices[i * 3], mesh.vertices[i * 3 + 1], mesh.vertices[i * 3 + 2]};
  };
  for (const auto& f : faces) {
    const Vec3 a = at(f[0]), b = at(f[1]), c = at(f[2]);
    const Vec3 n = (b - a).cross(c - a);
    const bool outward = n.dot(a + b + c) >= 0.f;
    mesh.indices.push_back(f[0]);
    mesh.indices.push_back(outward ? f[1] : f[2]);
    mesh.indices.push_back(outward ? f[2] : f[1]);
  }
  return mesh;
}

} // namespace

// ---------------------------------------------------------------------------
// Static triangle meshes
// ---------------------------------------------------------------------------

TEST_CASE("ball rolls down a 15 degree triangle-mesh ramp", "[physics][mesh]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);
  world.setRollingResistance(0.f);

  const RampMesh ramp = makeRamp(4.f, 6.f, 15.f, 2.f);
  addRamp(world, ramp);

  // Spawn just above the surface at z = -4: the ramp plane there sits at
  // y = 2 - z·tan15°, i.e. ~3.07.
  const int ball = world.createRigidBody({
    {0.f, 3.35f, -4.f}, {0.f, 0.f, 0.f},
    1.f, 0.2f, 0.1f, 0.f, BodyType::Dynamic
  });

  stepFixed(world, 120);

  const Vec3 pos = readPos(world, ball);
  const Vec3 vel = readVel(world, ball);

  REQUIRE(isFinite(pos));
  // Downhill is +z: the ball must have travelled that way and be moving.
  CHECK(pos.z > -3.f);
  CHECK(vel.z > 0.5f);
  // And it must still be riding the surface, not fallen through it.
  const float surfaceY = 2.f - pos.z * std::tan(15.f * 3.14159265358979f / 180.f);
  CHECK(pos.y > surfaceY - 0.1f);
}

TEST_CASE("ball crossing the shared diagonal of a mesh ramp feels no seam", "[physics][mesh]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);
  world.setRollingResistance(0.f);

  // Flat, so the two coplanar triangles differ only by which one owns the
  // contact. A seam would show up as a vertical kick as the ball crosses.
  const RampMesh flat = makeRamp(4.f, 4.f, 0.f, 1.f);
  addRamp(world, flat, 0.f);

  const int ball = world.createRigidBody({
    {-3.f, 1.2f, -3.f}, {3.f, 0.f, 3.f},
    1.f, 0.2f, 0.f, 0.f, BodyType::Dynamic
  });

  stepFixed(world, 30); // settle onto the surface

  float peakUpward = 0.f;
  for (int i = 0; i < 60; ++i) {
    world.step(FIXED_DT);
    peakUpward = std::max(peakUpward, readVel(world, ball).y);
  }

  // The ball traverses the 0–2 diagonal during this window; any ghost contact
  // on the internal edge would fling it upward.
  CHECK(peakUpward < 0.5f);
  CHECK(readPos(world, ball).y > 0.9f);
}

TEST_CASE("a one-sided mesh does not collide from behind its face", "[physics][mesh]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  const RampMesh flat = makeRamp(4.f, 4.f, 0.f, 1.f);
  const int meshId = addRamp(world, flat);

  // Rising from underneath: the ball must pass straight through.
  const int ball = world.createRigidBody({
    {0.f, 0.f, 0.f}, {0.f, 3.f, 0.f},
    1.f, 0.2f, 0.5f, 0.f, BodyType::Dynamic
  });

  bool touched = false;
  for (int i = 0; i < 60; ++i) {
    world.step(FIXED_DT);
    for (const ContactEvent& evt : world.lastContactEvents()) {
      if (evt.bodyId2 == meshId) touched = true;
    }
  }

  CHECK_FALSE(touched);
  CHECK(readPos(world, ball).y > 1.5f);
  CHECK(near(readVel(world, ball).y, 3.f, 0.1f));
}

TEST_CASE("mesh collision-group filtering excludes a non-matching ball", "[physics][mesh][filter]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);

  const RampMesh flat = makeRamp(4.f, 4.f, 0.f, 1.f);
  const int meshId = addRamp(world, flat);
  world.setCollisionGroups(meshId, GROUP_ADVENTURE, GROUP_ADVENTURE);

  const int ball = world.createRigidBody({
    {0.f, 2.f, 0.f}, {0.f, 0.f, 0.f},
    1.f, 0.2f, 0.1f, 0.f, BodyType::Dynamic
  });
  world.setCollisionGroups(ball, GROUP_BALL, GROUP_BALL);

  stepFixed(world, 60);

  // No interaction, so the ball is in free fall well below the ramp plane.
  CHECK(readPos(world, ball).y < 0.5f);
}

// ---------------------------------------------------------------------------
// Static cylinders
// ---------------------------------------------------------------------------

TEST_CASE("ball dropped onto a static cylinder cap comes to rest on it", "[physics][cylinder]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);

  // Upright cylinder, cap top at y = 1.
  const int cylId = world.addStaticCylinder(0.f, 0.5f, 0.f, 0.6f, 0.5f,
                                            0.f, 0.f, 0.f, 1.f, 0.1f, 0.4f);

  const int ball = world.createRigidBody({
    {0.f, 2.f, 0.f}, {0.f, 0.f, 0.f},
    1.f, 0.2f, 0.1f, 0.f, BodyType::Dynamic
  });

  bool sawContact = false;
  for (int i = 0; i < 120; ++i) {
    world.step(FIXED_DT);
    for (const ContactEvent& evt : world.lastContactEvents()) {
      if (evt.bodyId2 == cylId) sawContact = true;
    }
  }

  CHECK(sawContact);
  const Vec3 pos = readPos(world, ball);
  CHECK(near(pos.y, 1.2f, 0.05f)); // cap top + ball radius
  CHECK(std::fabs(readVel(world, ball).y) < 0.2f);
}

TEST_CASE("ball striking a cylinder wall off-centre is deflected sideways", "[physics][cylinder]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  // A pachinko pin: upright, tall enough that only the wall is in play.
  world.addStaticCylinder(0.f, 0.f, 0.f, 0.5f, 2.f,
                          0.f, 0.f, 0.f, 1.f, 0.5f, 0.1f);

  const int ball = world.createRigidBody({
    {0.3f, 0.f, -3.f}, {0.f, 0.f, 4.f},
    1.f, 0.15f, 0.5f, 0.f, BodyType::Dynamic
  });

  stepFixed(world, 90);

  const Vec3 vel = readVel(world, ball);
  REQUIRE(isFinite(vel));
  // Struck right of the axis, so it must be pushed further +x, not pass through.
  CHECK(vel.x > 0.2f);
  CHECK(readPos(world, ball).x > 0.3f);
}

// ---------------------------------------------------------------------------
// Kinematic cylinder movers
// ---------------------------------------------------------------------------

TEST_CASE("spinning kinematic cylinder platter imparts tangential velocity", "[physics][mover][cylinder]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);

  KinematicMoverDesc desc;
  desc.shape = VolumeShape::Cylinder;
  desc.position = {0.f, 0.f, 0.f};
  desc.halfExtents = {2.f, 0.2f, 2.f}; // radius 2, half-height 0.2
  desc.friction = 1.0f;
  desc.restitution = 0.f;
  const int platter = world.addKinematicMover(desc);

  // Ball resting on the disc, one metre out along +x.
  const int ball = world.createRigidBody({
    {1.f, 0.45f, 0.f}, {0.f, 0.f, 0.f},
    1.f, 0.2f, 0.f, 0.f, BodyType::Dynamic, Shape::Sphere, 0.5f, 1.0f
  });

  stepFixed(world, 20);
  REQUIRE(near(readPos(world, ball).y, 0.4f, 0.06f)); // resting on the cap

  // Spin about +Y at ~2 rad/s. At radius 1 that is ~2 m/s tangential (+z).
  const float omega = 2.f;
  float angle = 0.f;
  for (int i = 0; i < 40; ++i) {
    angle += omega * FIXED_DT;
    const float half = angle * 0.5f;
    world.setNextKinematicTransform(platter, 0.f, 0.f, 0.f,
                                    0.f, std::sin(half), 0.f, std::cos(half));
    world.step(FIXED_DT);
  }

  const Vec3 vel = readVel(world, ball);
  REQUIRE(isFinite(vel));
  // Right-handed spin about +Y carries +X toward -Z, so that is the way a
  // ball sitting out along +X gets dragged.
  CHECK(vel.z < -0.3f);
  CHECK(vel.lengthSq() > 0.1f);
}

// ---------------------------------------------------------------------------
// Shaped sensor volumes
// ---------------------------------------------------------------------------

TEST_CASE("cylinder sensor emits one enter and one exit as a ball passes through", "[physics][sensor][cylinder]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  SensorVolumeDesc desc;
  desc.shape = VolumeShape::Cylinder;
  desc.center = {0.f, 0.f, 0.f};
  desc.halfExtents = {0.5f, 2.f, 0.5f}; // a chroma-gate column
  const int sensorId = world.addSensorVolume(desc);

  world.createRigidBody({
    {-2.f, 0.f, 0.f}, {2.f, 0.f, 0.f},
    1.f, 0.1f, 0.5f, 0.f, BodyType::Dynamic
  });

  int enterCount = 0, exitCount = 0, stayCount = 0;
  for (int i = 0; i < 120; ++i) {
    world.step(FIXED_DT);
    for (const ContactEvent& evt : world.lastContactEvents()) {
      if (evt.bodyId2 != sensorId) continue;
      CHECK(evt.isSensor);
      CHECK(evt.impulse == 0.f);
      if (evt.phase == ContactPhase::Enter) ++enterCount;
      else if (evt.phase == ContactPhase::Exit) ++exitCount;
      else ++stayCount;
    }
  }

  CHECK(enterCount == 1);
  CHECK(exitCount == 1);
  CHECK(stayCount > 0);
}

TEST_CASE("sphere sensor triggers only within its radius", "[physics][sensor]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  SensorVolumeDesc desc;
  desc.shape = VolumeShape::Sphere;
  desc.center = {0.f, 0.f, 0.f};
  desc.halfExtents = {1.f, 1.f, 1.f}; // a mag-spin catch radius
  const int sensorId = world.addSensorVolume(desc);

  // Passes 2.0m to the side — outside the radius, so it must never fire.
  world.createRigidBody({
    {-4.f, 0.f, 2.f}, {3.f, 0.f, 0.f},
    1.f, 0.1f, 0.5f, 0.f, BodyType::Dynamic
  });
  // Straight through the middle — must fire.
  world.createRigidBody({
    {-4.f, 0.f, 0.f}, {3.f, 0.f, 0.f},
    1.f, 0.1f, 0.5f, 0.f, BodyType::Dynamic
  });

  int enters = 0, exits = 0;
  for (int i = 0; i < 120; ++i) {
    world.step(FIXED_DT);
    for (const ContactEvent& evt : world.lastContactEvents()) {
      if (evt.bodyId2 != sensorId) continue;
      if (evt.phase == ContactPhase::Enter) ++enters;
      else if (evt.phase == ContactPhase::Exit) ++exits;
    }
  }

  CHECK(enters == 1);
  CHECK(exits == 1);
}

TEST_CASE("a capsule body triggers a sensor volume", "[physics][sensor][capsule]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  SensorVolumeDesc desc;
  desc.center = {0.f, 0.f, 0.f};
  desc.halfExtents = {0.4f, 0.4f, 0.4f};
  const int sensorId = world.addSensorVolume(desc);

  // A flipper-blade-shaped capsule sweeping past. Its centre never enters the
  // volume — only the far end of the segment does, which is exactly the case
  // the old sphere-only sensor dispatch missed.
  world.createRigidBody({
    {-3.f, 0.f, 0.f}, {2.f, 0.f, 0.f},
    2.f, 0.2f, 0.f, 0.f, BodyType::Dynamic, Shape::Capsule, 1.2f
  });

  int enters = 0;
  for (int i = 0; i < 90; ++i) {
    world.step(FIXED_DT);
    for (const ContactEvent& evt : world.lastContactEvents()) {
      if (evt.bodyId2 == sensorId && evt.phase == ContactPhase::Enter) ++enters;
    }
  }

  CHECK(enters == 1);
}

// ---------------------------------------------------------------------------
// Force fields
// ---------------------------------------------------------------------------

TEST_CASE("an updraft force field lifts a ball against gravity", "[physics][forcefield]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);

  ForceFieldDesc field;
  field.center = {0.f, 5.f, 0.f};
  field.halfExtents = {2.f, 5.f, 2.f};
  field.force = {0.f, 20.f, 0.f}; // m/s², comfortably beating gravity
  field.acceleration = true;
  world.addForceField(field);

  const int light = world.createRigidBody({
    {0.f, 2.f, 0.f}, {0.f, 0.f, 0.f},
    1.f, 0.2f, 0.1f, 0.f, BodyType::Dynamic
  });
  const int heavy = world.createRigidBody({
    {1.f, 2.f, 0.f}, {0.f, 0.f, 0.f},
    8.f, 0.2f, 0.1f, 0.f, BodyType::Dynamic
  });

  stepFixed(world, 60);

  CHECK(readPos(world, light).y > 2.5f);
  // Acceleration mode is mass-independent, so both rise together.
  CHECK(near(readPos(world, light).y, readPos(world, heavy).y, 0.05f));
}

TEST_CASE("a ball outside a force field's region is untouched", "[physics][forcefield]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  ForceFieldDesc field;
  field.center = {0.f, 0.f, 0.f};
  field.halfExtents = {1.f, 1.f, 1.f};
  field.force = {0.f, 50.f, 0.f};
  field.acceleration = true;
  world.addForceField(field);

  const int outside = world.createRigidBody({
    {5.f, 0.f, 0.f}, {0.f, 0.f, 0.f},
    1.f, 0.2f, 0.1f, 0.f, BodyType::Dynamic
  });

  stepFixed(world, 60);
  CHECK(near(readPos(world, outside).y, 0.f, 1e-3f));
}

TEST_CASE("a disabled force field can be switched back on", "[physics][forcefield]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  ForceFieldDesc field;
  field.center = {0.f, 0.f, 0.f};
  field.halfExtents = {3.f, 3.f, 3.f};
  field.force = {0.f, 0.f, 10.f};
  field.acceleration = true;
  field.enabled = false;
  const int fieldId = world.addForceField(field);

  const int ball = world.createRigidBody({
    {0.f, 0.f, 0.f}, {0.f, 0.f, 0.f},
    1.f, 0.2f, 0.1f, 0.f, BodyType::Dynamic
  });

  stepFixed(world, 30);
  CHECK(near(readVel(world, ball).z, 0.f, 1e-3f));

  world.setForceFieldEnabled(fieldId, true);
  stepFixed(world, 30);
  CHECK(readVel(world, ball).z > 1.f);
}

// ---------------------------------------------------------------------------
// Dynamic boxes
// ---------------------------------------------------------------------------

TEST_CASE("a dynamic box dropped on a static box comes to rest on it", "[physics][dynbox]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);

  // Table top at y = 0.
  world.addStaticBox(0.f, -0.5f, 0.f, 5.f, 0.5f, 5.f,
                     0.f, 0.f, 0.f, 1.f, 0.1f, 0.6f);

  RigidBodyDesc crate;
  crate.position = {0.f, 1.f, 0.f};
  crate.mass = 2.f;
  crate.shape = Shape::Box;
  crate.boxHalfExtents = {0.3f, 0.3f, 0.3f};
  crate.radius = crate.boxHalfExtents.length();
  crate.restitution = 0.f;
  crate.friction = 0.6f;
  const int box = world.createRigidBody(crate);

  stepFixed(world, 180);

  const Vec3 pos = readPos(world, box);
  const Vec3 vel = readVel(world, box);
  REQUIRE(isFinite(pos));
  REQUIRE(isFinite(vel));
  CHECK(near(pos.y, 0.3f, 0.08f));  // half-extent above the surface
  CHECK(std::fabs(vel.y) < 0.2f);
  CHECK(std::fabs(pos.x) < 0.2f);   // did not wander off
}

TEST_CASE("a ball striking a dynamic box pushes it and recoils", "[physics][dynbox]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  RigidBodyDesc crate;
  crate.position = {0.f, 0.f, 0.f};
  crate.mass = 1.f;
  crate.shape = Shape::Box;
  crate.boxHalfExtents = {0.4f, 0.4f, 0.4f};
  crate.radius = crate.boxHalfExtents.length();
  crate.restitution = 0.2f;
  crate.linearDamping = 0.f;
  const int box = world.createRigidBody(crate);

  const int ball = world.createRigidBody({
    {-3.f, 0.f, 0.f}, {4.f, 0.f, 0.f},
    1.f, 0.2f, 0.2f, 0.f, BodyType::Dynamic
  });

  stepFixed(world, 90);

  const Vec3 boxVel = readVel(world, box);
  const Vec3 ballVel = readVel(world, ball);
  REQUIRE(isFinite(boxVel));
  CHECK(boxVel.x > 0.5f);          // crate was knocked along
  CHECK(ballVel.x < boxVel.x);     // and the ball gave up that momentum
}

TEST_CASE("a dynamic box rests on a triangle-mesh floor", "[physics][dynbox][mesh]") {
  PhysicsWorld world;
  world.setGravity(0.f, -9.81f, 0.f);

  const RampMesh floorMesh = makeRamp(5.f, 5.f, 0.f, 0.f);
  addRamp(world, floorMesh, 0.6f);

  RigidBodyDesc crate;
  crate.position = {0.f, 1.5f, 0.f};
  crate.mass = 2.f;
  crate.shape = Shape::Box;
  crate.boxHalfExtents = {0.3f, 0.3f, 0.3f};
  crate.radius = crate.boxHalfExtents.length();
  crate.restitution = 0.f;
  crate.friction = 0.6f;
  const int box = world.createRigidBody(crate);

  stepFixed(world, 180);

  const Vec3 pos = readPos(world, box);
  REQUIRE(isFinite(pos));
  CHECK(pos.y > -0.2f);            // did not fall through the soup
  CHECK(pos.y < 0.6f);             // and did settle down onto it
  CHECK(std::fabs(readVel(world, box).y) < 0.3f);
}

// ---------------------------------------------------------------------------
// Prism-pathway's prisms: a closed convex triangle mesh in place of a hull
// ---------------------------------------------------------------------------

TEST_CASE("a ball bounces off a prism face exactly as off a box face in the same plane", "[physics][mesh][prism]") {
  // The prism's side between ring vertices 1 and 2 lies in the plane
  // x = cos(120°)·0.5 = -0.25, facing -X. A static box whose -X face sits in
  // that plane is the reference a convex hull would also have matched.
  auto fire = [](bool usePrism) {
    PhysicsWorld world;
    world.setGravity(0.f, 0.f, 0.f);
    if (usePrism) {
      const RampMesh prism = makePrism(0.5f, 1.5f);
      world.addStaticTriangleMesh(prism.vertices.data(), static_cast<int>(prism.vertices.size() / 3),
                                  prism.indices.data(), static_cast<int>(prism.indices.size()),
                                  0.8f, 0.2f, false);
    } else {
      world.addStaticBox(0.75f, 0.f, 0.f, 1.f, 0.75f, 1.f, 0.f, 0.f, 0.f, 1.f, 0.8f, 0.2f);
    }
    const int ball = world.createRigidBody({
      {-3.f, 0.f, 0.f}, {6.f, 0.f, 0.f},
      1.f, 0.2f, 0.8f, 0.f, BodyType::Dynamic
    });
    stepFixed(world, 60);
    return std::make_pair(readPos(world, ball), readVel(world, ball));
  };

  const auto [prismPos, prismVel] = fire(true);
  const auto [boxPos, boxVel] = fire(false);

  REQUIRE(isFinite(prismVel));
  CHECK(prismVel.x < -1.f);                       // reflected back toward -X
  CHECK(near(prismVel.x, boxVel.x, 0.05f));
  CHECK(near(prismVel.y, 0.f, 1e-3f));
  CHECK(near(prismVel.z, 0.f, 1e-3f));
  CHECK(near(prismPos.x, boxPos.x, 0.05f));
}

TEST_CASE("a ball clipping a prism's vertical edge deflects and never enters the solid", "[physics][mesh][prism]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);
  const RampMesh prism = makePrism(0.5f, 1.5f);
  world.addStaticTriangleMesh(prism.vertices.data(), static_cast<int>(prism.vertices.size() / 3),
                              prism.indices.data(), static_cast<int>(prism.indices.size()),
                              0.8f, 0.2f, false);

  // Aimed at the +X edge (ring vertex 0) a little off-centre toward +Z.
  const int ball = world.createRigidBody({
    {3.f, 0.f, 0.1f}, {-6.f, 0.f, 0.f},
    1.f, 0.2f, 0.8f, 0.f, BodyType::Dynamic
  });

  // Inside the triangular cross-section means past all three side planes.
  const float c = std::cos(2.f * 3.14159265358979f / 3.f);
  auto inside = [&](const Vec3& p) {
    const Vec3 v[3] = {{0.5f, 0.f, 0.f}, {c * 0.5f, 0.f, -std::sin(2.f * 3.14159265358979f / 3.f) * 0.5f},
                       {c * 0.5f, 0.f, std::sin(2.f * 3.14159265358979f / 3.f) * 0.5f}};
    bool pos = false, neg = false;
    for (int i = 0; i < 3; ++i) {
      const Vec3 a = v[i], b = v[(i + 1) % 3];
      const float side = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
      (side > 0.f ? pos : neg) = true;
    }
    return !(pos && neg);
  };

  for (int i = 0; i < 90; ++i) {
    world.step(FIXED_DT);
    REQUIRE_FALSE(inside(readPos(world, ball)));
  }
  const Vec3 vel = readVel(world, ball);
  CHECK(vel.x > 0.f);   // turned back from the edge
  CHECK(vel.z > 0.f);   // and pushed to the side it struck on
}
