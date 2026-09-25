/**
 * Runtime body types and kinematic rigid-body targets (#420).
 *
 * A table toy (MagSpin, Gauss Cannon, Quantum Tunnel, NanoLoom, Prism Core,
 * BallManager's hologram catch) takes a live dynamic ball, freezes it, steers
 * it into its well and spits it out. That is a *body-type flip* on the ball
 * the solver actually steps — not a mover, which is world geometry:
 *
 *   setBodyType(id, Kinematic)          infinite mass, pose kept, velocity 0
 *   setNextKinematicTransform(id, …)    pose target for the next step()
 *   setBodyType(id, Dynamic)            mass back, last kinematic velocity kept
 *
 * Targets are committed once per `step()` — the same contract as movers
 * (KinematicMover.cpp): the body arrives at the target and carries the pose
 * delta over the fixed tick as its velocity, so contacts see its true motion
 * and a release is not a dead drop. A tick with no target leaves a
 * previously driven body at rest, as Rapier's position-based kinematic does.
 */
#include "PhysicsWorld.h"

#include <algorithm>

namespace pachinball {

void PhysicsWorld::setBodyType(int id, BodyType type) {
  BodyView body = findViewMut(id);
  if (!body.valid() || body.getType() == type) return;

  bodies_.setType(body.denseIndex(), type);
  if (type != BodyType::Dynamic) {
    // Captured: stop dead where it is until a target moves it.
    body.setVelocity(Vec3::zero());
    body.setAngularVelocity(Vec3::zero());
  }
  // → Dynamic keeps whatever velocity the last kinematic tick derived.
}

int PhysicsWorld::getBodyType(int id) const {
  const BodyView body = findView(id);
  return body.valid() ? static_cast<int>(body.getType()) : -1;
}

void PhysicsWorld::pushKinematicBodyTarget(int id, const Vec3& position, const Quat& rotation) {
  for (KinematicBodyTarget& target : bodyTargets_) {
    if (target.id != id) continue;
    target.position = position;
    target.rotation = rotation;
    return;
  }
  bodyTargets_.push_back({id, position, rotation});
}

void PhysicsWorld::advanceKinematicBodies(float dt) {
  auto hasTarget = [this](int id) {
    return std::any_of(bodyTargets_.begin(), bodyTargets_.end(),
                       [id](const KinematicBodyTarget& t) { return t.id == id; });
  };

  for (int id : drivenBodies_) {
    if (hasTarget(id)) continue;
    BodyView body = findViewMut(id);
    if (!body.valid() || body.getType() != BodyType::Kinematic) continue;
    body.setVelocity(Vec3::zero());
    body.setAngularVelocity(Vec3::zero());
  }
  drivenBodies_.clear();

  if (dt > 1e-8f) {
    for (const KinematicBodyTarget& target : bodyTargets_) {
      BodyView body = findViewMut(target.id);
      if (!body.valid() || body.getType() != BodyType::Kinematic) continue;

      const Quat rotation = target.rotation.normalized();
      Vec3 linear;
      Vec3 angular;
      poseDeltaVelocity(body.getPosition(), body.getRotation(), target.position, rotation, dt,
                        linear, angular);
      body.setPosition(target.position);
      body.setRotation(rotation);
      body.setVelocity(linear);
      body.setAngularVelocity(angular);
      drivenBodies_.push_back(target.id);
    }
  }
  bodyTargets_.clear();
}

} // namespace pachinball
