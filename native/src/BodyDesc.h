#pragma once

#include "CollisionFilter.h"
#include "MathTypes.h"
#include <cstdint>

namespace pachinball {

/** Identifies how a body participates in simulation. */
enum class BodyType : uint8_t {
  Dynamic  = 0, ///< Moves under forces; owns mass / inertia.
  Static   = 1, ///< Immovable; contributes to collision but never moves.
  Kinematic = 2 ///< Moved programmatically; does not respond to forces.
};

/** Identifies the collision shape a body presents. */
enum class Shape : uint8_t {
  Sphere  = 0, ///< Bounding sphere of `radius` (the original/default shape).
  Capsule = 1, ///< Capsule of `radius` and `capsuleHalfHeight`, segment along local +Y.
  Box     = 2  ///< Oriented box of `boxHalfExtents` (Firewall-style dynamic crates).
};

/** Descriptor passed to PhysicsWorld::createRigidBody(). */
struct RigidBodyDesc {
  Vec3      position       = Vec3::zero();
  Vec3      velocity       = Vec3::zero();
  float     mass           = 1.f;    ///< kg (ignored for Static/Kinematic)
  float     radius         = 0.1f;   ///< Bounding sphere radius, or capsule radius (metres)
  float     restitution    = 0.4f;   ///< Coefficient of restitution (0–1)
  float     linearDamping  = 0.02f;  ///< Linear drag factor
  BodyType  type           = BodyType::Dynamic;
  Shape     shape          = Shape::Sphere;
  float     capsuleHalfHeight = 0.5f; ///< Half-length of the capsule segment (ignored for Sphere)
  float     friction          = 0.2f; ///< Coulomb friction coefficient (≥ 0)
  float     angularDamping    = 0.1f; ///< Angular drag factor (dynamic spheres)
  Vec3      boxHalfExtents    = {0.5f, 0.5f, 0.5f}; ///< Half-extents for Shape::Box (ignored otherwise)
  uint32_t  membership        = COLLISION_GROUPS_ALL; ///< Collision groups this body belongs to
  uint32_t  filter            = COLLISION_GROUPS_ALL; ///< Collision groups this body interacts with
};

} // namespace pachinball
