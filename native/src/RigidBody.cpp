#include "RigidBody.h"

namespace pachinball {

RigidBody::RigidBody(int id, const RigidBodyDesc& desc)
    : id_(id), desc_(desc),
      position_(desc.position),
      velocity_(desc.velocity) {}

void RigidBody::integrate(float dt, const Vec3& gravity) {
  if (desc_.type != BodyType::Dynamic || !active_) return;

  // Accumulate gravity as a force (F = m * g)
  Vec3 totalForce = forceAccum_ + gravity * desc_.mass;

  // Semi-implicit Euler integration
  Vec3 acceleration = totalForce * getInvMass();
  velocity_ += acceleration * dt;

  // Linear damping: v *= (1 - damping * dt), clamped to zero
  float dampFactor = 1.f - desc_.linearDamping * dt;
  if (dampFactor < 0.f) dampFactor = 0.f;
  velocity_ *= dampFactor;

  position_ += velocity_ * dt;

  // Clear force accumulator for next frame
  forceAccum_ = Vec3::zero();
}

} // namespace pachinball
