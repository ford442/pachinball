#pragma once

#include "MathTypes.h"

namespace pachinball {

class BodyView;

/**
 * |angle limit| createHinge stores: float π, the bound of the wrapped hinge
 * angle (computeHingeAngle). JS `Math.PI` rounds to this same float.
 */
inline constexpr float HINGE_ANGLE_LIMIT = 3.14159265f;

/** World-anchored 1-DOF revolute (flipper vs static table). Body-body hinges are out of scope. */
struct HingeDesc {
  Vec3  worldAnchor     = Vec3::zero();
  Vec3  worldAxis       = Vec3::up();
  float minAngle        = -3.14159265f;
  float maxAngle        =  3.14159265f;
  float motorTargetVel  = 0.f;
  float motorMaxTorque  = 0.f;
  float baumgarte       = 0.2f;
};

struct HingeJoint {
  int   id     = -1;
  int   bodyId = -1;
  bool  active = false;
  Vec3  worldAnchor;
  Vec3  worldAxis     = Vec3::up();
  Vec3  localAnchor   = Vec3::zero();
  Quat  restRotation  = Quat::identity();
  float minAngle      = -3.14159265f;
  float maxAngle      =  3.14159265f;
  float motorTargetVel = 0.f;
  float motorMaxTorque = 0.f;
  float baumgarte      = 0.2f;

  /**
   * Impulse the motor / each angle limit has applied so far in the current
   * substep (#520 row 1). The bounds hold for the sum over the solver
   * iterations — |motor| ≤ motorMaxTorque·dt, lower ≥ 0, upper ≤ 0 — not per
   * iteration, so the motor's strength no longer scales with
   * `solverIterations` and a limit can give back what an earlier iteration
   * over-applied. Transient: zeroed by beginHingeSubstep() before every
   * substep's iterations, so never snapshotted or hashed.
   */
  float motorImpulse = 0.f;
  float lowerImpulse = 0.f;
  float upperImpulse = 0.f;
};

/** Zero the per-substep accumulated impulses (call before the solver iterations). */
inline void beginHingeSubstep(HingeJoint& joint) {
  joint.motorImpulse = 0.f;
  joint.lowerImpulse = 0.f;
  joint.upperImpulse = 0.f;
}

float computeHingeAngle(const HingeJoint& joint, const Quat& rotation);

/**
 * One sequential-impulse iteration for a world-anchored hinge. The motor and
 * the limits clamp their accumulated impulse (HingeJoint::motorImpulse …),
 * so `dt` must be the substep the accumulators were zeroed for.
 */
void solveWorldHinge(HingeJoint& joint, BodyView& body, float dt);

} // namespace pachinball
