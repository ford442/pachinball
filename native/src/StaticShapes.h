#pragma once

#include "CollisionFilter.h"
#include "MathTypes.h"

#include <cstdint>

#include <cstddef>

namespace pachinball {

/** Parameters for creating an infinite half-space (static plane). */
struct PlaneDesc {
  Vec3  normal   = Vec3::up();
  float distance = 0.f;
  float friction = 0.2f;
};

/** Oriented static box collider (half-extents in local space). */
struct BoxDesc {
  Vec3     center       = Vec3::zero();
  Vec3     halfExtents  = {0.5f, 0.5f, 0.5f};
  Quat     rotation     = Quat::identity();
  float    restitution  = 0.4f;
  float    friction     = 0.2f;
  uint32_t membership   = COLLISION_GROUPS_ALL;
  uint32_t filter       = COLLISION_GROUPS_ALL;
};

/** Oriented static capsule collider (local Y is the segment axis). */
struct CapsuleDesc {
  Vec3     center      = Vec3::zero();
  float    radius      = 0.1f;
  float    halfHeight  = 0.5f;
  Quat     rotation    = Quat::identity();
  float    restitution = 0.4f;
  float    friction    = 0.2f;
  uint32_t membership  = COLLISION_GROUPS_ALL;
  uint32_t filter      = COLLISION_GROUPS_ALL;
};

/** Negative body IDs reserved for static colliders in contact events. */
static constexpr int STATIC_PLANE_ID    = -1;
static constexpr int STATIC_BOX_ID_BASE   = -1000;
static constexpr int STATIC_CAPSULE_ID_BASE = -2000;
// KINEMATIC_MOVER_ID_BASE (-3000) and SENSOR_VOLUME_ID_BASE (-4000) are
// declared in KinematicMover.h / SensorVolume.h respectively;
// STATIC_CYLINDER_ID_BASE (-5000) in StaticShapes.h;
// STATIC_MESH_ID_BASE (-6000) in TriangleMesh.h;
// FORCE_FIELD_ID_BASE (-7000) in ForceField.h;
// STATIC_SPHERE_ID_BASE (-8000) and STATIC_CONE_ID_BASE (-9000) in StaticShapes.h;
// PIN_FIELD_ID_BASE (-10000) in PinField.h.

/**
 * Entries per static-handle family.
 *
 * The id bases above are spaced 1000 apart, so the 1001st shape of a family
 * would be handed the next family's base — `setCollisionGroups` would then
 * edit the wrong descriptor and a contact id would name two different
 * shapes. Creation is refused at the cap instead: a dropped collider is
 * visible (`getDroppedStaticCount()`) where aliasing is silent.
 */
inline constexpr std::size_t STATIC_HANDLE_CAPACITY = 1000;

/**
 * Returned by an add*() that hit `STATIC_HANDLE_CAPACITY`. Positive, so it can
 * never be mistaken for a static handle, and no body ever carries this id — so
 * passing it to setCollisionGroups() is a no-op rather than a mis-edit.
 */
inline constexpr int STATIC_HANDLE_OVERFLOW = 0x7FFFFFFF;

/**
 * Oriented static cylinder collider (local Y is the axis, matching the
 * capsule convention and Rapier's `ColliderDesc.cylinder(halfHeight, radius)`).
 *
 * Sphere-vs-cylinder is closed form — see resolveSphereVsCylinder() in
 * StaticShapes.cpp — covering the curved side, the two flat end caps, and
 * the rim circle where they meet.
 */
struct CylinderDesc {
  Vec3     center      = Vec3::zero();
  float    radius      = 0.5f;
  float    halfHeight  = 0.5f;
  Quat     rotation    = Quat::identity();
  float    restitution = 0.4f;
  float    friction    = 0.2f;
  uint32_t membership  = COLLISION_GROUPS_ALL;
  uint32_t filter      = COLLISION_GROUPS_ALL;
};

/** Static sphere collider (rotation-free). */
struct SphereDesc {
  Vec3     center      = Vec3::zero();
  float    radius      = 0.5f;
  float    restitution = 0.4f;
  float    friction    = 0.2f;
  uint32_t membership  = COLLISION_GROUPS_ALL;
  uint32_t filter      = COLLISION_GROUPS_ALL;
};

/**
 * Oriented static cone — local +Y is the axis, the apex sits at
 * +`halfHeight` and the base disc of `radius` at -`halfHeight`, exactly
 * Rapier's `ColliderDesc.cone(halfHeight, radius)`. Ball-trap funnels.
 *
 * Sphere-vs-cone is closed form (Cone.cpp): the solid is a triangle swept
 * around the axis, so the closest point is found in the (radial, axial)
 * half-plane through the sphere centre and lifted back to 3D.
 */
struct ConeDesc {
  Vec3     center      = Vec3::zero();
  float    radius      = 0.5f;
  float    halfHeight  = 0.5f;
  Quat     rotation    = Quat::identity();
  float    restitution = 0.4f;
  float    friction    = 0.2f;
  uint32_t membership  = COLLISION_GROUPS_ALL;
  uint32_t filter      = COLLISION_GROUPS_ALL;
};

/** Negative-id bases for the static shapes declared here. */
static constexpr int STATIC_CYLINDER_ID_BASE = -5000;
static constexpr int STATIC_SPHERE_ID_BASE   = -8000;
static constexpr int STATIC_CONE_ID_BASE     = -9000;

} // namespace pachinball
