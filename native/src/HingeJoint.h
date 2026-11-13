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
};

float computeHingeAngle(const HingeJoint& joint, const Quat& rotation);

/** Sequential-impulse solve for a world-anchored hinge. Wakes the body on impulse. */
void solveWorldHinge(HingeJoint& joint, BodyView& body, float dt);

} // namespace pachinball
