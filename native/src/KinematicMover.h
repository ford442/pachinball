#pragma once

#include "CollisionFilter.h"
#include "MathTypes.h"
#include "VolumeShape.h"

#include <cstdint>

namespace pachinball {

/** Parameters for creating a kinematic mover (piston, platter, gate, rotating disc). */
struct KinematicMoverDesc {
  Vec3        position   = Vec3::zero();
  VolumeShape shape      = VolumeShape::Box;
  /** Read per `shape` — see VolumeShape. Cylinder movers drive rotating platforms and mills. */
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
  VolumeShape shape        = VolumeShape::Box;
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

  /**
   * The pose this tick's sweep starts from (beginKinematicMoverSweep) while
   * `sweeping`. Transient: set at the top of a step() and consumed by its
   * last substep, so never snapshotted.
   */
  Vec3     sweepFromPos    = Vec3::zero();
  Quat     sweepFromRot    = Quat::identity();
  bool     sweeping        = false;
};

/** Negative-id base for kinematic movers in contact events / setCollisionGroups. */
static constexpr int KINEMATIC_MOVER_ID_BASE = -3000;

/**
 * Start this tick's sweep to the pending `setNextKinematicTransform` pose:
 * velocity is the pose delta over `tickDt` — every substep the step() runs,
 * not one fixed step (#520 row 6) — and the pose itself moves substep by
 * substep (placeKinematicMover). Zero velocity and no sweep when no pose
 * was pushed. Called once per step() that runs at least one substep.
 */
void beginKinematicMoverSweep(KinematicMover& mover, float tickDt);

/**
 * Put a sweeping mover at its pose for the end of substep `substep` of
 * `substepCount` (contacts are solved at end-of-substep positions). The
 * last substep lands exactly on the pushed pose.
 */
void placeKinematicMover(KinematicMover& mover, int substep, int substepCount);

/**
 * Pose a fraction `t` ∈ (0, 1) of the way from (`fromPos`, `fromRot`) to
 * (`toPos`, `toRot`): lerp, and normalised lerp along the shortest arc.
 * Shared by movers and kinematic rigid bodies.
 */
void interpolatePose(const Vec3& fromPos, const Quat& fromRot, const Vec3& toPos, const Quat& toRot,
                     float t, Vec3& outPos, Quat& outRot);

/**
 * Linear + angular velocity that carries pose (`fromPos`, `fromRot`) to
 * (`toPos`, `toRot`) over `dt` — shortest-path quaternion delta, small-angle
 * extraction. Shared by movers and kinematic rigid bodies.
 */
void poseDeltaVelocity(const Vec3& fromPos, const Quat& fromRot,
                       const Vec3& toPos, const Quat& toRot, float dt,
                       Vec3& outLinear, Vec3& outAngular);

} // namespace pachinball
