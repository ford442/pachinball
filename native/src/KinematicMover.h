#pragma once

#include "CollisionFilter.h"
#include "MathTypes.h"

#include <cstdint>

namespace pachinball {

/** Parameters for creating a kinematic oriented-box mover (piston, platter, gate). */
struct KinematicMoverDesc {
  Vec3     position      = Vec3::zero();
  Vec3     halfExtents   = {0.5f, 0.5f, 0.5f};
  Quat     rotation      = Quat::identity();
  float    restitution   = 0.4f;
  float    friction      = 0.2f;
  uint32_t membership    = COLLISION_GROUPS_ALL;
  uint32_t filter        = COLLISION_GROUPS_ALL;
};

/**
 * Live kinematic OBB mover state. Pose is pushed once per world `step()` via
 * `setNextKinematicTransform`; linear/angular velocity is derived from the
 * pose delta over that tick so contacts pick up the mover's true motion
 * (a rising piston launches a resting ball, a rotating platter imparts
 * tangential velocity) instead of only teleporting geometry.
 */
struct KinematicMover {
  Vec3     halfExtents     = {0.5f, 0.5f, 0.5f};
  Vec3     currentPos      = Vec3::zero();
  Quat     currentRot      = Quat::identity();
  Vec3     nextPos         = Vec3::zero();
  Quat     nextRot         = Quat::identity();
  bool     hasNextPose     = false;
  Vec3     linearVelocity  = Vec3::zero();
  Vec3     angularVelocity = Vec3::zero();
  float    restitution     = 0.4f;
  float    friction        = 0.2f;
  uint32_t membership      = COLLISION_GROUPS_ALL;
  uint32_t filter          = COLLISION_GROUPS_ALL;
};

/** Negative-id base for kinematic OBB movers in contact events / setCollisionGroups. */
static constexpr int KINEMATIC_MOVER_ID_BASE = -3000;

/**
 * Commit any pending `setNextKinematicTransform` pose and derive linear +
 * angular velocity from the pose delta over `dt`. No-op (zero velocity) when
 * no new pose was pushed this tick. Called once per `PhysicsWorld::step()`.
 */
void advanceKinematicMoverPose(KinematicMover& mover, float dt);

} // namespace pachinball
