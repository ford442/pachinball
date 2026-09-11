/**
 * Native unit tests for collision-group membership/filter masks (#383 Slice A).
 *
 *   npm run test:native
 */

#include "PhysicsWorld.h"
#include "test_helpers.hpp"

#include <catch2/catch_test_macros.hpp>

using namespace pachinball;
using namespace pachinball::test;

TEST_CASE("two bodies whose filter masks exclude each other never generate a contact pair", "[physics][filter]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  // Deeply overlapping spheres — would normally produce a broadphase pair
  // and a large separating contact impulse.
  const int a = world.createRigidBody({
    {0.f, 0.f, 0.f}, {0.f, 0.f, 0.f}, 1.f, 0.3f, 0.5f, 0.f, BodyType::Dynamic
  });
  const int b = world.createRigidBody({
    {0.1f, 0.f, 0.f}, {0.f, 0.f, 0.f}, 1.f, 0.3f, 0.5f, 0.f, BodyType::Dynamic
  });

  world.setCollisionGroups(a, 0x1u, 0x1u);
  world.setCollisionGroups(b, 0x2u, 0x2u);

  stepFixed(world, 5);

  CHECK(world.getLastBroadphasePairCount() == 0);
  CHECK(world.getContactCount() == 0);

  // No separation impulse applied — overlapping bodies pass through untouched.
  const Vec3 posA = readPos(world, a);
  const Vec3 posB = readPos(world, b);
  CHECK(near((posA - posB).length(), 0.1f, 1e-4f));
}

TEST_CASE("default membership/filter collides with everything (pre-filter behavior preserved)", "[physics][filter]") {
  PhysicsWorld world;
  world.setGravity(0.f, 0.f, 0.f);

  world.createRigidBody({
    {-0.2f, 0.f, 0.f}, {-1.f, 0.f, 0.f}, 1.f, 0.25f, 0.5f, 0.f, BodyType::Dynamic
  });
  world.createRigidBody({
    {0.2f, 0.f, 0.f}, {1.f, 0.f, 0.f}, 1.f, 0.25f, 0.5f, 0.f, BodyType::Dynamic
  });

  CHECK(world.getLastBroadphasePairCount() == 0); // no substep has run yet

  bool sawContact = false;
  for (int i = 0; i < 5; ++i) {
    world.step(FIXED_DT);
    if (world.getLastBroadphasePairCount() > 0) sawContact = true;
    if (world.getContactCount() > 0) sawContact = true;
  }

  CHECK(sawContact);
}
